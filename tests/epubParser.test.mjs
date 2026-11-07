import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import {
  createNativeMangaManifest,
  createNativeEpubArchive,
  createJsZipEpubArchive,
  isNativeMangaManifestValid,
  parseEpubArchive,
  parseEpubFile,
  parseEpubNativeArchive
} from '../src/services/epubParser.js';
import { closeNativeArchive, isNativeArchiveSessionOpen } from '../src/services/nativeArchive.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('漫画 EPUB 页清单只保存原生条目索引与尺寸', () => {
  const manifest = createNativeMangaManifest({
    type: 'manga',
    format: 'epub',
    pageItems: [
      { nativeIndex: 12, imageWidth: 1200, imageHeight: 1800, url: 'blob:page' },
      { nativeIndex: 19, imageWidth: 960, imageHeight: 1280 }
    ]
  });

  assert.deepEqual(manifest, {
    version: 1,
    pageCount: 2,
    items: [
      { index: 12, width: 1200, height: 1800 },
      { index: 19, width: 960, height: 1280 }
    ]
  });
  assert.equal(isNativeMangaManifestValid(manifest), true);
  assert.equal(isNativeMangaManifestValid({
    version: 1,
    items: [{ index: -1, width: 1, height: 1 }]
  }), false);
  assert.equal(createNativeMangaManifest({
    type: 'manga',
    format: 'epub',
    pageItems: [{ zipEntry: {}, url: 'blob:page' }]
  }), null);
  assert.equal(createNativeMangaManifest({
    type: 'epub',
    format: 'epub',
    pageItems: [{ nativeIndex: 1 }]
  }), null);
});

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }[char]));
}

