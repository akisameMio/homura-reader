package com.homura.reader.archive

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import android.util.Base64
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val SOURCE_ROOT = "homura-native-sources"
private const val CACHE_ROOT = "homura-native-pages"
private const val MAX_ENTRIES = 20_000
private const val MAX_PAGE_BYTES = 256L * 1024 * 1024
private const val MAX_CACHE_FILES = 24
private const val MAX_CACHE_BYTES = 192L * 1024 * 1024
// 交给 WebView 的页面按屏幕长边降采样，别把整张 4K 位图塞进渲染进程
private const val MIN_PAGE_EDGE = 1280
private const val MAX_PAGE_EDGE = 2048
private const val PAGE_WEBP_QUALITY = 82
private const val PREFETCH_AHEAD = 2
// 每解出这么多页才做一次目录清理，避免每翻一页都 list + stat 整个缓存目录
private const val TRIM_EVERY_EXTRACTS = 5
private const val MAX_TEXT_PATHS = 5_000
private const val MAX_TEXT_ENTRY_BYTES = 8L * 1024 * 1024
private const val MAX_TEXT_TOTAL_BYTES = 32L * 1024 * 1024
private const val MAX_IMPORT_FILE_BYTES = 4L * 1024 * 1024 * 1024
private const val MAX_IMPORT_ARCHIVE_BYTES = 16L * 1024 * 1024 * 1024
private const val MAX_IMPORT_NAME_CHARS = 180
private const val MAX_IMPORT_TREE_ENTRIES = 20_000
private const val MAX_IMPORT_TREE_DEPTH = 64
private const val IMPORT_PART_PREFIX = ".homura-import-"
private const val REFERENCE_PREFS = "homura_saf_references"
private const val REFERENCE_PREFIX = "grant_"
private const val MAX_REFERENCE_CHUNK_BYTES = 1024 * 1024

private val IMAGE_NAME = Regex(""".*\.(jpg|jpeg|png|webp|gif|avif|bmp)$""", RegexOption.IGNORE_CASE)

@InvokeArg
class OpenOptions {
  lateinit var archiveId: String
  lateinit var path: String
  var scanDimensions: Boolean = true
  var includeEntries: Boolean = true
}

@InvokeArg
class PageOptions {
  lateinit var archiveId: String
  var index: Int = -1
}

@InvokeArg
class CloseOptions {
  lateinit var archiveId: String
}

@InvokeArg
class CacheOptions {
  lateinit var bookId: String
}

@InvokeArg
class TextBatchOptions {
  lateinit var archiveId: String
  lateinit var pathsJson: String
}

@InvokeArg
class InspectImportOptions {
  lateinit var uris: Array<String>
}

@InvokeArg
class StageImportUriOptions {
  lateinit var bookId: String
  lateinit var uri: String
  var name: String? = null
}

@InvokeArg
class ImportPickerOptions {
  var multiple: Boolean? = null
  var persistReadAccess: Boolean = false
}

@InvokeArg
class ImportFolderPickerOptions {
  var persistReadAccess: Boolean = false
}

@InvokeArg
class ReferenceOptions {
  lateinit var referenceToken: String
}

@InvokeArg
class HashReferenceOptions {
  lateinit var referenceToken: String
  var uri: String? = null
}

@InvokeArg
class ReadReferenceOptions {
  lateinit var referenceToken: String
  var offset: Long = 0
  var length: Int = 256 * 1024
}

@InvokeArg
class ReleaseReferenceOptions {
  lateinit var referenceTokens: Array<String>
}

private class ArchiveSession(
  val id: String,
  val bookId: String,
  val zipFile: ZipFile,
  val entries: List<ZipEntry>,
  val entryIndexByName: Map<String, Int>,
  // 只有 CBZ 的图片条目顺序等于阅读顺序；EPUB 文档的条目索引和页序无关
  val sequentialPages: Boolean
) {
  val lock = Any()
}

private class TextEntryTooLargeException : Exception()

private class NativeImportException(
  val code: String,
  message: String
) : Exception(message)

private data class ImportUriMetadata(
  val name: String,
  val size: Long,
  val mime: String,
  val modifiedMs: Long
)

private data class ReferenceGrant(
  val token: String,
  val uri: String,
  val grantUri: String,
  val name: String,
  val size: Long,
  val mime: String,
  val modifiedMs: Long
)

private data class ResolvedReference(
  val grant: ReferenceGrant,
  val current: ImportUriMetadata,
  val seekable: Boolean,
  val stale: Boolean,
  val resolvedSize: Long
)

