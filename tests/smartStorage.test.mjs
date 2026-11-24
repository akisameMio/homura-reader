import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_STORAGE_DEFAULTS,
  SMART_STORAGE_LIMITS,
  createSmartStorageRepository,
  deserializeManagedNovelSource,
  evaluateSmartTransferEligibility,
  findReclaimableAutoArchives,
  mergeReadingActivity,
  rankSmartTransferCandidates,
  reconcileReadingSession,
  serializeManagedNovelSource
} from '../src/services/smartStorage.ts';

const NOW = new Date('2026-11-24T04:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function createFakeIndexedDB({ version: initialVersion = 0, initialStores = {} } = {}) {
  const stores = new Map();
  for (const [name, entries] of Object.entries(initialStores)) stores.set(name, new Map(entries));
  const operations = [];
  const transactions = [];
  let version = initialVersion;
  const database = {
    objectStoreNames: {
      contains: name => stores.has(name)
    },
    createObjectStore(name) {
      stores.set(name, new Map());
    },
    transaction(names, mode) {
      const storeNames = Array.isArray(names) ? names : [names];
      transactions.push({ stores: [...storeNames], mode });
      const tx = { oncomplete: null, onerror: null, onabort: null };
      let pending = 1;
      let completed = false;
      const maybeComplete = () => {
        if (completed || pending !== 0) return;
        completed = true;
        queueMicrotask(() => tx.oncomplete?.());
      };
      const request = operation => {
        pending++;
        const value = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          try {
            value.result = operation();
            value.onsuccess?.();
          } catch (error) {
            value.error = error;
            tx.error = error;
            value.onerror?.();
            tx.onerror?.();
          } finally {
            pending--;
            maybeComplete();
          }
        });
        return value;
      };
      queueMicrotask(() => {
        pending--;
        maybeComplete();
      });
      tx.objectStore = name => {
        const data = stores.get(name);
        if (!data) throw new Error(`对象仓库不存在：${name}`);
        return {
          get: id => {
            operations.push({ store: name, operation: 'get', value: id });
            return request(() => data.get(id));
          },
          getAll: () => {
            operations.push({ store: name, operation: 'getAll' });
            return request(() => [...data.values()]);
          },
          put: value => {
            operations.push({ store: name, operation: 'put', value: value.bookId });
            return request(() => {
              if (mode !== 'readonly') data.set(value.bookId, structuredClone(value));
              return value.bookId;
            });
          },
          delete: id => {
            operations.push({ store: name, operation: 'delete', value: id });
            return request(() => {
              if (mode !== 'readonly') data.delete(id);
            });
          },
          clear: () => {
            operations.push({ store: name, operation: 'clear' });
            return request(() => {
              if (mode !== 'readonly') data.clear();
            });
          },
          openCursor: () => {
            operations.push({ store: name, operation: 'openCursor' });
            pending++;
            const entries = [...data.entries()];
            let index = 0;
            const cursorRequest = { result: null, error: null, onsuccess: null, onerror: null };
            const advance = () => {
              if (index >= entries.length) {
                cursorRequest.result = null;
                cursorRequest.onsuccess?.();
                pending--;
                maybeComplete();
                return;
              }
              const [key, value] = entries[index++];
              cursorRequest.result = {
                key,
                value: structuredClone(value),
                continue: () => queueMicrotask(advance)
              };
              cursorRequest.onsuccess?.();
            };
            queueMicrotask(advance);
            return cursorRequest;
          }
        };
      };
      return tx;
    },
    close() {}
  };
  return {
    stores,
    operations,
    transactions,
    get version() { return version; },
    open(_name, nextVersion) {
      const request = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        if (nextVersion > version) {
          version = nextVersion;
          request.transaction = database.transaction([], 'versionchange');
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function samples(values) {
  return values.map((durationMs, index) => ({ at: NOW - index * 1_000, durationMs }));
}

function activity(bookId, days, coldOpenSamples, lastReadAt = NOW - DAY, cachedOpenSamples = []) {
  return {
    bookId,
    readingDates: days,
    coldOpenSamples: samples(coldOpenSamples),
    cachedOpenSamples: samples(cachedOpenSamples),
    lastReadAt,
    updatedAt: NOW
  };
}

test('智能转存默认值与计划一致', () => {
  assert.equal(SMART_STORAGE_DEFAULTS.activityWindowDays, 14);
  assert.equal(SMART_STORAGE_DEFAULTS.requiredReadingDateCount, 3);
  assert.equal(SMART_STORAGE_DEFAULTS.requiredColdOpenSampleCount, 2);
  assert.equal(SMART_STORAGE_DEFAULTS.slowColdOpenMs, 2_000);
  assert.equal(SMART_STORAGE_DEFAULTS.defaultBudgetBytes, 512 * 1024 * 1024);
  assert.equal(SMART_STORAGE_DEFAULTS.idleDays, 30);
});

test('TXT/Markdown 规范化存档保留正文、来源链接和二进制资源', () => {
  const created = serializeManagedNovelSource({
    format: 'markdown',
    sourceFingerprint: 'sha256:novel',
    title: '测试小说',
    chapters: [
      { title: '第一章', content: '<h1>开始</h1>', contentKind: 'html', sourcePath: 'chapters/001.xhtml' }
    ],
    assets: [{ path: 'images/cover.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
    createdAt: NOW
  }, NOW + 1);
  const restored = deserializeManagedNovelSource(structuredClone(created));
  assert.equal(restored.kind, 'homura-managed-novel');
  assert.equal(restored.schemaVersion, SMART_STORAGE_LIMITS.archiveSchemaVersion);
  assert.equal(restored.serializerVersion, SMART_STORAGE_LIMITS.serializerVersion);
  assert.equal(restored.format, 'markdown');
  assert.equal(restored.title, '测试小说');
  assert.equal(restored.chapters[0].sourcePath, 'chapters/001.xhtml');
  assert.deepEqual([...restored.assets[0].bytes], [1, 2, 3]);
  assert.ok(restored.bytes > 0);
  assert.notEqual(restored.chapters, created.chapters, '反序列化结果应返回独立对象');
});

test('未知小说存档版本与空章节直接拒绝', () => {
  assert.throws(() => deserializeManagedNovelSource({ kind: 'homura-managed-novel', schemaVersion: 2 }), /版本不受支持/);
  assert.throws(() => serializeManagedNovelSource({
    format: 'txt', sourceFingerprint: 'sha256:empty', chapters: []
  }), /至少需要一个章节/);
});

test('简单 EPUB/MOBI 可保存自包含章节和资源路径', () => {
  for (const format of ['epub', 'mobi']) {
    const archive = serializeManagedNovelSource({
      format,
      sourceFingerprint: `sha256:${format}`,
      chapters: [{ content: '<p>正文</p>', contentKind: 'html', sourcePath: 'OEBPS/Text/chapter-1.xhtml' }],
      assets: [{ path: 'OEBPS/Images/page-1.jpg', mediaType: 'image/jpeg', bytes: new Uint8Array([4, 5]) }]
    }, NOW);
    assert.equal(archive.format, format);
    assert.equal(archive.chapters[0].sourcePath, 'OEBPS/Text/chapter-1.xhtml');
    assert.equal(archive.assets[0].path, 'OEBPS/Images/page-1.jpg');
    assert.doesNotThrow(() => deserializeManagedNovelSource(archive));
  }
});

test('阅读会话只在满一分钟或有实际进度时记为一个阅读日', () => {
  const idle = reconcileReadingSession({
    bookId: 'a', openedAt: NOW - 10_000, closedAt: NOW, activeMs: 10_000, progressed: false, readingDay: '2026-11-24'
  });
  assert.equal(idle.readingDay, null);
  const progressed = reconcileReadingSession({
    bookId: 'a', openedAt: NOW - 10_000, closedAt: NOW, activeMs: 10_000, progressed: true, readingDay: '2026-11-24'
  });
  assert.equal(progressed.readingDay, '2026-11-24');
  const merged = mergeReadingActivity(null, { ...progressed, coldOpenMs: 2_500, cachedOpenMs: 450 });
  assert.deepEqual(merged.readingDates, ['2026-11-24']);
  assert.equal(merged.coldOpenSamples.length, 1);
  assert.equal(merged.cachedOpenSamples.length, 1);
  assert.equal(merged.lastReadAt, NOW);
});

test('活动记录去重同日、淘汰 90 天前日期并限制冷/缓存打开样本数量', () => {
  let current = null;
  for (let index = 0; index < 40; index++) {
    current = mergeReadingActivity(current, {
      bookId: 'bounded',
      at: NOW + index,
      activeMs: 60_000,
      progressed: false,
      readingDay: '2026-11-24',
      coldOpenMs: 2_500 + index,
      cachedOpenMs: 500 + index
    });
  }
  assert.deepEqual(current.readingDates, ['2026-11-24']);
  assert.equal(current.coldOpenSamples.length, SMART_STORAGE_LIMITS.maxColdOpenSamples);
  assert.equal(current.cachedOpenSamples.length, SMART_STORAGE_LIMITS.maxColdOpenSamples);
  const pruned = mergeReadingActivity({
    ...current,
    readingDates: ['2026-01-01', ...current.readingDates]
  }, {
    bookId: 'bounded', at: NOW + 100, activeMs: 0, progressed: false, readingDay: null, coldOpenMs: null
  });
  assert.deepEqual(pruned.readingDates, ['2026-11-24']);
});

test('资格判断要求 14 天内 3 个阅读日、2 个样本且冷打开中位数至少 2 秒', () => {
  const recent = activity('eligible', ['2026-11-11', '2026-11-20', '2026-11-24'], [1_500, 2_500]);
  const result = evaluateSmartTransferEligibility({ activity: recent, archiveBytes: 10_000, sourceAvailable: true, now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.readingDateCount, 3);
  assert.equal(result.medianColdOpenMs, 2_000);
  assert.equal(result.cachedOpenSampleCount, 0);
  assert.equal(result.medianCachedOpenMs, null);
  const legacyActivity = { ...recent };
  delete legacyActivity.cachedOpenSamples;
  const legacy = evaluateSmartTransferEligibility({ activity: legacyActivity, archiveBytes: 10_000, sourceAvailable: true, now: NOW });
  assert.equal(legacy.eligible, true);
  assert.equal(legacy.medianCachedOpenMs, null);
  const tooFewDays = evaluateSmartTransferEligibility({ activity: activity('few', ['2026-11-20', '2026-11-24'], [2_500, 3_000]), archiveBytes: 10_000, sourceAvailable: true, now: NOW });
  assert.equal(tooFewDays.eligible, false);
  assert.ok(tooFewDays.reasons.includes('insufficient-reading-dates'));
  const old = evaluateSmartTransferEligibility({
    activity: activity('old', ['2026-10-01', '2026-10-02', '2026-10-03'], [2_500, 3_000]), archiveBytes: 10_000, sourceAvailable: true, now: NOW
  });
  assert.equal(old.readingDateCount, 0);
  assert.equal(old.eligible, false);
});

test('缓存打开中位数用于计算实际节省，排序自动扣减缓存耗时', () => {
  const evaluations = [
    evaluateSmartTransferEligibility({
      activity: activity('cached-fast', ['2026-11-11', '2026-11-20', '2026-11-24'], [4_000, 4_000], NOW - DAY, [500, 700]),
      archiveBytes: 100, sourceAvailable: true, now: NOW
    }),
    evaluateSmartTransferEligibility({
      activity: activity('cold-only', ['2026-11-11', '2026-11-20', '2026-11-24'], [2_000, 2_000]),
      archiveBytes: 100, sourceAvailable: true, now: NOW
    }),
    evaluateSmartTransferEligibility({
      activity: activity('no-benefit', ['2026-11-11', '2026-11-20', '2026-11-24'], [2_000, 2_000], NOW - DAY, [2_500, 3_000]),
      archiveBytes: 100, sourceAvailable: true, now: NOW
    })
  ];
  assert.equal(evaluations[0].medianCachedOpenMs, 600);
  const plan = rankSmartTransferCandidates(evaluations, 200);
  assert.deepEqual(plan.ranked.map(item => item.bookId), ['cached-fast', 'cold-only', 'no-benefit']);
  assert.equal(plan.ranked[0].savingsPerOpenMs, 3_400);
  assert.equal(plan.ranked[2].projectedSavingsMs, 0);
  assert.deepEqual(plan.selected.map(item => item.bookId), ['cached-fast', 'cold-only']);
  assert.deepEqual(plan.deferred.map(item => item.bookId), ['no-benefit']);
});

test('容量计划按单位空间预计节省排序，并在 512 MB 内选择', () => {
  const evaluations = [
    evaluateSmartTransferEligibility({ activity: activity('small', ['2026-11-11', '2026-11-20', '2026-11-24'], [2_000, 2_000]), archiveBytes: 100, sourceAvailable: true, now: NOW }),
    evaluateSmartTransferEligibility({ activity: activity('large', ['2026-11-11', '2026-11-20', '2026-11-24'], [2_000, 2_000]), archiveBytes: 1_000, sourceAvailable: true, now: NOW }),
    evaluateSmartTransferEligibility({ activity: activity('medium', ['2026-11-11', '2026-11-20', '2026-11-24'], [4_000, 4_000]), archiveBytes: 600, sourceAvailable: true, now: NOW })
  ];
  const plan = rankSmartTransferCandidates(evaluations, 700);
  assert.deepEqual(plan.ranked.map(item => item.bookId), ['small', 'medium', 'large']);
  assert.deepEqual(plan.selected.map(item => item.bookId), ['small', 'medium']);
  assert.deepEqual(plan.deferred.map(item => item.bookId), ['large']);
  assert.equal(plan.selectedBytes, 700);
});

test('自动存档连续 30 天未读后进入回收，用户仍读时保留', () => {
  const archives = [
    { bookId: 'idle', mode: 'auto', bytes: 10, createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 40 * DAY },
    { bookId: 'active', mode: 'auto', bytes: 10, createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 40 * DAY },
    { bookId: 'recent', mode: 'auto', bytes: 10, createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 40 * DAY }
  ];
  assert.deepEqual(findReclaimableAutoArchives([
    activity('idle', ['2026-09-01'], [2_500], NOW - 31 * DAY),
    activity('active', ['2026-11-24'], [2_500], NOW - DAY)
  ], archives, NOW), ['idle', 'recent']);
});

test('独立 IndexedDB 表以单事务持久化活动和自动小说存档', async () => {
  const indexedDB = createFakeIndexedDB();
  const repository = createSmartStorageRepository(indexedDB);
  const commit = reconcileReadingSession({
    bookId: 'book-1', openedAt: NOW - 70_000, closedAt: NOW, activeMs: 70_000, progressed: false,
    coldOpenMs: 2_400, cachedOpenMs: 450, readingDay: '2026-11-24'
  });
  const storedActivity = await repository.recordActivity(commit);
  assert.deepEqual(storedActivity.readingDates, ['2026-11-24']);
  assert.equal(storedActivity.cachedOpenSamples[0].durationMs, 450);
  assert.equal((await repository.loadActivity('book-1')).lastReadAt, NOW);
  assert.equal(indexedDB.version, SMART_STORAGE_LIMITS.databaseVersion);
  assert.ok(indexedDB.stores.has(SMART_STORAGE_LIMITS.activityStoreName));
  assert.ok(indexedDB.stores.has(SMART_STORAGE_LIMITS.archiveStoreName));
  assert.ok(indexedDB.stores.has(SMART_STORAGE_LIMITS.archiveSummaryStoreName));

  const archive = serializeManagedNovelSource({
    format: 'txt', sourceFingerprint: 'sha256:txt', title: '纯文本', createdAt: NOW,
    chapters: [{ content: '正文', contentKind: 'text' }]
  });
  await repository.saveAutoArchive('book-1', archive, NOW);
  await repository.recordActivity({
    bookId: 'book-2', at: NOW, activeMs: 60_000, progressed: false, readingDay: '2026-11-24', coldOpenMs: 3_000, cachedOpenMs: 700
  });
  await repository.saveAutoArchive('book-2', { ...archive, sourceFingerprint: 'sha256:txt-2' }, NOW);
  const storedArchive = await repository.loadAutoArchive('book-1');
  assert.equal(storedArchive.mode, 'auto');
  assert.equal(storedArchive.archive.kind, 'homura-managed-novel');
  assert.equal(storedArchive.bytes, archive.bytes);
  assert.equal('nativePath' in storedArchive.archive, false, '自动存档不保存原文件路径');
  assert.equal('blob' in storedArchive.archive, false, '自动存档不保存原文件副本');
  indexedDB.operations.length = 0;
  assert.deepEqual((await repository.listAutoArchiveSummaries()).map(item => item.bookId), ['book-1', 'book-2']);
  assert.equal(
    indexedDB.operations.some(item => item.store === SMART_STORAGE_LIMITS.archiveStoreName && item.operation === 'getAll'),
    false,
    '读取摘要不能加载完整存档正文'
  );
  assert.equal(
    indexedDB.operations.filter(item => item.store === SMART_STORAGE_LIMITS.archiveSummaryStoreName && item.operation === 'getAll').length,
    1
  );
  assert.ok(indexedDB.transactions.some(tx => tx.mode === 'readwrite'
    && tx.stores.includes(SMART_STORAGE_LIMITS.archiveStoreName)
    && tx.stores.includes(SMART_STORAGE_LIMITS.archiveSummaryStoreName)));
  await repository.deleteBookLearning('book-1');
  assert.equal(await repository.loadActivity('book-1'), null);
  assert.equal(await repository.loadAutoArchive('book-1'), null);
  assert.ok(await repository.loadActivity('book-2'));
  assert.ok(await repository.loadAutoArchive('book-2'));
  assert.deepEqual((await repository.listAutoArchiveSummaries()).map(item => item.bookId), ['book-2']);
  await repository.clear();
  assert.deepEqual(await repository.listActivities(), []);
  assert.deepEqual(await repository.listAutoArchives(), []);
  assert.deepEqual(await repository.listAutoArchiveSummaries(), []);
  repository.close();
});

test('v1 完整存档升级到 v2 时用游标回填轻量摘要', async () => {
  const archive = serializeManagedNovelSource({
    format: 'txt', sourceFingerprint: 'sha256:legacy', title: '旧存档', createdAt: NOW - DAY,
    chapters: [{ content: '旧正文', contentKind: 'text' }]
  });
  const legacyRecord = {
    bookId: 'legacy', mode: 'auto', archive, bytes: archive.bytes, createdAt: NOW - DAY, lastUsedAt: NOW - 2_000
  };
  const indexedDB = createFakeIndexedDB({
    version: 1,
    initialStores: { [SMART_STORAGE_LIMITS.archiveStoreName]: [['legacy', legacyRecord]] }
  });
  const repository = createSmartStorageRepository(indexedDB);
  const summaries = await repository.listAutoArchiveSummaries();
  assert.equal(indexedDB.version, SMART_STORAGE_LIMITS.databaseVersion);
  assert.deepEqual(summaries, [{
    bookId: 'legacy', mode: 'auto', bytes: archive.bytes, createdAt: NOW - DAY, lastUsedAt: NOW - 2_000
  }]);
  assert.equal(
    indexedDB.operations.some(item => item.store === SMART_STORAGE_LIMITS.archiveStoreName && item.operation === 'getAll'),
    false
  );
  assert.ok(indexedDB.operations.some(item => item.store === SMART_STORAGE_LIMITS.archiveStoreName && item.operation === 'openCursor'));
  repository.close();
});