function buildOpf({ title, items, metadata = '', guide = '' }) {
  const manifest = items.map(item => (
    `<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${escapeXml(item.mediaType)}"${item.properties ? ` properties="${escapeXml(item.properties)}"` : ''}/>`
  )).join('');
  const spine = items
    .filter(item => item.spine)
    .map(item => `<itemref idref="${escapeXml(item.id)}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">homura-test</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    ${metadata}
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
  ${guide ? `<guide>${guide}</guide>` : ''}
</package>`;
}

async function buildEpub({
  title = '测试书',
  opfPath = 'OEBPS/content.opf',
  containerOpfPath = opfPath,
  items = [],
  metadata = '',
  guide = '',
  includeContainer = true
} = {}) {
  const zip = new JSZip();
  const entries = new Map();
  const addEntry = (path, content) => {
    const bytes = typeof content === 'string' ? encoder.encode(content) : content;
    entries.set(path, bytes);
    zip.file(path, bytes);
  };

  addEntry('mimetype', 'application/epub+zip');
  if (includeContainer) {
    addEntry('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${escapeXml(containerOpfPath)}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  }
  addEntry(opfPath, buildOpf({ title, items, metadata, guide }));
  for (const item of items) {
    addEntry(item.path, item.content);
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, entries };
}

function imageItem(id, href, path, spine = false) {
  return {
    id,
    href,
    path,
    spine,
    mediaType: 'image/jpeg',
    content: new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  };
}

function xhtmlItem(id, href, path, body, spine = true) {
  return {
    id,
    href,
    path,
    spine,
    mediaType: 'application/xhtml+xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(id)}</title></head><body>${body}</body></html>`
  };
}

function releaseBookUrls(book) {
  const urls = new Set([book?.cover, ...(book?.pageItems || []).map(item => item.url)]);
  for (const url of urls) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

function epubFile(epub, name = 'fixture.epub') {
  return new File([epub.bytes], name, { type: 'application/epub+zip' });
}

test('图片型 EPUB 按 spine 顺序生成漫画页', async () => {
  const epub = await buildEpub({
    title: '漫画样本',
    items: [
      xhtmlItem('p1', 'Text/001.xhtml', 'OEBPS/Text/001.xhtml', '<img src="../Images/001.jpg" alt=""/>'),
      xhtmlItem('p2', 'Text/002.xhtml', 'OEBPS/Text/002.xhtml', '<img src="../Images/002.jpg" alt=""/>'),
      xhtmlItem('p3', 'Text/003.xhtml', 'OEBPS/Text/003.xhtml', '<img src="../Images/003.jpg" alt=""/>'),
      imageItem('i1', 'Images/001.jpg', 'OEBPS/Images/001.jpg'),
      imageItem('i2', 'Images/002.jpg', 'OEBPS/Images/002.jpg'),
      imageItem('i3', 'Images/003.jpg', 'OEBPS/Images/003.jpg')
    ]
  });
  const book = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-manga', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(book.type, 'manga');
    assert.equal(book.format, 'epub');
    assert.equal(book.title, '漫画样本');
    assert.equal(book.pageCount, 3);
    assert.deepEqual(
      book.pageItems.map(item => item.zipEntry.name),
      [
        'OEBPS/Images/001.jpg',
        'OEBPS/Images/002.jpg',
        'OEBPS/Images/003.jpg'
      ]
    );
    assert.equal(book.pageItems[0].url, book.cover);
    assert.equal(book.pageItems[1].url, null);
    assert.equal(book.coverBlob.size, 4);
    assert.ok(book.zipContent);
  } finally {
    releaseBookUrls(book);
  }
});

test('小说保留章节、清洗危险 HTML，并解析 ../ 插图路径', async () => {
  const longText = '这是一段足够长的正文。'.repeat(12);
  const epub = await buildEpub({
    title: '测试小说',
    items: [
      xhtmlItem(
        'c1',
        'Text/chapter1.xhtml',
        'OEBPS/Text/chapter1.xhtml',
        `<h1>第一章</h1><p>${longText}</p>
<img src="../Images/illustration.jpg" onclick="alert(1)" alt="插图"/>
<script>alert('bad')</script><a href="javascript:alert(2)">危险链接</a>`
      ),
      xhtmlItem(
        'c2',
        'Text/chapter2.xhtml',
        'OEBPS/Text/chapter2.xhtml',
        `<h2>第二章</h2><p>${longText}</p>`
      ),
      imageItem('cover', 'Images/illustration.jpg', 'OEBPS/Images/illustration.jpg')
    ]
  });
  const book = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-novel', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(book.type, 'epub');
    assert.equal(book.title, '测试小说');
    assert.equal(book.pageCount, 2);
    assert.deepEqual(book.chapters.map(chapter => chapter.title), ['第一章', '第二章']);
    assert.match(book.chapters[0].htmlContent, /data-zip-path="OEBPS\/Images\/illustration\.jpg"/);
    assert.doesNotMatch(book.chapters[0].htmlContent, /<script|onclick|javascript:/i);
    assert.ok(book.zipContent);
  } finally {
    releaseBookUrls(book);
  }
});

test('URL 编码的 OPF 与章节路径可正常解析', async () => {
  const epub = await buildEpub({
    title: '编码路径',
    opfPath: 'OEBPS/content book.opf',
    containerOpfPath: 'OEBPS/content%20book.opf',
    items: [
      xhtmlItem(
        'c1',
        'Text/ch%201.xhtml',
        'OEBPS/Text/ch 1.xhtml',
        '<h1>编码章节</h1><p>正文</p>'
      )
    ]
  });
  const book = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-encoded', fallbackTitle: '文件名' }
  );

  assert.equal(book.title, '编码路径');
  assert.equal(book.pageCount, 1);
  assert.equal(book.chapters[0].title, '编码章节');
});

test('缺少 container.xml 或 OPF 时明确失败', async () => {
  const noContainer = await buildEpub({
    includeContainer: false,
    items: [xhtmlItem('c1', 'Text/chapter.xhtml', 'OEBPS/Text/chapter.xhtml', '<p>正文</p>')]
  });
  await assert.rejects(
    parseEpubArchive(
      await createJsZipEpubArchive(noContainer.bytes),
      { id: 'epub-no-container' }
    ),
    /缺少 META-INF\/container\.xml/
  );

  const noOpf = await buildEpub({
    containerOpfPath: 'OEBPS/missing.opf',
    items: [xhtmlItem('c1', 'Text/chapter.xhtml', 'OEBPS/Text/chapter.xhtml', '<p>正文</p>')]
  });
  await assert.rejects(
    parseEpubArchive(
      await createJsZipEpubArchive(noOpf.bytes),
      { id: 'epub-no-opf' }
    ),
    /未找到 OPF 配置文件/
  );
});

test('原生文档条目映射为可恢复的漫画页索引', async () => {
  const archiveId = 'epub-native-pages';
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          return {
            archiveId: args.archiveId,
            entries: [
              { index: 0, path: 'OEBPS/Text/001.xhtml', name: 'OEBPS/Text/001.xhtml', size: 20 },
              { index: 1, path: 'OEBPS/Images/001.jpg', name: 'OEBPS/Images/001.jpg', size: 4 }
            ]
          };
        }
        if (name === 'close') return null;
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  const nativePath = 'homura-native-sources/epub-native-pages/source/book.epub';
  const archive = await createNativeEpubArchive(nativePath, { id: archiveId });
  try {
    assert.deepEqual(archive.makePageItem('OEBPS/Images/001.jpg', null), {
      nativeArchiveId: archiveId,
      nativeArchivePath: nativePath,
      nativeIndex: 1,
      url: null
    });
    assert.equal(archive.bookFields().nativeEntryIndexByPath.get('OEBPS/Images/001.jpg'), 1);
  } finally {
    await closeNativeArchive(archiveId);
  }
});

