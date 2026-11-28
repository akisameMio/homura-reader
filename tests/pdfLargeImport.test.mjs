import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

let lastGetDocumentArg = null;
let lastTransport = null;
let taskDestroyed = 0;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) {
      return {
        url: 'data:text/javascript,' + encodeURIComponent('export default "fake-worker.mjs";'),
        shortCircuit: true
      };
    }
    if (specifier === 'pdfjs-dist/legacy/build/pdf.mjs') {
      return {
        url: 'homura-mock://pdfjs',
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'homura-mock://pdfjs') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export const GlobalWorkerOptions = { workerSrc: '' };
          export class PDFDataRangeTransport {
            constructor(length, initialData, progressiveDone) {
              this.length = length;
              this.initialData = initialData;
              this.progressiveDone = progressiveDone;
              this.received = [];
            }
            onDataRange(begin, chunk) {
              this.received.push({ begin, length: chunk.byteLength });
            }
          }
          export function getDocument(params) {
            globalThis.__pdfMockOnGetDocument?.(params);
            const task = {
              promise: Promise.resolve({ numPages: 3 }),
              destroy: async () => {
                globalThis.__pdfMockOnDestroy?.();
              }
            };
            return task;
          }
        `
      };
    }
    return nextLoad(url, context);
  }
});

globalThis.document = { baseURI: 'http://localhost:5173/', createElement: () => ({}) };
globalThis.__pdfMockOnGetDocument = (params) => {
  lastGetDocumentArg = params;
  lastTransport = params.range ?? null;
};
globalThis.__pdfMockOnDestroy = () => {
  taskDestroyed += 1;
};

const {
  clampPdfRenderScale,
  destroyPdfDocument,
  openPdfDocument,
  openRemotePdfDocument
} = await import('../src/services/pdf.ts');
const { discardParsedBook } = await import('../src/services/parsers.ts');

test('超大/超长 PDF 页面渲染缩放会收敛在画布安全边界内', () => {
  const normal = clampPdfRenderScale(800, 1200, 1600);
  assert.equal(normal, 2);

  const tall = clampPdfRenderScale(800, 30000, 1600);
  assert.ok(tall * 30000 <= 4096 + 1e-6, '高度不能超过 MAX_CANVAS_EDGE');
  assert.ok((tall * 800) * (tall * 30000) <= 16 * 1024 * 1024 + 1, '总像素不能超过安全上限');

  const invalid = clampPdfRenderScale(0, -10, 1600);
  assert.ok(Number.isFinite(invalid) && invalid > 0, '非法页面尺寸不应产生 NaN/Infinity');
});

test('大体积本地 PDF 使用 File.slice 分块加载，不调用整本 arrayBuffer()', async () => {
  lastGetDocumentArg = null;
  lastTransport = null;
  taskDestroyed = 0;

  const totalSize = 64 * 1024 * 1024;
  const sliceCalls = [];
  const fakeLargeFile = {
    size: totalSize,
    async arrayBuffer() {
      throw new Error('大 PDF 不应调用整本 arrayBuffer()');
    },
    slice(start = 0, end = totalSize) {
      sliceCalls.push([start, end]);
      return new Blob([new Uint8Array(Math.max(0, end - start))]);
    }
  };

  const doc = await openPdfDocument(fakeLargeFile);
  assert.equal(doc.numPages, 3);
  assert.ok(lastGetDocumentArg?.range, '应启用 PDFDataRangeTransport');
  assert.equal(lastGetDocumentArg.disableAutoFetch, true);
  assert.equal(lastGetDocumentArg.disableStream, true);

  // 触发越过文件尾部的 Range 请求，确认会自动截断到 totalSize
  lastTransport.requestDataRange(totalSize - 1024, totalSize + 4096);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(sliceCalls, [[totalSize - 1024, totalSize]]);
  assert.deepEqual(lastTransport.received, [{ begin: totalSize - 1024, length: 1024 }]);

  await destroyPdfDocument(doc);
  assert.equal(taskDestroyed, 1);
});

test('小体积本地 PDF 仍可直接走 arrayBuffer() 并附带可销毁的 loadingTask', async () => {
  lastGetDocumentArg = null;
  taskDestroyed = 0;

  const smallFile = new Blob([new Uint8Array(1024)]);
  const doc = await openPdfDocument(smallFile);
  assert.equal(doc.numPages, 3);
  assert.ok(lastGetDocumentArg?.data instanceof ArrayBuffer);

  await destroyPdfDocument(doc);
  assert.equal(taskDestroyed, 1);
});

test('openRemotePdfDocument 会截断超出文件长度的末尾 Range 请求', async () => {
  const reads = [];
  const opened = await openRemotePdfDocument({
    size: 5000,
    async read(start, end) {
      reads.push([start, end]);
      return new Uint8Array(end - start);
    }
  });
  lastTransport.requestDataRange(4096, 8192);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(reads, [[4096, 5000]]);
  await opened.destroy();
});

test('discardParsedBook 在只有 pdfDoc.destroy() 而无 loadingTask 时也能正确释放', async () => {
  let destroyed = 0;
  await discardParsedBook({
    id: 'pdf_test',
    type: 'manga',
    format: 'pdf',
    title: 'test',
    pdfDoc: {
      async destroy() {
        destroyed += 1;
      }
    }
  });
  assert.equal(destroyed, 1);
});
