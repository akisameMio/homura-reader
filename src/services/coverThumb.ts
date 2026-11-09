/* ============================================================================
   HOMURA · 书架封面缩略图
   ----------------------------------------------------------------------------
   书架卡片最大只显示到 220px 左右，直接解码整张原图会让安卓 WebView
   为几十本书各占一份大位图。这里把封面缩到最长边 480px 再落盘。
   Tauri 环境优先交给 Rust 的 image 解码与缩放；浏览器或原生不支持该格式时，
   回退到原来的 Canvas / OffscreenCanvas 实现。
   ========================================================================== */

import {
  NativeErrorCode,
  bytesToBase64,
  canUseNativeBridge,
  disableNativeFeature,
  invokeNativeCommand,
  type NativeErrorCodeValue
} from './nativeRuntime.ts';

const COVER_MAX_EDGE = 480;
const WEBP_QUALITY = 0.84;
const FEATURE = 'cover-thumb';
const MAX_NATIVE_COVER_BYTES = 20 * 1024 * 1024;

function encodeCanvas(canvas: OffscreenCanvas | HTMLCanvasElement) {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  }
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
}

function base64ToBlob(value: string, mime: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime || 'image/webp' });
}

function resultToBlob(result: unknown, original: Blob) {
  if (!result || typeof result !== 'object') return null;
  const detail = result as { changed?: unknown; bytesBase64?: unknown; mime?: string };
  if (!detail.changed) return original;
  if (typeof detail.bytesBase64 !== 'string' || !detail.bytesBase64) return null;
  return base64ToBlob(detail.bytesBase64, detail.mime || 'image/webp');
}

function handleNativeFailure(err: unknown) {
  const detail = err as { code?: NativeErrorCodeValue; message?: string };
  const code = detail?.code;
  if (code === NativeErrorCode.UNAVAILABLE || code === NativeErrorCode.DISABLED) {
    disableNativeFeature(FEATURE, String(detail?.message || ''));
  }
  // 安全上限不能交给 JS 再试一次；普通格式不支持或解码失败则继续兜底。
  if (code === NativeErrorCode.SECURITY_LIMIT || code === NativeErrorCode.LIMIT_EXCEEDED) throw err;
}

async function createWithNative(blob: Blob, maxEdge: number) {
  if (!canUseNativeBridge() || blob.size > MAX_NATIVE_COVER_BYTES) return null;
  try {
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    if (!base64) return null;
    const result = await invokeNativeCommand(
      null,
      'create_cover_thumbnail',
      { bytesBase64: base64, maxEdge },
      { feature: FEATURE }
    );
    return resultToBlob(result, blob);
  } catch (err) {
    handleNativeFailure(err);
    return null;
  }
}

// 原生压缩包已经在 AppData 里，直接按条目路径读取封面，避免大图从 Blob
// 转成 Base64 再走一遍 IPC。输出仍用 Base64 返回，缩略图只有几十 KB。
async function createWithNativeArchive(blob: Blob, maxEdge: number, nativeCover: { archivePath?: string; entryPath?: string } | null) {
  if (
    !canUseNativeBridge()
    || !nativeCover?.archivePath
    || !nativeCover?.entryPath
    || blob?.size > MAX_NATIVE_COVER_BYTES
  ) return null;
  try {
    const result = await invokeNativeCommand(
      null,
      'create_cover_thumbnail_from_archive',
      {
        archivePath: nativeCover.archivePath,
        entryPath: nativeCover.entryPath,
        maxEdge
      },
      { feature: FEATURE }
    );
    return resultToBlob(result, blob);
  } catch (err) {
    handleNativeFailure(err);
    return null;
  }
}

// 返回 null 表示当前环境无法处理；返回原 Blob 表示无需缩小。
export async function createCoverThumbnailWithCanvas(blob: Blob | null, maxEdge = COVER_MAX_EDGE) {
  // JSZip 解出的图片 Blob 常常没有 MIME type，交给 createImageBitmap 按内容判断。
  if (!blob || typeof blob.size !== 'number' || (blob.type && !String(blob.type).startsWith('image/'))) return null;
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const width = bitmap.width || 0;
    const height = bitmap.height || 0;
    if (!width || !height) return null;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale >= 1) return blob;

    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(targetWidth, targetHeight);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const thumbnail = await encodeCanvas(canvas);
    if (!thumbnail || thumbnail.size >= (blob as Blob).size * 0.92) return blob;
    return thumbnail;
  } catch (err) {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

export async function createCoverThumbnail(blob: Blob | null, maxEdge = COVER_MAX_EDGE, nativeCover: { archivePath?: string; entryPath?: string } | null = null) {
  const validBlob = !!blob
    && typeof blob.size === 'number'
    && (!blob.type || String(blob.type).startsWith('image/'));
  if (!validBlob && !(nativeCover?.archivePath && nativeCover?.entryPath)) return null;
  if (nativeCover) {
    try {
      const viaArchive = await createWithNativeArchive(blob as Blob, maxEdge, nativeCover);
      if (viaArchive) return viaArchive;
    } catch (err) {
      return null;
    }
  }
  if (!validBlob) return null;
  let native = null;
  try {
    native = await createWithNative(blob, maxEdge);
  } catch (err) {
    return null;
  }
  if (native) return native;
  return createCoverThumbnailWithCanvas(blob, maxEdge);
}