test('Android 原生 EPUB 可用时优先使用原生解析', async () => {
  const epub = await buildEpub({
    title: '原生优先',
    items: [
      xhtmlItem('c1', 'Text/chapter.xhtml', 'OEBPS/Text/chapter.xhtml', '<h1>原生章节</h1><p>正文</p>')
    ]
  });
  const entries = Array.from(epub.entries.entries());
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          return {
            archiveId: args.archiveId,
            entries: entries.map(([path, bytes], index) => ({
              index,
              path,
              name: path,
              size: bytes.length
            }))
          };
        }
        if (name === 'readTextBatch') {
          const requested = JSON.parse(args.pathsJson);
          return {
            texts: requested.flatMap(path => {
              const bytes = epub.entries.get(path);
              return bytes ? [{ path, text: decoder.decode(bytes), size: bytes.length }] : [];
            })
          };
        }
        if (name === 'close') return null;
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  const id = 'epub-native-preferred';
  const book = await parseEpubFile(epubFile(epub), {
    id,
    name: '原生优先.epub',
    nativePath: 'homura-native-sources/epub-native-preferred/source/book.epub'
  });
  try {
    assert.equal(book.nativeArchiveId, id);
    assert.equal(book.chapters[0].title, '原生章节');
    assert.equal(book.zipContent, undefined);
  } finally {
    releaseBookUrls(book);
    await closeNativeArchive(id);
  }
});

