/* ============================================================================
   HOMURA · 运行日志
   ----------------------------------------------------------------------------
   只在本机保留最近 300 条运行日志。默认只记录 error，用户可在设置中降低
   等级或关闭捕获。日志写入走防抖缓存，避免 console 高频输出拖慢界面。
   ========================================================================== */

export type RuntimeLogLevel = 'info' | 'warning' | 'error';
export type RuntimeLogFilter = 'all' | RuntimeLogLevel;

export interface RuntimeLogEntry {
  id: string;
  at: number;
  level: RuntimeLogLevel;
  message: string;
  source: string;
  detail?: string;
}

export const RUNTIME_LOG_LIMIT = 300;
export const RUNTIME_LOG_STORAGE_KEY = 'homura_runtime_logs';
export const RUNTIME_LOG_LEVELS: readonly RuntimeLogLevel[] = ['error', 'warning', 'info'];

const LEVEL_PRIORITY: Record<RuntimeLogLevel, number> = { info: 0, warning: 1, error: 2 };
const MAX_MESSAGE_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 6000;
const PERSIST_DELAY = 240;

let entrySequence = 0;
let entries: RuntimeLogEntry[] = readPersistedLogs();
let captureEnabled = true;
let minimumLevel: RuntimeLogLevel = 'error';
let captureInstalled = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(entries: RuntimeLogEntry[]) => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeLevel(value: unknown): RuntimeLogLevel | null {
  return value === 'info' || value === 'warning' || value === 'error' ? value : null;
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function normalizeEntry(value: unknown): RuntimeLogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const level = normalizeLevel(source.level);
  const message = typeof source.message === 'string' ? source.message.trim() : '';
  const at = Number(source.at);
  if (!level || !message || !Number.isFinite(at) || at <= 0) return null;
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `restored-${at}-${++entrySequence}`,
    at,
    level,
    message: truncate(message, MAX_MESSAGE_LENGTH),
    source: typeof source.source === 'string' && source.source ? truncate(source.source, 80) : 'APP',
    detail: typeof source.detail === 'string' && source.detail ? truncate(source.detail, MAX_DETAIL_LENGTH) : undefined
  };
}

function readPersistedLogs(): RuntimeLogEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(RUNTIME_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((entry): entry is RuntimeLogEntry => !!entry).slice(-RUNTIME_LOG_LIMIT);
  } catch {
    return [];
  }
}

function persistNow() {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RUNTIME_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 配额紧张时优先保留最近的记录，避免日志反过来阻塞业务。
    try {
      store.setItem(RUNTIME_LOG_STORAGE_KEY, JSON.stringify(entries.slice(-80)));
    } catch {}
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DELAY);
}

function publish() {
  const snapshot = entries.slice();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {}
  }
}

export function configureRuntimeLogs(options: { capture?: boolean; level?: RuntimeLogLevel } = {}) {
  if (typeof options.capture === 'boolean') captureEnabled = options.capture;
  const nextLevel = normalizeLevel(options.level);
  if (nextLevel) minimumLevel = nextLevel;
}

export function getRuntimeLogSettings() {
  return { capture: captureEnabled, level: minimumLevel };
}

export function getRuntimeLogs(): RuntimeLogEntry[] {
  return entries.slice();
}

export function formatRuntimeLogTimestamp(at: number) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatRuntimeLogSource(source: string) {
  return source === 'APP' ? 'APP' : `APP · ${source}`;
}

// 搜索同时覆盖消息、来源、等级与堆栈，方便按错误关键字或模块名定位。
export function matchesRuntimeLogQuery(entry: RuntimeLogEntry, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  const haystack = [entry.message, entry.source, entry.level, entry.detail || '', formatRuntimeLogTimestamp(entry.at)]
    .join('\n')
    .toLowerCase();
  return haystack.includes(keyword);
}

export function subscribeRuntimeLogs(listener: (entries: RuntimeLogEntry[]) => void) {
  listeners.add(listener);
  listener(entries.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function clearRuntimeLogs() {
  entries = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
  publish();
}

export function logRuntime(
  level: RuntimeLogLevel,
  message: string,
  source = 'APP',
  detail?: string
) {
  if (!captureEnabled || LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel]) return;
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return;
  entries.push({
    id: `${Date.now().toString(36)}-${(++entrySequence).toString(36)}`,
    at: Date.now(),
    level,
    message: truncate(text, MAX_MESSAGE_LENGTH),
    source: truncate(source.trim() || 'APP', 80),
    detail: detail ? truncate(detail, MAX_DETAIL_LENGTH) : undefined
  });
  if (entries.length > RUNTIME_LOG_LIMIT) entries.splice(0, entries.length - RUNTIME_LOG_LIMIT);
  schedulePersist();
  publish();
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      if (serialized) return truncate(serialized, 800);
    } catch {}
  }
  return String(value);
}

function formatConsoleArgs(args: unknown[]) {
  return truncate(args.map(formatConsoleValue).join(' '), MAX_MESSAGE_LENGTH);
}

function errorDetail(args: unknown[]) {
  const error = args.find((value): value is Error => value instanceof Error);
  return error ? error.stack || `${error.name}: ${error.message}` : undefined;
}

function reportWindowError(event: ErrorEvent) {
  logRuntime('error', event.message || '未捕获的脚本错误', 'window', event.error instanceof Error ? event.error.stack : undefined);
}

function reportUnhandledRejection(event: PromiseRejectionEvent) {
  const reason = event.reason;
  logRuntime('error', `未处理的 Promise 拒绝：${formatConsoleValue(reason)}`, 'promise', reason instanceof Error ? reason.stack : undefined);
}

export function installRuntimeLogCapture() {
  if (captureInstalled) return () => {};
  captureInstalled = true;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    logRuntime('warning', formatConsoleArgs(args), 'console', errorDetail(args));
  };
  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    logRuntime('error', formatConsoleArgs(args), 'console', errorDetail(args));
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', reportWindowError);
    window.addEventListener('unhandledrejection', reportUnhandledRejection);
  }

  return () => {
    console.warn = originalWarn;
    console.error = originalError;
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', reportWindowError);
      window.removeEventListener('unhandledrejection', reportUnhandledRejection);
    }
    captureInstalled = false;
  };
}
