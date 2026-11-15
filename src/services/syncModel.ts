/* ============================================================================
   HOMURA · 便携同步记录与确定性合并
   ----------------------------------------------------------------------------
   同步只包含进度、收藏、书库与归属，不传本机路径、句柄或原文件。
   版本使用逻辑计数器；设备时间不会决定覆盖顺序，删除标记参与相同的合并。
   ========================================================================== */

export type SyncKind = 'progress' | 'favorite' | 'collection' | 'membership';

export interface SyncVersion {
  counter: number;
  deviceId: string;
}

export interface SyncRecord {
  kind: SyncKind;
  key: string;
  version: SyncVersion;
  value: unknown;
  deleted?: boolean;
}

export interface SyncDocument {
  schemaVersion: 1;
  records: SyncRecord[];
}

export const MAX_SYNC_RECORDS = 50_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,200}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const KINDS: readonly string[] = ['progress', 'favorite', 'collection', 'membership'];

function invalid(): never {
  throw new Error('同步数据格式无效');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) return invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) return invalid();
  return value;
}

function layoutValue(input: unknown) {
  const raw = object(input);
  const values: Record<string, readonly unknown[]> = {
    direction: ['ltr', 'rtl', 'vertical'],
    pagedDirection: ['ltr', 'rtl'],
    verticalText: [true, false],
    spread: [1, 2],
    coverOffset: [true, false],
    fontSize: [14, 16, 18, 20, 22, 24, 26, 28],
    webtoonFit: ['screen', 'medium', 'wide'],
    fontFamily: ['system', 'square', 'song', 'kai', 'round'],
    lineHeight: ['tight', 'normal', 'loose'],
    pageMargin: ['narrow', 'normal', 'wide']
  };
  onlyKeys(raw, Object.keys(values));
  const result: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(values)) {
    if (raw[key] === undefined) continue;
    if (!allowed.includes(raw[key])) invalid();
    result[key] = raw[key];
  }
  return result;
}

function progressValue(input: unknown) {
  const raw = object(input);
  onlyKeys(raw, ['index', 'total', 'ratio', 'chapterIndex', 'chapterRatio', 'updatedAt', 'layout']);
  const result: Record<string, unknown> = {};
  for (const key of ['index', 'total', 'chapterIndex']) {
    if (raw[key] !== undefined) result[key] = integer(raw[key], 1_000_000_000);
  }
  for (const key of ['ratio', 'chapterRatio']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] < 0 || raw[key] > 1) invalid();
    result[key] = raw[key];
  }
  if (raw.updatedAt !== undefined) result.updatedAt = integer(raw.updatedAt);
  if (raw.layout !== undefined) result.layout = layoutValue(raw.layout);
  if (!Object.keys(result).length) invalid();
  if (typeof result.total === 'number' && result.total > 0 && typeof result.index === 'number' && result.index >= result.total) invalid();
  return result;
}

function recordValue(kind: SyncKind, input: unknown) {
  if (kind === 'progress') return progressValue(input);
  if (kind === 'favorite') {
    if (typeof input !== 'boolean') return invalid();
    return input;
  }
  if (kind === 'membership') return input === null ? null : identifier(input);
  const raw = object(input);
  onlyKeys(raw, ['title', 'createdAt']);
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80 || /[\u0000-\u001f\u007f]/.test(raw.title)) invalid();
  return { title: raw.title, createdAt: integer(raw.createdAt) };
}

export function syncRecordKey(record: Pick<SyncRecord, 'kind' | 'key'>): string {
  return `${record.kind}:${record.key}`;
}

export function compareSyncVersions(a: SyncVersion, b: SyncVersion): number {
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

export function validateSyncDocument(input: unknown): SyncDocument {
  const raw = object(input);
  onlyKeys(raw, ['schemaVersion', 'records']);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.records) || raw.records.length > MAX_SYNC_RECORDS) invalid();
  const seen = new Set<string>();
  const records = raw.records.map((inputRecord): SyncRecord => {
    const record = object(inputRecord);
    onlyKeys(record, ['kind', 'key', 'version', 'value', 'deleted']);
    if (typeof record.kind !== 'string' || !KINDS.includes(record.kind)) invalid();
    const kind = record.kind as SyncKind;
    if (typeof record.key !== 'string' || !(kind === 'collection' ? IDENTIFIER : FINGERPRINT).test(record.key)) invalid();
    const version = object(record.version);
    onlyKeys(version, ['counter', 'deviceId']);
    if (record.deleted !== undefined && typeof record.deleted !== 'boolean') invalid();
    if (record.deleted === true && record.value !== null) invalid();
    const normalized: SyncRecord = {
      kind,
      key: record.key,
      version: { counter: integer(version.counter, Number.MAX_SAFE_INTEGER - 1), deviceId: identifier(version.deviceId) },
      value: record.deleted === true ? null : recordValue(kind, record.value)
    };
    if (record.deleted === true) normalized.deleted = true;
    const key = syncRecordKey(normalized);
    if (seen.has(key)) invalid();
    seen.add(key);
    return normalized;
  });
  records.sort((a, b) => syncRecordKey(a) < syncRecordKey(b) ? -1 : syncRecordKey(a) > syncRecordKey(b) ? 1 : 0);
  return { schemaVersion: 1, records };
}

export function mergeSyncDocuments(a: SyncDocument, b: SyncDocument): SyncDocument {
  const records = new Map<string, SyncRecord>();
  for (const document of [validateSyncDocument(a), validateSyncDocument(b)]) {
    for (const candidate of document.records) {
      const key = syncRecordKey(candidate);
      const previous = records.get(key);
      const order = previous ? compareSyncVersions(candidate.version, previous.version) : 1;
      // 同一版本出现不同内容时仍保证收敛；同版本墓碑优先，避免已删数据复活。
      const winsTie = previous && order === 0 && (
        (!!candidate.deleted && !previous.deleted)
        || (!!candidate.deleted === !!previous.deleted && JSON.stringify(candidate.value) > JSON.stringify(previous.value))
      );
      if (!previous || order > 0 || winsTie) records.set(key, candidate);
    }
  }
  return validateSyncDocument({ schemaVersion: 1, records: [...records.values()] });
}