test('原生 EPUB 打开失败时回退 JSZip 且不留下会话', async () => {
  const epub = await buildEpub({
    title: '回退小说',
    items: [
      xhtmlItem('c1', 'Text/chapter.xhtml', 'OEBPS/Text/chapter.xhtml', '<h1>回退章节</h1><p>正文</p>')
    ]
  });
  let openAttempts = 0;
  const lifecycleCalls = [];
  dom.window.__TAURI__ = {
    core: {
      invoke: async command => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          openAttempts++;
          throw new Error('ZipFile 打开失败');
        }
        if (name === 'close' || name === 'clearBook') {
          lifecycleCalls.push(name);
          return null;
        }
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  const book = await parseEpubFile(epubFile(epub), {
    id: 'epub-native-fallback',
    nativePath: 'homura-native-sources/epub-native-fallback/source/book.epub'
  });
  try {
    assert.equal(openAttempts, 1);
    assert.equal(book.title, '回退小说');
    assert.equal(book.chapters[0].title, '回退章节');
    assert.ok(book.zipContent);
    assert.equal(book.nativeArchiveId, undefined);
    assert.deepEqual(lifecycleCalls, ['close', 'clearBook']);
  } finally {
    releaseBookUrls(book);
  }
});

test('原生 EPUB 路径越界不会回退 JSZip', async () => {
  const epub = await buildEpub({
    items: [
      xhtmlItem('c1', 'Text/chapter.xhtml', 'OEBPS/Text/chapter.xhtml', '<h1>不应读取</h1>')
    ]
  });
  dom.window.__TAURI__ = {
    core: {
      invoke: async command => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          throw 'NATIVE_SECURITY_LIMIT: 压缩包路径不在 HOMURA 存档目录内';
        }
        if (name === 'close' || name === 'clearBook') return null;
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  try {
    await assert.rejects(
      parseEpubFile(epubFile(epub), {
        id: 'epub-native-security',
        nativePath: '../outside/book.epub'
      }),
      error => error.code === 'NATIVE_SECURITY_LIMIT'
    );
    await assert.rejects(
      parseEpubFile(epubFile(epub), {
        id: 'epub-native-security-metadata',
        nativePath: '../outside/book.epub',
        metadataOnly: true
      }),
      error => error.code === 'NATIVE_SECURITY_LIMIT'
    );
  } finally {
    delete dom.window.__TAURI__;
  }
});

test('原生文本被批次上限截断时递归补读剩余章节', async () => {
  const archiveId = 'epub-native-batched-text';
  const paths = Array.from({ length: 5 }, (_, index) => `OEBPS/Text/chapter-${index + 1}.xhtml`);
  let readCalls = 0;
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          return {
            archiveId: args.archiveId,
            entries: paths.map((path, index) => ({
              index,
              path,
              name: path,
              size: 20
            }))
          };
        }
        if (name === 'readTextBatch') {
          readCalls++;
          const requested = JSON.parse(args.pathsJson);
          return {
            texts: requested.slice(0, 1).map(path => ({
              path,
              text: `正文 ${path}`,
              size: 20
            }))
          };
        }
        if (name === 'close') return null;
        throw new Error(`未模拟原命令：${name}`);
      }
    }
  };

  const archive = await createNativeEpubArchive('book.epub', { id: archiveId });
  try {
    const texts = await archive.readTexts(paths);
    assert.deepEqual(texts, paths.map(path => `正文 ${path}`));
    assert.ok(readCalls > 1);
  } finally {
    await closeNativeArchive(archiveId);
  }
});

test('原生 EPUB 解析与 JSZip 保持相同的章节结果', async () => {
  const epub = await buildEpub({
    title: '双后端小说',
    items: [
      xhtmlItem(
        'c1',
        'Text/chapter1.xhtml',
        'OEBPS/Text/chapter1.xhtml',
        '<h1>原生第一章</h1><p>第一段正文。</p>'
      ),
      xhtmlItem(
        'c2',
        'Text/chapter2.xhtml',
        'OEBPS/Text/chapter2.xhtml',
        '<h2>原生第二章</h2><p>第二段正文。</p>'
      )
    ]
  });
  const jsZipBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-jszip-parity', fallbackTitle: '文件名' }
  );

  const entries = Array.from(epub.entries.entries());
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          return {
            archiveId: args.archiveId,
            entries: entries.map(([path, bytes], index) => ({
              index,
              path,
              name: path,
              size: bytes.length
            }))
          };
        }
        if (name === 'readTextBatch') {
          const requested = JSON.parse(args.pathsJson);
          return {
            texts: requested.flatMap(path => {
              const bytes = epub.entries.get(path);
              return bytes ? [{ path, text: decoder.decode(bytes), size: bytes.length }] : [];
            })
          };
        }
        if (name === 'close' || name === 'clearBook') return null;
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  const nativeId = 'epub-native-parity';
  const nativeBook = await parseEpubNativeArchive(
    'homura-native-sources/epub-native-parity/source/book.epub',
    { id: nativeId, name: '原生文件名.epub' }
  );

  try {
    const shape = book => ({
      type: book.type,
      format: book.format,
      title: book.title,
      pageCount: book.pageCount,
      chapters: book.chapters.map(chapter => ({
        title: chapter.title,
        htmlContent: chapter.htmlContent
      }))
    });
    assert.deepEqual(shape(nativeBook), shape(jsZipBook));
    assert.equal(nativeBook.nativeArchiveId, nativeId);
    assert.equal(nativeBook.nativeArchivePath, 'homura-native-sources/epub-native-parity/source/book.epub');
    assert.equal(nativeBook.nativeEntryIndexByPath instanceof Map, true);
    assert.equal(nativeBook.nativeEntryIndexByPath.get('OEBPS/Text/chapter1.xhtml'), 3);
    assert.equal(nativeBook.nativeEntryIndexByPath.get('OEBPS/Text/chapter2.xhtml'), 4);
    assert.equal(nativeBook.zipContent, undefined);
  } finally {
    releaseBookUrls(jsZipBook);
    releaseBookUrls(nativeBook);
    await closeNativeArchive(nativeId);
  }
});