@TauriPlugin
class AndroidArchivePlugin(private val activity: Activity) : Plugin(activity) {
  private var lastImportFolderUri: Uri? = null
  private val referenceLock = Any()
  private val sessions = HashMap<String, ArchiveSession>()
  private val extractCounters = ConcurrentHashMap<String, Int>()
  private val prefetchGenerations = ConcurrentHashMap<String, Int>()
  private val executor: ExecutorService = Executors.newFixedThreadPool(2) { runnable ->
    Thread(runnable, "homura-archive").apply { isDaemon = true }
  }
  private val prefetchExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "homura-archive-prefetch").apply { isDaemon = true }
  }

  init {
    // 导入进程被杀时 .part 来不及清理，下一次启动先回收残留临时文件。
    executor.execute(::cleanupImportPartFiles)
  }

  @Command
  fun open(invoke: Invoke) {
    val options = invoke.parseArgs(OpenOptions::class.java)
    runAsync(invoke) {
      val archiveFile = resolveArchiveFile(options.path)
      val zipFile = ZipFile(archiveFile)
      try {
        val entries = readImageEntries(zipFile)
        if (entries.isEmpty()) throw IllegalStateException("压缩包内未找到图片")

        val dimensions = if (options.scanDimensions) {
          readPageDimensions(zipFile, entries)
        } else {
          emptyList()
        }
        val session = createSession(options.archiveId, zipFile, entries, sequentialPages = true)
        replaceSession(session)

        JSObject().apply {
          put("archiveId", options.archiveId)
          put("entries", JSArray().apply {
            entries.forEachIndexed { index, entry ->
              put(entryJson(entry, index, dimensions.getOrNull(index)))
            }
          })
        }
      } catch (error: Throwable) {
        zipFile.close()
        throw error
      }
    }
  }

  @Command
  fun openDocument(invoke: Invoke) {
    val options = invoke.parseArgs(OpenOptions::class.java)
    runAsync(invoke) {
      val archiveFile = resolveArchiveFile(options.path)
      val zipFile = ZipFile(archiveFile)
      try {
        val entries = readAllEntries(zipFile)
        if (entries.isEmpty()) throw IllegalStateException("压缩包内没有可读取的条目")
        if (entries.size > MAX_ENTRIES) throw IllegalStateException("压缩包条目数量过多")

        val dimensions = if (options.scanDimensions) {
          readPageDimensions(zipFile, entries)
        } else {
          emptyList()
        }
        val session = createSession(options.archiveId, zipFile, entries, sequentialPages = false)
        replaceSession(session)

        JSObject().apply {
          put("archiveId", options.archiveId)
          if (options.includeEntries) {
            put("entries", JSArray().apply {
              entries.forEachIndexed { index, entry ->
                put(entryJson(entry, index, dimensions.getOrNull(index)))
              }
            })
            put("images", JSArray().apply {
              entries.forEachIndexed { index, entry ->
                if (isImageEntry(entry)) put(entryJson(entry, index, dimensions.getOrNull(index)))
              }
            })
          }
        }
      } catch (error: Throwable) {
        zipFile.close()
        throw error
      }
    }
  }

  @Command
  fun extract(invoke: Invoke) {
    val options = invoke.parseArgs(PageOptions::class.java)
    runAsync(invoke) {
      val session = synchronized(sessions) { sessions[options.archiveId] }
        ?: throw IllegalStateException("压缩包会话已关闭")

      synchronized(session.lock) {
        val page = ensurePageFile(session, options.index)
        val counter = (extractCounters[session.bookId] ?: 0) + 1
        if (counter >= TRIM_EVERY_EXTRACTS) {
          extractCounters[session.bookId] = 0
          trimCache(session.bookId)
        } else {
          extractCounters[session.bookId] = counter
        }
        schedulePrefetch(session, options.index)
        page
      }
    }
  }

  @Command
  fun readTextBatch(invoke: Invoke) {
    val options = invoke.parseArgs(TextBatchOptions::class.java)
    runAsync(invoke) {
      val session = synchronized(sessions) { sessions[options.archiveId] }
        ?: throw IllegalStateException("压缩包会话已关闭")
      val paths = JSONArray(options.pathsJson)
      if (paths.length() > MAX_TEXT_PATHS) throw IllegalStateException("批量读取文本条目过多")

      val texts = JSArray()
      var totalBytes = 0L
      synchronized(session.lock) {
        for (index in 0 until paths.length()) {
          if (totalBytes >= MAX_TEXT_TOTAL_BYTES) break
          val path = paths.optString(index, "")
          if (path.isEmpty()) continue
          val entryIndex = session.entryIndexByName[path] ?: continue
          val entry = session.entries[entryIndex]
          if (entry.isDirectory) continue
          if (entry.size > 0 && entry.size > MAX_TEXT_ENTRY_BYTES) continue

          val remaining = MAX_TEXT_TOTAL_BYTES - totalBytes
          val bytes = try {
            readEntryBytes(session, entry, minOf(MAX_TEXT_ENTRY_BYTES, remaining))
          } catch (_: TextEntryTooLargeException) {
            continue
          }
          totalBytes += bytes.size
          texts.put(JSObject().apply {
            put("path", path)
            put("text", bytes.toString(Charsets.UTF_8))
            put("size", bytes.size)
          })
        }
      }

      JSObject().apply {
        put("texts", texts)
        put("totalBytes", totalBytes)
      }
    }
  }

  @Command
  fun close(invoke: Invoke) {
    val options = invoke.parseArgs(CloseOptions::class.java)
    runAsync(invoke) {
      closeSession(options.archiveId)
      null
    }
  }

  @Command
  fun clearBook(invoke: Invoke) {
    val options = invoke.parseArgs(CacheOptions::class.java)
    runAsync(invoke) {
      closeBookSessions(options.bookId)
      extractCounters.remove(options.bookId)
      prefetchGenerations.remove(options.bookId)
      cacheDirFor(options.bookId).deleteRecursively()
      null
    }
  }

  @Command
  fun clearAll(invoke: Invoke) {
    runAsync(invoke) {
      closeAllSessions()
      extractCounters.clear()
      prefetchGenerations.clear()
      File(activity.cacheDir, CACHE_ROOT).deleteRecursively()
      null
    }
  }

  @Command
  fun inspectImportUris(invoke: Invoke) {
    val options = invoke.parseArgs(InspectImportOptions::class.java)
    runAsync(invoke) {
      JSObject().apply {
        put("files", JSArray().apply {
          options.uris.forEach { rawUri ->
            if (rawUri.isBlank()) return@forEach
            val metadata = inspectImportUri(rawUri)
            put(JSObject().apply {
              put("uri", rawUri)
              put("name", metadata.name)
              put("size", metadata.size)
              put("mime", metadata.mime)
              put("modifiedMs", metadata.modifiedMs)
            })
          }
        })
      }
    }
  }

  @Command
  fun resolveReference(invoke: Invoke) {
    val options = invoke.parseArgs(ReferenceOptions::class.java)
    runAsync(invoke) {
      try {
        val resolved = resolveReferenceBlocking(options.referenceToken)
        referenceResultJson(resolved)
      } catch (error: Throwable) {
        throw nativeImportError(error)
      }
    }
  }

  @Command
  fun readReference(invoke: Invoke) {
    val options = invoke.parseArgs(ReadReferenceOptions::class.java)
    runAsync(invoke) {
      try {
        readReferenceBlocking(options)
      } catch (error: Throwable) {
        throw nativeImportError(error)
      }
    }
  }

  @Command
  fun hashReference(invoke: Invoke) {
    val options = invoke.parseArgs(HashReferenceOptions::class.java)
    runAsync(invoke) {
      try {
        hashReferenceBlocking(options.referenceToken, options.uri)
      } catch (error: Throwable) {
        throw nativeImportError(error)
      }
    }
  }

  @Command
  fun openReferenceArchive(invoke: Invoke) {
    val options = invoke.parseArgs(ReferenceOptions::class.java)
    runAsync(invoke) {
      try {
        val resolved = resolveReferenceBlocking(options.referenceToken)
        if (!isArchiveName(resolved.grant.name)) {
          throw NativeImportException("NATIVE_UNSUPPORTED", "引用不是 EPUB、CBZ 或 ZIP 压缩包")
        }
        if (resolved.stale) throw referenceStaleError()
        referenceResultJson(resolved).apply {
          // java.util.zip.ZipFile 只能打开本地 File。这里明确暴露有界引用读取，
          // 不通过后台复制文件冒充 SAF 压缩包随机访问。
          put("nativeRandomAccess", false)
          put("readMode", "bounded-chunks")
          put("maxChunkBytes", MAX_REFERENCE_CHUNK_BYTES)
          put("reason", "Android SAF URI cannot be opened directly by java.util.zip.ZipFile")
        }
      } catch (error: Throwable) {
        throw nativeImportError(error)
      }
    }
  }

  @Command
  fun releaseReference(invoke: Invoke) {
    val options = invoke.parseArgs(ReleaseReferenceOptions::class.java)
    runAsync(invoke) {
      releaseReferencesBlocking(options.referenceTokens)
    }
  }

  @Command
  fun pickImportUris(invoke: Invoke) {
    try {
      val options = invoke.parseArgs(ImportPickerOptions::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        // DocumentsUI 会严格按 EXTRA_MIME_TYPES 过滤，而 Downloads provider
        // 常把 .mobi 报成 application/octet-stream 甚至不报 MIME。
        // 因此放开所有类型，由 JS 侧按扩展名筛选。
        type = "*/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, options.multiple ?: true)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      startActivityForResult(invoke, intent, "importPickerResult")
    } catch (error: Throwable) {
      invoke.reject("NATIVE_UNAVAILABLE: 无法打开系统文件选择器")
    }
  }

  @ActivityCallback
  fun importPickerResult(invoke: Invoke, result: ActivityResult) {
    when (result.resultCode) {
      Activity.RESULT_OK -> {
        val data = result.data
        val uris = mutableListOf<String>()
        data?.clipData?.let { clip ->
          for (index in 0 until clip.itemCount) {
            uris.add(clip.getItemAt(index).uri.toString())
          }
        } ?: data?.data?.let { uris.add(it.toString()) }
        val options = invoke.parseArgs(ImportPickerOptions::class.java)
        runAsync(invoke) {
          val references = JSArray()
          if (options.persistReadAccess) {
            uris.forEach { rawUri ->
              try {
                references.put(persistPickedReference(rawUri))
              } catch (error: Throwable) {
                references.put(referenceUnavailableJson(rawUri, error))
              }
            }
          }
          JSObject().apply {
            // files 保持旧版字符串结构；reference 模式额外读取 references。
            put("files", JSArray.from(uris.toTypedArray()))
            put("references", references)
          }
        }
      }
      Activity.RESULT_CANCELED -> invoke.reject("NATIVE_CANCELLED: 用户取消选择")
      else -> invoke.reject("NATIVE_COMMAND_FAILED: 系统文件选择器返回异常")
    }
  }

  @Command
  fun pickImportFolder(invoke: Invoke) {
    try {
      invoke.parseArgs(ImportFolderPickerOptions::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          // 文件选择器可能记住内置存储或 Download 根目录，两处都不能授予目录权限。
          val initialUri = lastImportFolderUri ?: DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents",
            "primary:${Environment.DIRECTORY_DOCUMENTS}"
          )
          putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri)
        }
      }
      startActivityForResult(invoke, intent, "importFolderResult")
    } catch (error: Exception) {
      invoke.reject("NATIVE_UNAVAILABLE: 无法打开系统文件夹选择器")
    }
  }

  @ActivityCallback
  fun importFolderResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.reject("NATIVE_CANCELLED: 用户取消选择")
      return
    }
    val treeUri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || treeUri == null ||
      treeUri.scheme != "content" || !DocumentsContract.isTreeUri(treeUri)) {
      invoke.reject("NATIVE_INVALID_DATA: 系统文件夹选择器没有返回有效目录")
      return
    }
    lastImportFolderUri = DocumentsContract.buildDocumentUriUsingTree(
      treeUri, DocumentsContract.getTreeDocumentId(treeUri)
    )
    runAsync(invoke) {
      try {
        val options = invoke.parseArgs(ImportFolderPickerOptions::class.java)
        val referenceGrantUri = treeUri.takeIf { options.persistReadAccess }
        scanImportTree(treeUri, referenceGrantUri)
      } catch (error: Exception) {
        throw nativeImportError(error)
      }
    }
  }

  private fun scanImportTree(treeUri: Uri, referenceGrantUri: Uri?): JSObject {
    val rootId = DocumentsContract.getTreeDocumentId(treeUri)
    val rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId)
    val rootName = inspectImportUri(rootUri.toString()).name
    val files = JSArray()
    val referenceEditor = referenceGrantUri?.let { referencePreferences().edit() }
    val visitedDirectories = mutableSetOf(rootId)
    val projection = arrayOf(
      Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
      Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED
    )
    var scannedEntries = 0

    fun scanDirectory(parentId: String, parentPath: String, depth: Int) {
      if (depth > MAX_IMPORT_TREE_DEPTH) {
        throw NativeImportException("NATIVE_LIMIT_EXCEEDED", "文件夹层级过深")
      }
      val children = mutableListOf<Pair<String, String>>()
      val childUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
      val cursor = activity.contentResolver.query(childUri, projection, null, null, null)
        ?: throw NativeImportException("NATIVE_COMMAND_FAILED", "无法读取所选目录")
      cursor.use {
        val idColumn = it.getColumnIndexOrThrow(Document.COLUMN_DOCUMENT_ID)
        val nameColumn = it.getColumnIndexOrThrow(Document.COLUMN_DISPLAY_NAME)
        val mimeColumn = it.getColumnIndexOrThrow(Document.COLUMN_MIME_TYPE)
        val sizeColumn = it.getColumnIndex(Document.COLUMN_SIZE)
        val modifiedColumn = it.getColumnIndex(Document.COLUMN_LAST_MODIFIED)
        while (it.moveToNext()) {
          if (++scannedEntries > MAX_IMPORT_TREE_ENTRIES) {
            throw NativeImportException("NATIVE_LIMIT_EXCEEDED", "文件夹条目过多")
          }
          val id = it.getString(idColumn) ?: continue
          val name = it.getString(nameColumn) ?: continue
          if (name.isBlank() || name.startsWith(".") || name == "__MACOSX" ||
            '/' in name || '\\' in name) continue
          val relativePath = "$parentPath/$name"
          if (it.getString(mimeColumn) == Document.MIME_TYPE_DIR) {
            if (visitedDirectories.add(id)) children.add(id to relativePath)
          } else if (isSupportedImportName(name)) {
            val fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)
            files.put(JSObject().apply {
              put("uri", fileUri.toString())
              put("name", name)
              put("relativePath", relativePath)
              if (sizeColumn >= 0 && !it.isNull(sizeColumn)) put("size", it.getLong(sizeColumn).coerceAtLeast(0))
              if (modifiedColumn >= 0 && !it.isNull(modifiedColumn)) put("modifiedMs", it.getLong(modifiedColumn))
              if (referenceGrantUri != null) {
                try {
                  val metadata = inspectImportUri(fileUri.toString())
                  val grant = createReferenceGrant(fileUri, referenceGrantUri, metadata, referenceEditor)
                  put("referenceToken", grant.token)
                  put("referenceAvailable", true)
                } catch (error: Throwable) {
                  put("referenceAvailable", false)
                  put("referenceError", referenceErrorMessage(error))
                }
              }
            })
          }
        }
      }
      // 先关闭父目录游标，避免深层目录同时占用多个 provider 游标。
      for ((id, path) in children) scanDirectory(id, path, depth + 1)
    }

    scanDirectory(rootId, rootName.replace('/', '_').replace('\\', '_'), 0)
    if (referenceGrantUri != null && referenceEditor != null && files.length() > 0) {
      synchronized(referenceLock) {
        takePersistableReadGrant(referenceGrantUri)
        if (!referenceEditor.commit()) {
          throw NativeImportException("NATIVE_COMMAND_FAILED", "无法保存文件夹引用授权")
        }
      }
    }
    return JSObject().apply {
      put("files", files)
      if (referenceGrantUri != null) put("folderKey", referenceGrantUri.toString())
    }
  }

  @Command
  fun stageImportUri(invoke: Invoke) {
    val options = invoke.parseArgs(StageImportUriOptions::class.java)
    runAsync(invoke) {
      try {
        stageImportUriBlocking(options)
      } catch (error: Throwable) {
        throw nativeImportError(error)
      }
    }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    closeAllSessions()
    executor.shutdownNow()
    prefetchExecutor.shutdownNow()
    super.onDestroy(activity)
  }

  private fun runAsync(invoke: Invoke, task: () -> JSObject?) {
    executor.execute {
      try {
        val result = task()
        activity.runOnUiThread {
          if (result == null) invoke.resolve() else invoke.resolve(result)
        }
      } catch (error: Throwable) {
        val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
        activity.runOnUiThread { invoke.reject(message) }
      }
    }
  }

  private fun inspectImportUri(rawUri: String): ImportUriMetadata {
    val uri = try {
      Uri.parse(rawUri)
    } catch (_: Throwable) {
      Uri.EMPTY
    }
    var name = ""
    var size = 0L
    var modifiedMs = 0L

    try {
      activity.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex) ?: ""
          val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
        }
      }
    } catch (_: Throwable) {
      // 部分 provider 不实现 OpenableColumns，保底仍可用 URI 末段与扩展名。
    }

    try {
      activity.contentResolver.query(
        uri,
        arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED),
        null,
        null,
        null
      )?.use { cursor ->
        val modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        if (cursor.moveToFirst() && modifiedIndex >= 0 && !cursor.isNull(modifiedIndex)) {
          modifiedMs = cursor.getLong(modifiedIndex)
        }
      }
    } catch (_: Throwable) {
      // 修改时间只用于展示与排序，读不到不影响导入。
    }

    val fallbackName = try {
      Uri.decode(uri.lastPathSegment ?: "")
    } catch (_: Throwable) {
      ""
    }.substringAfterLast('/').ifBlank { "source" }
    val finalName = name.takeIf { it.isNotBlank() } ?: fallbackName
    val mime = try {
      activity.contentResolver.getType(uri)
    } catch (_: Throwable) {
      null
    } ?: mimeFor(finalName)

    return ImportUriMetadata(
      name = finalName,
      size = size.coerceAtLeast(0L),
      mime = mime,
      modifiedMs = modifiedMs.coerceAtLeast(0L)
    )
  }

  private fun persistPickedReference(rawUri: String): JSObject {
    val uri = contentUriOrThrow(rawUri)
    val metadata = inspectImportUri(rawUri)
    return synchronized(referenceLock) {
      takePersistableReadGrant(uri)
      referenceGrantJson(createReferenceGrant(uri, uri, metadata))
    }
  }

  private fun takePersistableReadGrant(grantUri: Uri) {
    try {
      activity.contentResolver.takePersistableUriPermission(
        grantUri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION
      )
    } catch (error: SecurityException) {
      throw NativeImportException(
        "NATIVE_REFERENCE_UNAVAILABLE",
        "文件提供方未授予可持久化的读取权限"
      )
    }
    if (!hasPersistedReadGrant(grantUri)) {
      throw NativeImportException(
        "NATIVE_REFERENCE_UNAVAILABLE",
        "系统未保存所选文件的持久读取授权"
      )
    }
  }

  private fun hasPersistedReadGrant(grantUri: Uri): Boolean {
    return try {
      activity.contentResolver.persistedUriPermissions.any { permission ->
        permission.isReadPermission && permission.uri == grantUri
      }
    } catch (_: Throwable) {
      false
    }
  }

  private fun createReferenceGrant(
    uri: Uri,
    grantUri: Uri,
    metadata: ImportUriMetadata,
    editor: SharedPreferences.Editor? = null
  ): ReferenceGrant {
    val token = "saf_${UUID.randomUUID()}"
    val grant = ReferenceGrant(
      token = token,
      uri = uri.toString(),
      grantUri = grantUri.toString(),
      name = metadata.name,
      size = metadata.size,
      mime = metadata.mime,
      modifiedMs = metadata.modifiedMs
    )
    val destination = editor ?: referencePreferences().edit()
    destination.putString(
      REFERENCE_PREFIX + token,
      JSONObject().apply {
        put("uri", grant.uri)
        put("grantUri", grant.grantUri)
        put("name", grant.name)
        put("size", grant.size)
        put("mime", grant.mime)
        put("modifiedMs", grant.modifiedMs)
        put("createdMs", System.currentTimeMillis())
      }.toString()
    )
    if (editor == null && !destination.commit()) {
      throw NativeImportException("NATIVE_COMMAND_FAILED", "无法保存文件引用授权")
    }
    return grant
  }

  private fun referencePreferences() =
    activity.getSharedPreferences(REFERENCE_PREFS, Context.MODE_PRIVATE)

  private fun getReferenceGrant(referenceToken: String): ReferenceGrant {
    if (referenceToken.isBlank()) {
      throw NativeImportException("NATIVE_INVALID_DATA", "缺少文件引用令牌")
    }
    val raw = referencePreferences().getString(REFERENCE_PREFIX + referenceToken, null)
      ?: throw NativeImportException("NATIVE_REFERENCE_NOT_FOUND", "文件引用令牌不存在")
    val json = try {
      JSONObject(raw)
    } catch (_: Throwable) {
      throw NativeImportException("NATIVE_INVALID_DATA", "文件引用授权记录已损坏")
    }
    val uri = json.optString("uri", "")
    val grantUri = json.optString("grantUri", "")
    val name = json.optString("name", "")
    if (uri.isBlank() || grantUri.isBlank() || name.isBlank()) {
      throw NativeImportException("NATIVE_INVALID_DATA", "文件引用授权记录不完整")
    }
    return ReferenceGrant(
      token = referenceToken,
      uri = uri,
      grantUri = grantUri,
      name = name,
      size = json.optLong("size", 0L).coerceAtLeast(0L),
      mime = json.optString("mime", mimeFor(name)),
      modifiedMs = json.optLong("modifiedMs", 0L).coerceAtLeast(0L)
    )
  }

  private fun resolveReferenceBlocking(referenceToken: String): ResolvedReference {
    val grant = getReferenceGrant(referenceToken)
    val uri = contentUriOrThrow(grant.uri)
    val grantUri = contentUriOrThrow(grant.grantUri)
    if (!hasPersistedReadGrant(grantUri)) {
      throw NativeImportException(
        "NATIVE_REFERENCE_PERMISSION_LOST",
        "文件持久读取授权已失效，请重新选择原文件"
      )
    }

    val current = inspectImportUri(grant.uri)
    var seekable = false
    var descriptorSize = -1L
    try {
      activity.contentResolver.openFileDescriptor(uri, "r")?.let { descriptor ->
        descriptorSize = descriptor.statSize
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
          seekable = try {
            input.channel.position(0L)
            true
          } catch (_: Throwable) {
            false
          }
        }
      } ?: throw NativeImportException("NATIVE_COMMAND_FAILED", "无法打开文件引用")
    } catch (error: SecurityException) {
      throw NativeImportException("NATIVE_REFERENCE_PERMISSION_LOST", "文件读取授权已被撤销")
    } catch (error: NativeImportException) {
      throw error
    } catch (error: Throwable) {
      throw NativeImportException(
        "NATIVE_COMMAND_FAILED",
        error.message?.takeIf { it.isNotBlank() } ?: "无法打开文件引用"
      )
    }

    val sizeChanged = grant.size > 0L && current.size > 0L && grant.size != current.size
    val modifiedChanged = grant.modifiedMs > 0L && current.modifiedMs > 0L &&
      grant.modifiedMs != current.modifiedMs
    val resolvedSize = when {
      current.size > 0L -> current.size
      descriptorSize >= 0L -> descriptorSize
      else -> grant.size
    }
    return ResolvedReference(
      grant = grant,
      current = current,
      seekable = seekable,
      stale = sizeChanged || modifiedChanged,
      resolvedSize = resolvedSize
    )
  }

  private fun readReferenceBlocking(options: ReadReferenceOptions): JSObject {
    if (options.offset < 0L) {
      throw NativeImportException("NATIVE_INVALID_DATA", "引用读取偏移不能为负数")
    }
    if (options.length <= 0 || options.length > MAX_REFERENCE_CHUNK_BYTES) {
      throw NativeImportException(
        "NATIVE_LIMIT_EXCEEDED",
        "单次引用读取必须在 1 字节到 ${MAX_REFERENCE_CHUNK_BYTES} 字节之间"
      )
    }
    val resolved = resolveReferenceBlocking(options.referenceToken)
    if (resolved.stale) throw referenceStaleError()
    if (resolved.resolvedSize < options.length || options.offset > resolved.resolvedSize - options.length) {
      throw NativeImportException("NATIVE_INVALID_DATA", "引用读取范围越界")
    }
    if (!resolved.seekable) {
      throw NativeImportException("NATIVE_UNSUPPORTED", "文件提供方不支持有界随机读取")
    }

    val uri = contentUriOrThrow(resolved.grant.uri)
    val output = ByteArray(options.length)
    var total = 0
    try {
      activity.contentResolver.openFileDescriptor(uri, "r")?.let { descriptor ->
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
          input.channel.position(options.offset)
          while (total < output.size) {
            val read = input.read(output, total, output.size - total)
            if (read < 0) break
            if (read == 0) continue
            total += read
          }
        }
      } ?: throw NativeImportException("NATIVE_COMMAND_FAILED", "无法打开文件引用")
    } catch (error: NativeImportException) {
      throw error
    } catch (error: SecurityException) {
      throw NativeImportException("NATIVE_REFERENCE_PERMISSION_LOST", "文件读取授权已被撤销")
    } catch (error: Throwable) {
      throw NativeImportException(
        "NATIVE_UNSUPPORTED",
        error.message?.takeIf { it.isNotBlank() } ?: "文件提供方不支持有界读取"
      )
    }

    val bytes = if (total == output.size) output else output.copyOf(total)
    val end = options.offset + total
    return JSObject().apply {
      put("referenceToken", resolved.grant.token)
      put("offset", options.offset)
      put("length", total)
      put("size", resolved.resolvedSize)
      put("eof", resolved.resolvedSize > 0L && end >= resolved.resolvedSize)
      put("encoding", "base64")
      put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }
  }

  private fun hashReferenceBlocking(referenceToken: String, expectedUri: String?): JSObject {
    val grant = getReferenceGrant(referenceToken)
    if (!expectedUri.isNullOrBlank() && expectedUri != grant.uri) {
      throw NativeImportException("NATIVE_REFERENCE_MISMATCH", "引用令牌与 URI 不匹配")
    }
    val uri = contentUriOrThrow(grant.uri)
    val grantUri = contentUriOrThrow(grant.grantUri)
    if (!hasPersistedReadGrant(grantUri)) {
      throw NativeImportException("NATIVE_REFERENCE_PERMISSION_LOST", "文件持久读取授权已失效")
    }
    val current = inspectImportUri(grant.uri)
    if (current.size > MAX_IMPORT_ARCHIVE_BYTES) {
      throw NativeImportException("NATIVE_LIMIT_EXCEEDED", "文件超过 16 GiB，无法计算引用哈希")
    }

    val digest = java.security.MessageDigest.getInstance("SHA-256")
    var total = 0L
    try {
      activity.contentResolver.openInputStream(uri)?.use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          total += read
          if (total > MAX_IMPORT_ARCHIVE_BYTES) {
            throw NativeImportException("NATIVE_LIMIT_EXCEEDED", "文件超过 16 GiB，无法计算引用哈希")
          }
          digest.update(buffer, 0, read)
        }
      } ?: throw NativeImportException("NATIVE_COMMAND_FAILED", "无法打开文件引用")
    } catch (error: NativeImportException) {
      throw error
    } catch (error: SecurityException) {
      throw NativeImportException("NATIVE_REFERENCE_PERMISSION_LOST", "文件读取授权已被撤销")
    } catch (error: Throwable) {
      throw NativeImportException(
        "NATIVE_COMMAND_FAILED",
        error.message?.takeIf { it.isNotBlank() } ?: "无法计算文件引用哈希"
      )
    }

    val sha256 = digest.digest().joinToString("") { byte ->
      (byte.toInt() and 0xff).toString(16).padStart(2, '0')
    }
    val stale = grant.size > 0L && current.size > 0L && grant.size != current.size ||
      grant.modifiedMs > 0L && current.modifiedMs > 0L && grant.modifiedMs != current.modifiedMs
    return JSObject().apply {
      put("referenceToken", grant.token)
      put("uri", grant.uri)
      put("algorithm", "SHA-256")
      put("sha256", sha256)
      put("bytes", total)
      put("size", if (current.size > 0L) current.size else total)
      put("modifiedMs", current.modifiedMs)
      put("stale", stale)
    }
  }

  private fun referenceResultJson(resolved: ResolvedReference): JSObject {
    return JSObject().apply {
      put("referenceToken", resolved.grant.token)
      put("uri", resolved.grant.uri)
      put("name", resolved.current.name)
      put("size", resolved.resolvedSize)
      put("mime", resolved.current.mime)
      put("modifiedMs", resolved.current.modifiedMs)
      put("available", !resolved.stale)
      put("stale", resolved.stale)
      put("seekable", resolved.seekable)
      put("maxChunkBytes", MAX_REFERENCE_CHUNK_BYTES)
    }
  }

  private fun referenceGrantJson(grant: ReferenceGrant): JSObject {
    return JSObject().apply {
      put("uri", grant.uri)
      put("name", grant.name)
      put("size", grant.size)
      put("mime", grant.mime)
      put("modifiedMs", grant.modifiedMs)
      put("referenceToken", grant.token)
      put("referenceAvailable", true)
    }
  }

  private fun referenceUnavailableJson(rawUri: String, error: Throwable): JSObject {
    val metadata = inspectImportUri(rawUri)
    return JSObject().apply {
      put("uri", rawUri)
      put("name", metadata.name)
      put("size", metadata.size)
      put("mime", metadata.mime)
      put("modifiedMs", metadata.modifiedMs)
      put("referenceAvailable", false)
      put("referenceError", referenceErrorMessage(error))
    }
  }

  private fun referenceErrorMessage(error: Throwable): String {
    val nativeError = nativeImportError(error)
    return nativeError.message ?: "无法保存文件引用"
  }

  private fun releaseReferencesBlocking(referenceTokens: Array<String>): JSObject = synchronized(referenceLock) {
    if (referenceTokens.size > MAX_IMPORT_TREE_ENTRIES || referenceTokens.any { !it.startsWith("saf_") }) {
      throw NativeImportException("NATIVE_INVALID_DATA", "文件引用令牌无效或过多")
    }
    val preferences = referencePreferences()
    val keys = referenceTokens.mapTo(mutableSetOf()) { REFERENCE_PREFIX + it }
    val remaining = mutableSetOf<String>()
    val released = mutableSetOf<String>()
    for ((key, value) in preferences.all) {
      if (!key.startsWith(REFERENCE_PREFIX) || value !is String) continue
      val uri = try {
        JSONObject(value).optString("grantUri", "")
      } catch (_: Throwable) {
        ""
      }
      if (uri.isNotBlank()) (if (key in keys) released else remaining).add(uri)
    }
    val editor = preferences.edit()
    keys.forEach { editor.remove(it) }
    if (!editor.commit()) {
      throw NativeImportException("NATIVE_COMMAND_FAILED", "无法释放文件引用令牌")
    }
    for (uri in released - remaining) {
      try {
        activity.contentResolver.releasePersistableUriPermission(
          contentUriOrThrow(uri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      } catch (_: SecurityException) {}
    }
    JSObject().apply { put("released", true) }
  }

  private fun contentUriOrThrow(rawUri: String): Uri {
    val uri = try {
      Uri.parse(rawUri)
    } catch (_: Throwable) {
      Uri.EMPTY
    }
    if (!"content".equals(uri.scheme, ignoreCase = true)) {
      throw NativeImportException("NATIVE_INVALID_DATA", "文件引用必须是 content:// URI")
    }
    return uri
  }

  private fun isArchiveName(name: String): Boolean =
    name.endsWith(".epub", ignoreCase = true) ||
      name.endsWith(".cbz", ignoreCase = true) ||
      name.endsWith(".zip", ignoreCase = true)

  private fun referenceStaleError() = NativeImportException(
    "NATIVE_REFERENCE_STALE",
    "原文件大小或修改时间已变化，请先校验并重新关联"
  )

  private fun stageImportUriBlocking(options: StageImportUriOptions): JSObject {
    val uri = try {
      Uri.parse(options.uri)
    } catch (_: Throwable) {
      throw NativeImportException("NATIVE_INVALID_DATA", "导入 URI 无效")
    }
    if (!"content".equals(uri.scheme, ignoreCase = true)) {
      throw NativeImportException("NATIVE_UNSUPPORTED", "Android 原生导入只接受 content:// URI")
    }

    val metadata = inspectImportUri(options.uri)
    val safeName = safeImportFileName(options.name?.takeIf { it.isNotBlank() } ?: metadata.name)
    if (!isSupportedImportName(safeName)) {
      throw NativeImportException("NATIVE_INVALID_DATA", "不支持的导入文件格式")
    }
    val archive = safeName.endsWith(".epub", ignoreCase = true) ||
      safeName.endsWith(".cbz", ignoreCase = true) ||
      safeName.endsWith(".zip", ignoreCase = true)
    val maxBytes = if (archive) MAX_IMPORT_ARCHIVE_BYTES else MAX_IMPORT_FILE_BYTES
    val limitMessage = if (archive) "单个压缩包超过 16 GiB" else "单个导入文件超过 4 GiB"
    if (metadata.size > maxBytes) {
      throw NativeImportException("NATIVE_LIMIT_EXCEEDED", limitMessage)
    }

    val sourceRoot = File(activity.dataDir, SOURCE_ROOT)
    sourceRoot.mkdirs()
    val canonicalRoot = sourceRoot.canonicalFile
    val targetDir = File(canonicalRoot, safeBookSegment(options.bookId)).resolve("source")
    targetDir.mkdirs()
    val canonicalTargetDir = targetDir.canonicalFile
    if (
      canonicalTargetDir != canonicalRoot &&
      !canonicalTargetDir.path.startsWith(canonicalRoot.path + File.separator)
    ) {
      throw NativeImportException("NATIVE_SECURITY_LIMIT", "导入目标不在 HOMURA 存档目录内")
    }

    val target = File(canonicalTargetDir, safeName)
    val temporary = File(
      canonicalTargetDir,
      "$IMPORT_PART_PREFIX${UUID.randomUUID()}.part"
    )
    var copied = 0L

    try {
      val input = try {
        activity.contentResolver.openInputStream(uri)
      } catch (error: SecurityException) {
        throw NativeImportException("NATIVE_SECURITY_LIMIT", "没有读取所选文件的权限")
      } ?: throw NativeImportException("NATIVE_COMMAND_FAILED", "无法打开所选文件")

      input.use { stream ->
        FileOutputStream(temporary).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            copied += read
            if (copied > maxBytes) {
              throw NativeImportException("NATIVE_LIMIT_EXCEEDED", limitMessage)
            }
            output.write(buffer, 0, read)
          }
          output.flush()
          output.fd.sync()
        }
      }

      if (metadata.size > 0 && copied != metadata.size) {
        throw NativeImportException("NATIVE_COMMAND_FAILED", "复制后的文件大小不一致")
      }
      if (target.exists() && !target.delete()) {
        throw NativeImportException("NATIVE_COMMAND_FAILED", "无法替换旧导入文件")
      }
      if (!temporary.renameTo(target)) {
        throw NativeImportException("NATIVE_COMMAND_FAILED", "提交导入文件失败")
      }
      if (target.length() != copied) {
        target.delete()
        throw NativeImportException("NATIVE_COMMAND_FAILED", "原生存档回读大小不一致")
      }
    } catch (error: NativeImportException) {
      throw error
    } catch (error: SecurityException) {
      throw NativeImportException("NATIVE_SECURITY_LIMIT", error.message ?: "读取文件被拒绝")
    } catch (error: Throwable) {
      throw NativeImportException(
        "NATIVE_COMMAND_FAILED",
        error.message?.takeIf { it.isNotBlank() } ?: "复制导入文件失败"
      )
    } finally {
      temporary.delete()
    }

    return JSObject().apply {
      put(
        "nativePath",
        "$SOURCE_ROOT/${safeBookSegment(options.bookId)}/source/$safeName"
      )
      put("name", safeName)
      put("size", copied)
      put("modifiedMs", if (metadata.modifiedMs > 0) metadata.modifiedMs else target.lastModified())
    }
  }

  private fun nativeImportError(error: Throwable): Throwable {
    if (error is NativeImportException) {
      return IllegalStateException("${error.code}: ${error.message}")
    }
    if (error is SecurityException) {
      return IllegalStateException("NATIVE_SECURITY_LIMIT: ${error.message ?: "读取文件被拒绝"}")
    }
    return IllegalStateException(
      "NATIVE_COMMAND_FAILED: ${error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName}"
    )
  }

  private fun safeBookSegment(value: String): String {
    val segment = value
      .map { character ->
        if (character.isLetterOrDigit() && character.code < 128 || character in "._-") {
          character
        } else {
          '_'
        }
      }
      .take(160)
      .joinToString("")
    return if (segment.isBlank() || segment == "." || segment == "..") "book" else segment
  }

  private fun safeImportFileName(value: String): String {
    val base = value.replace('\\', '/').substringAfterLast('/')
    var segment = buildString {
      for (character in base) {
        append(
          if (character.isISOControl() || character in "/\\:*?\"<>|") '_' else character
        )
      }
    }.take(MAX_IMPORT_NAME_CHARS)
    if (segment.startsWith(".")) segment = "_" + segment.drop(1)
    return if (segment.isBlank() || segment == "." || segment == "..") "source" else segment
  }

  private fun isSupportedImportName(name: String): Boolean {
    return name.substringAfterLast('.', "").lowercase() in setOf(
      "epub", "pdf", "mobi", "prc", "azw", "cbz", "zip", "txt", "md",
      "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"
    )
  }

  private fun cleanupImportPartFiles() {
    try {
      val root = File(activity.dataDir, SOURCE_ROOT)
      if (!root.isDirectory) return
      root.walkTopDown()
        .filter {
          it.isFile &&
            it.name.startsWith(IMPORT_PART_PREFIX) &&
            it.name.endsWith(".part")
        }
        .forEach { it.delete() }
    } catch (_: Throwable) {
      // 清理失败不能影响插件初始化，下一次导入仍会覆盖同名 .part。
    }
  }

  private fun resolveArchiveFile(path: String): File {
    if (path.isBlank()) throw IllegalArgumentException("缺少压缩包路径")
    val dataRoot = activity.dataDir.canonicalFile
    val sourceRoot = File(dataRoot, SOURCE_ROOT).canonicalFile
    val candidate = if (File(path).isAbsolute) File(path) else File(dataRoot, path)
    val file = candidate.canonicalFile
    if (file != sourceRoot && !file.path.startsWith(sourceRoot.path + File.separator)) {
      throw SecurityException("压缩包路径不在 HOMURA 存档目录内")
    }
    if (!file.isFile) throw IllegalArgumentException("压缩包不存在")
    if (file.length() > MAX_IMPORT_ARCHIVE_BYTES) {
      throw IllegalStateException("NATIVE_LIMIT_EXCEEDED: 单个压缩包超过 16 GiB")
    }
    return file
  }

  private fun createSession(
    archiveId: String,
    zipFile: ZipFile,
    entries: List<ZipEntry>,
    sequentialPages: Boolean
  ): ArchiveSession {
    val indexByName = entries
      .mapIndexed { index, entry -> entry.name to index }
      .toMap()
    return ArchiveSession(archiveId, archiveId, zipFile, entries, indexByName, sequentialPages)
  }

  private fun readAllEntries(zipFile: ZipFile): List<ZipEntry> {
    val entries = mutableListOf<ZipEntry>()
    val enumeration = zipFile.entries()
    while (enumeration.hasMoreElements()) {
      val entry = enumeration.nextElement()
      if (!entry.isDirectory && !entry.name.contains("__MACOSX")) {
        entries.add(entry)
        if (entries.size > MAX_ENTRIES) throw IllegalStateException("压缩包条目数量过多")
      }
    }
    entries.sortWith { left, right -> naturalCompare(left.name, right.name) }
    return entries
  }

  private fun readImageEntries(zipFile: ZipFile): List<ZipEntry> {
    val entries = mutableListOf<ZipEntry>()
    val enumeration = zipFile.entries()
    while (enumeration.hasMoreElements()) {
      val entry = enumeration.nextElement()
      if (isImageEntry(entry)) {
        entries.add(entry)
        if (entries.size > MAX_ENTRIES) throw IllegalStateException("压缩包图片数量过多")
      }
    }
    entries.sortWith { left, right -> naturalCompare(left.name, right.name) }
    return entries
  }

  private fun isImageEntry(entry: ZipEntry): Boolean {
    if (entry.isDirectory || !IMAGE_NAME.matches(entry.name)) return false
    // macOS 打包残留不是页面：__MACOSX 目录、AppleDouble 文件与 .DS_Store 全部跳过
    return entry.name.split('/', '\\').none { segment ->
      segment == "__MACOSX" || segment == ".DS_Store" || segment.startsWith("._")
    }
  }

  private fun entryJson(
    entry: ZipEntry,
    index: Int,
    dimensions: Pair<Int, Int>? = null
  ): JSObject {
    return JSObject().apply {
      put("index", index)
      put("name", entry.name)
      put("path", entry.name)
      put("size", entry.size)
      put("mime", mimeFor(entry.name))
      if (dimensions != null && dimensions.first > 0 && dimensions.second > 0) {
        put("width", dimensions.first)
        put("height", dimensions.second)
      }
    }
  }

  // 只读图片头拿固有尺寸。条漫在图片懒加载前就能按真实比例占位，
  // 整卷高度不会随每一页解码完成而向上或向下生长。
  private fun readPageDimensions(zipFile: ZipFile, entries: List<ZipEntry>): List<Pair<Int, Int>> {
    return entries.map { entry ->
      if (!isImageEntry(entry) || entry.size > MAX_PAGE_BYTES) {
        Pair(0, 0)
      } else {
        try {
          val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          zipFile.getInputStream(entry).use { input ->
            BitmapFactory.decodeStream(input, null, options)
          }
          if (options.outWidth > 0 && options.outHeight > 0) {
            Pair(options.outWidth, options.outHeight)
          } else {
            Pair(0, 0)
          }
        } catch (_: Throwable) {
          Pair(0, 0)
        }
      }
    }
  }

  private fun readEntryBytes(
    session: ArchiveSession,
    entry: ZipEntry,
    maxBytes: Long
  ): ByteArray {
    if (entry.size > maxBytes) throw TextEntryTooLargeException()
    val initialSize = if (entry.size > 0) minOf(entry.size, 64L * 1024).toInt() else 8192
    val output = ByteArrayOutputStream(initialSize)
    session.zipFile.getInputStream(entry).use { input ->
      val buffer = ByteArray(32 * 1024)
      var total = 0L
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > maxBytes) throw TextEntryTooLargeException()
        output.write(buffer, 0, read)
      }
    }
    return output.toByteArray()
  }

  private fun replaceSession(session: ArchiveSession) {
    val previous = synchronized(sessions) {
      sessions.remove(session.id)
    }
    closeSessionHandle(previous)
    synchronized(sessions) {
      sessions[session.id] = session
    }
  }

  private fun closeSession(archiveId: String) {
    val session = synchronized(sessions) { sessions.remove(archiveId) }
    closeSessionHandle(session)
  }

  private fun closeSessionHandle(session: ArchiveSession?) {
    if (session == null) return
    synchronized(session.lock) {
      session.zipFile.close()
    }
  }

  private fun closeBookSessions(bookId: String) {
    val removed = synchronized(sessions) {
      val ids = sessions.values.filter { it.bookId == bookId }.map { it.id }
      ids.mapNotNull { sessions.remove(it) }
    }
    removed.forEach(::closeSessionHandle)
  }

  private fun closeAllSessions() {
    val removed = synchronized(sessions) {
      val all = sessions.values.toList()
      sessions.clear()
      all
    }
    removed.forEach(::closeSessionHandle)
  }

  private fun cacheDirFor(bookId: String): File {
    val safeBookId = bookId.replace(Regex("[^A-Za-z0-9._-]"), "_").take(160)
    return File(File(activity.cacheDir, CACHE_ROOT), safeBookId.ifEmpty { "book" })
  }

  private fun safeExtension(entryName: String): String {
    val extension = entryName.substringAfterLast('.', "img").lowercase()
    return when (extension) {
      "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp" -> extension
      else -> "img"
    }
  }

  private fun cachedPageFile(dir: File, base: String, entryName: String): File? {
    val webp = File(dir, "$base.webp")
    if (webp.isFile && webp.length() > 0L) return webp
    // -raw 前缀用来区分旧版直接缓存的 00001.jpg，避免升级后继续吃全尺寸旧缓存
    val original = File(dir, "$base-raw.${safeExtension(entryName)}")
    if (original.isFile && original.length() > 0L) return original
    return null
  }

  private fun ensurePageFile(session: ArchiveSession, index: Int): JSObject {
    val entry = session.entries.getOrNull(index)
      ?: throw IllegalStateException("页面索引越界")
    val dir = cacheDirFor(session.bookId)
    val base = "%05d".format(index)
    val cached = cachedPageFile(dir, base, entry.name)
    if (cached != null) {
      cached.setLastModified(System.currentTimeMillis())
      return pageJson(cached)
    }

    dir.mkdirs()
    val source = File(dir, "$base.src")
    val target = File(dir, "$base.webp")
    val temporary = File(dir, "$base.webp.part")
    try {
      extractEntry(session, entry, source)
      if (transcodePage(source, temporary, entry.name)) {
        if (target.exists() && !target.delete()) throw IllegalStateException("无法替换页面缓存")
        if (!temporary.renameTo(target)) {
          temporary.copyTo(target, overwrite = true)
          temporary.delete()
        }
        target.setLastModified(System.currentTimeMillis())
        return pageJson(target)
      }

      // 动图或当前系统不支持解码的格式：保留原图，行为与旧版一致
      val fallback = File(dir, "$base-raw.${safeExtension(entry.name)}")
      if (fallback.exists() && !fallback.delete()) throw IllegalStateException("无法替换页面缓存")
      if (!source.renameTo(fallback)) {
        source.copyTo(fallback, overwrite = true)
      }
      fallback.setLastModified(System.currentTimeMillis())
      return pageJson(fallback)
    } finally {
      source.delete()
      temporary.delete()
    }
  }

  private fun pageJson(file: File): JSObject {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    try {
      BitmapFactory.decodeFile(file.path, bounds)
    } catch (_: Throwable) {
      // 尺寸只用于调试，读不出来不影响显示
    }
    return JSObject().apply {
      put("path", file.absolutePath)
      put("mime", mimeFor(file.name))
      put("size", file.length())
      if (bounds.outWidth > 0) put("width", bounds.outWidth)
      if (bounds.outHeight > 0) put("height", bounds.outHeight)
    }
  }

  private fun pageTargetEdge(): Int {
    val metrics = activity.resources.displayMetrics
    return max(metrics.widthPixels, metrics.heightPixels).coerceIn(MIN_PAGE_EDGE, MAX_PAGE_EDGE)
  }

  // 返回 false 表示这张图不能安全转码（GIF / 未知格式），调用方保留原图
  private fun transcodePage(source: File, target: File, entryName: String): Boolean {
    if (entryName.endsWith(".gif", ignoreCase = true)) return false

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    val sourceWidth = bounds.outWidth
    val sourceHeight = bounds.outHeight
    if (sourceWidth <= 0 || sourceHeight <= 0) return false

    val edge = pageTargetEdge()
    var sampleSize = 1
    while (max(sourceWidth, sourceHeight) / (sampleSize * 2) >= edge) sampleSize *= 2

    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = try {
      BitmapFactory.decodeFile(source.path, options)
    } catch (_: Throwable) {
      null
    } ?: return false

    var output: Bitmap = decoded
    try {
      val scale = min(1f, edge.toFloat() / max(decoded.width, decoded.height))
      if (scale < 1f) {
        output = Bitmap.createScaledBitmap(
          decoded,
          max(1, (decoded.width * scale).roundToInt()),
          max(1, (decoded.height * scale).roundToInt()),
          true
        )
      }
      val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Bitmap.CompressFormat.WEBP_LOSSY
      } else {
        @Suppress("DEPRECATION")
        Bitmap.CompressFormat.WEBP
      }
      val written = FileOutputStream(target).use { stream ->
        output.compress(format, PAGE_WEBP_QUALITY, stream)
      }
      return written && target.length() > 0L
    } catch (_: Throwable) {
      return false
    } finally {
      if (output !== decoded) output.recycle()
      decoded.recycle()
    }
  }

  // 当前页解完后，在独立线程提前转码后两页；翻过去时直接命中缓存
  private fun schedulePrefetch(session: ArchiveSession, currentIndex: Int) {
    // 文档模式的 index 是 ZIP 条目索引，不是阅读页序，预取会转码无关页并占用会话锁
    if (!session.sequentialPages) return
    val generation = (prefetchGenerations[session.bookId] ?: 0) + 1
    prefetchGenerations[session.bookId] = generation
    val archiveId = session.id
    prefetchExecutor.execute {
      for (offset in 1..PREFETCH_AHEAD) {
        val index = currentIndex + offset
        if (index >= session.entries.size) return@execute
        if (prefetchGenerations[session.bookId] != generation) return@execute
        if (synchronized(sessions) { sessions[archiveId] } !== session) return@execute
        try {
          synchronized(session.lock) {
            if (prefetchGenerations[session.bookId] != generation) return@synchronized
            ensurePageFile(session, index)
          }
        } catch (_: Throwable) {
          // 预取失败不影响当前阅读，真正翻到该页时会再试
        }
      }
    }
  }

  private fun extractEntry(session: ArchiveSession, entry: ZipEntry, cacheFile: File) {
    val declaredSize = entry.size
    if (declaredSize > MAX_PAGE_BYTES) throw IllegalStateException("单页图片过大")
    cacheFile.parentFile?.mkdirs()
    val temporary = File(cacheFile.parentFile, cacheFile.name + ".part")
    temporary.delete()
    try {
      session.zipFile.getInputStream(entry).use { input ->
        FileOutputStream(temporary).use { output ->
          val buffer = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_PAGE_BYTES) throw IllegalStateException("单页图片解压后过大")
            output.write(buffer, 0, read)
          }
        }
      }
      if (cacheFile.exists() && !cacheFile.delete()) {
        throw IllegalStateException("无法替换页面缓存")
      }
      if (!temporary.renameTo(cacheFile)) {
        temporary.copyTo(cacheFile, overwrite = true)
        temporary.delete()
      }
      cacheFile.setLastModified(System.currentTimeMillis())
    } finally {
      temporary.delete()
    }
  }

  private fun trimCache(bookId: String) {
    val files = cacheDirFor(bookId)
      .listFiles { file -> file.isFile && !file.name.endsWith(".part") && !file.name.endsWith(".src") }
      ?.sortedBy { it.lastModified() }
      ?: return
    var total = files.sumOf { it.length() }
    var count = files.size
    // 按最近访问时间淘汰，不能按文件序号划窗口：
    // EPUB 的图片条目顺序和实际阅读页序无关，按序号删会误伤刚看过的相邻页。
    for (file in files) {
      if (count <= MAX_CACHE_FILES && total <= MAX_CACHE_BYTES) break
      val size = file.length()
      if (file.delete()) {
        total -= size
        count -= 1
      }
    }
  }

  private fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "webp" -> "image/webp"
    "gif" -> "image/gif"
    "avif" -> "image/avif"
    "bmp" -> "image/bmp"
    "xhtml", "html", "htm" -> "application/xhtml+xml"
    "xml", "opf", "ncx" -> "application/xml"
    "css" -> "text/css"
    else -> "application/octet-stream"
  }

  private fun naturalCompare(left: String, right: String): Int {
    var leftIndex = 0
    var rightIndex = 0
    while (leftIndex < left.length && rightIndex < right.length) {
      val leftChar = left[leftIndex]
      val rightChar = right[rightIndex]
      if (leftChar.isDigit() && rightChar.isDigit()) {
        val leftStart = leftIndex
        val rightStart = rightIndex
        while (leftIndex < left.length && left[leftIndex].isDigit()) leftIndex++
        while (rightIndex < right.length && right[rightIndex].isDigit()) rightIndex++
        val leftNumber = left.substring(leftStart, leftIndex).trimStart('0').ifEmpty { "0" }
        val rightNumber = right.substring(rightStart, rightIndex).trimStart('0').ifEmpty { "0" }
        val lengthCompare = leftNumber.length.compareTo(rightNumber.length)
        if (lengthCompare != 0) return lengthCompare
        val numberCompare = leftNumber.compareTo(rightNumber)
        if (numberCompare != 0) return numberCompare
      } else {
        val leftLower = leftChar.lowercaseChar()
        val rightLower = rightChar.lowercaseChar()
        if (leftLower != rightLower) return leftLower.compareTo(rightLower)
        leftIndex++
        rightIndex++
      }
    }
    return (left.length - leftIndex).compareTo(right.length - rightIndex)
  }
}