test('metadataOnly 对长篇漫画只稀疏读取 spine，并优先使用 OPF 封面', async () => {
  const items = [];
  for (let index = 0; index < 80; index++) {
    const page = String(index + 1).padStart(3, '0');
    items.push(
      xhtmlItem(
        `p${index}`,
        `Text/page-${page}.xhtml`,
        `OEBPS/Text/page-${page}.xhtml`,
        `<img src="../Images/page-${page}.jpg" alt=""/>`
      ),
      imageItem(`i${index}`, `Images/page-${page}.jpg`, `OEBPS/Images/page-${page}.jpg`)
    );
  }
  items.push({
    ...imageItem('cover-art', 'Images/opf-cover.jpg', 'OEBPS/Images/opf-cover.jpg'),
    properties: 'cover-image',
    content: new Uint8Array([9, 8, 7, 6, 5])
  });
  const epub = await buildEpub({ title: '长篇漫画', items });
  const archive = await createJsZipEpubArchive(epub.bytes);
  const originalReadTexts = archive.readTexts.bind(archive);
  let spineTextReads = 0;
  archive.readTexts = async paths => {
    spineTextReads += paths.filter(path => /\.xhtml$/i.test(path)).length;
    return originalReadTexts(paths);
  };

  const metadataBook = await parseEpubArchive(archive, {
    id: 'epub-metadata-manga',
    fallbackTitle: '文件名',
    metadataOnly: true
  });
  const fullBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-full-manga', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(metadataBook.metadataOnly, true);
    assert.equal(metadataBook.type, 'manga');
    assert.equal(metadataBook.chapters, null);
    assert.equal(metadataBook.pageItems, null);
    assert.ok(metadataBook.pageCount >= 80);
    assert.equal(metadataBook.coverBlob.size, 5);
    assert.ok(spineTextReads < 20, `spine 读取 ${spineTextReads} 页，没有保持稀疏采样`);
    assert.equal(fullBook.type, metadataBook.type);
    assert.equal(fullBook.pageCount, 80);
  } finally {
    releaseBookUrls(metadataBook);
    releaseBookUrls(fullBook);
  }
});

test('metadataOnly 不会把大量彩插的轻小说误判成漫画', async () => {
  const longText = '这是轻小说正文，虽然有很多整页彩插，但文字章节仍然占绝大多数。'.repeat(4);
  const items = [];
  for (let index = 0; index < 30; index++) {
    const page = String(index + 1).padStart(3, '0');
    if (index < 4) {
      items.push(
        xhtmlItem(
          `p${index}`,
          `Text/page-${page}.xhtml`,
          `OEBPS/Text/page-${page}.xhtml`,
          `<img src="../Images/color-${page}.jpg" alt="彩插"/>`
        ),
        imageItem(`i${index}`, `Images/color-${page}.jpg`, `OEBPS/Images/color-${page}.jpg`)
      );
      continue;
    }
    items.push(xhtmlItem(
      `p${index}`,
      `Text/page-${page}.xhtml`,
      `OEBPS/Text/page-${page}.xhtml`,
      `<h2>第 ${index + 1} 章</h2><p>${longText}</p>`
    ));
  }
  items.push({
    ...imageItem('cover', 'Images/cover.jpg', 'OEBPS/Images/cover.jpg'),
    content: new Uint8Array([4, 4, 4, 4, 4, 4])
  });
  const epub = await buildEpub({
    title: '彩插轻小说',
    items,
    metadata: '<meta name="cover" content="cover"/>'
  });
  const metadataBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-metadata-novel', fallbackTitle: '文件名', metadataOnly: true }
  );
  const fullBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-full-novel', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(metadataBook.type, 'epub');
    assert.equal(metadataBook.pageCount, 30);
    assert.equal(metadataBook.coverBlob.size, 6);
    assert.equal(fullBook.type, metadataBook.type);
    assert.equal(fullBook.chapters.length, 30);
  } finally {
    releaseBookUrls(metadataBook);
    releaseBookUrls(fullBook);
  }
});

test('metadataOnly 对纯文本长篇估算页数并在无封面时留空', async () => {
  const longText = '这是一段足够长的正文，用来确认采样页会被识别为文字章节。'.repeat(4);
  const items = [];
  for (let index = 0; index < 120; index++) {
    items.push(xhtmlItem(
      `c${index}`,
      `Text/chapter-${index + 1}.xhtml`,
      `OEBPS/Text/chapter-${index + 1}.xhtml`,
      `<h2>第 ${index + 1} 章</h2><p>${longText}</p>`
    ));
  }
  const epub = await buildEpub({ title: '纯文本长篇', items });
  const book = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-metadata-text', fallbackTitle: '文件名', metadataOnly: true }
  );

  try {
    assert.equal(book.type, 'epub');
    assert.equal(book.pageCount, 120);
    assert.equal(book.cover, null);
    assert.equal(book.coverBlob, null);
    assert.equal(book.chapters, null);
  } finally {
    releaseBookUrls(book);
  }
});

test('metadataOnly 不因空白 spine 页强制全量解析', async () => {
  const longText = '空白页也是合法 spine 条目，不应被当成采样缺失。'.repeat(4);
  const items = [];
  for (let index = 0; index < 120; index++) {
    items.push(xhtmlItem(
      `c${index}`,
      `Text/chapter-${index + 1}.xhtml`,
      `OEBPS/Text/chapter-${index + 1}.xhtml`,
      index === 13 ? '' : `<h2>第 ${index + 1} 章</h2><p>${longText}</p>`
    ));
  }
  const epub = await buildEpub({ title: '含空白页的长篇', items });
  const book = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-metadata-blank-page', fallbackTitle: '文件名', metadataOnly: true }
  );

  try {
    assert.equal(book.needsFullParse, undefined);
    assert.equal(book.type, 'epub');
    assert.equal(book.pageCount, 120);
  } finally {
    releaseBookUrls(book);
  }
});

test('metadataOnly 支持 guide 封面页', async () => {
  const items = [
    xhtmlItem(
      'cover-page',
      'Text/cover.xhtml',
      'OEBPS/Text/cover.xhtml',
      '<img src="../Images/guide-cover.jpg" alt="封面"/>'
    )
  ];
  items.push({
    ...imageItem('guide-cover', 'Images/guide-cover.jpg', 'OEBPS/Images/guide-cover.jpg'),
    content: new Uint8Array([6, 6, 6, 6, 6, 6, 6])
  });
  for (let index = 0; index < 99; index++) {
    items.push(xhtmlItem(
      `page-${index}`,
      `Text/page-${index + 1}.xhtml`,
      `OEBPS/Text/page-${index + 1}.xhtml`,
      `<img src="../Images/page-${index + 1}.jpg" alt=""/>`
    ));
    items.push(imageItem(
      `image-${index}`,
      `Images/page-${index + 1}.jpg`,
      `OEBPS/Images/page-${index + 1}.jpg`
    ));
  }
  const epub = await buildEpub({
    title: 'guide 封面与模糊采样',
    items,
    guide: '<reference type="cover" title="封面" href="Text/cover.xhtml"/>'
  });

  const metadataBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-metadata-guide', fallbackTitle: '文件名', metadataOnly: true }
  );
  try {
    assert.equal(metadataBook.needsFullParse, undefined);
    assert.equal(metadataBook.type, 'manga');
    assert.equal(metadataBook.coverBlob.size, 7);
  } finally {
    releaseBookUrls(metadataBook);
  }
});

test('原生 EPUB metadataOnly 只读取采样章节并保留书包会话', async () => {
  const longText = '原生稀疏读取正文，确保文字章节比例足以直接判为小说。'.repeat(4);
  const items = [];
  for (let index = 0; index < 120; index++) {
    items.push(xhtmlItem(
      `c${index}`,
      `Text/chapter-${index + 1}.xhtml`,
      `OEBPS/Text/chapter-${index + 1}.xhtml`,
      `<h2>第 ${index + 1} 章</h2><p>${longText}</p>`
    ));
  }
  const epub = await buildEpub({ title: '原生懒解析', items });
  const entries = Array.from(epub.entries.entries());
  const requestedTextPages = [];
  dom.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        if (name === 'openDocument') {
          return {
            archiveId: args.archiveId,
            entries: entries.map(([path, bytes], index) => ({
              index,
              path,
              name: path,
              size: bytes.length
            }))
          };
        }
        if (name === 'readTextBatch') {
          const requested = JSON.parse(args.pathsJson);
          requestedTextPages.push(...requested.filter(path => /\.xhtml$/i.test(path)));
          return {
            texts: requested.flatMap(path => {
              const bytes = epub.entries.get(path);
              return bytes ? [{ path, text: decoder.decode(bytes), size: bytes.length }] : [];
            })
          };
        }
        if (name === 'close') return null;
        throw new Error(`未模拟原生命令：${name}`);
      }
    }
  };

  const id = 'epub-native-metadata-only';
  const book = await parseEpubNativeArchive(
    'homura-native-sources/epub-native-metadata-only/source/book.epub',
    { id, name: '原生懒解析.epub', metadataOnly: true }
  );
  try {
    assert.equal(book.metadataOnly, true);
    assert.equal(book.type, 'epub');
    assert.equal(book.pageCount, 120);
    assert.equal(book.chapters, null);
    assert.equal(book.nativeArchiveId, id);
    assert.equal(isNativeArchiveSessionOpen(id), true);
    assert.ok(requestedTextPages.length < 30, `原生读取 ${requestedTextPages.length} 页，没有保持稀疏采样`);
  } finally {
    releaseBookUrls(book);
    await closeNativeArchive(id);
  }
});

test('metadataOnly 在采样比例贴边时要求全量解析', async () => {
  const items = [];
  const textIndices = new Set([49, 55]);
  for (let index = 0; index < 100; index++) {
    const page = String(index + 1).padStart(3, '0');
    if (textIndices.has(index)) {
      items.push(xhtmlItem(
        `p${index}`,
        `Text/page-${page}.xhtml`,
        `OEBPS/Text/page-${page}.xhtml`,
        `<p>${'边界文字'.repeat(20)}</p>`
      ));
    } else {
      items.push(
        xhtmlItem(
          `p${index}`,
          `Text/page-${page}.xhtml`,
          `OEBPS/Text/page-${page}.xhtml`,
          `<img src="../Images/page-${page}.jpg" alt=""/>`
        ),
        imageItem(`i${index}`, `Images/page-${page}.jpg`, `OEBPS/Images/page-${page}.jpg`)
      );
    }
  }
  const epub = await buildEpub({ title: '模糊采样', items });
  const metadataBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-metadata-edge', fallbackTitle: '文件名', metadataOnly: true }
  );
  const fullBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-full-edge', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(metadataBook.needsFullParse, true);
    assert.equal(fullBook.type, 'manga');
  } finally {
    releaseBookUrls(fullBook);
  }
});

test('懒导入后的全量解析会补齐章节与页数', async () => {
  const longText = '这是一段足够长的正文，用于验证首次打开会恢复完整章节。'.repeat(4);
  const items = [];
  for (let index = 0; index < 40; index++) {
    items.push(xhtmlItem(
      `c${index}`,
      `Text/chapter-${index + 1}.xhtml`,
      `OEBPS/Text/chapter-${index + 1}.xhtml`,
      `<h2>第 ${index + 1} 章</h2><p>${longText}</p>`
    ));
  }
  const epub = await buildEpub({ title: '懒导入恢复', items });
  const metadataBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-hydrate', fallbackTitle: '文件名', metadataOnly: true }
  );
  const fullBook = await parseEpubArchive(
    await createJsZipEpubArchive(epub.bytes),
    { id: 'epub-hydrate-full', fallbackTitle: '文件名' }
  );

  try {
    assert.equal(metadataBook.chapters, null);
    assert.equal(fullBook.type, metadataBook.type);
    assert.equal(fullBook.chapters.length, 40);
    assert.equal(fullBook.pageCount, 40);
    assert.match(fullBook.chapters[0].htmlContent, /第 1 章/);
  } finally {
    releaseBookUrls(metadataBook);
    releaseBookUrls(fullBook);
  }
});
