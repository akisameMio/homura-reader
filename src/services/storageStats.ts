/* ============================================================================
   HOMURA · 磁盘容量统计
   ----------------------------------------------------------------------------
   WebView 的 navigator.storage.estimate() 只描述网页缓存配额，无法代表磁盘。
   原生环境走 Rust storage_stats 命令拿磁盘总量 / 剩余 / 应用占用，浏览器调试
   环境返回 null，由设置页回退到旧的配额展示。
   ========================================================================== */

import { canUseNativeBridge, invokeNativeCommand } from './nativeRuntime.ts';

export interface DiskStorageStats {
  totalBytes: number;
  freeBytes: number;
  appBytes: number;
}

export interface StorageSegments {
  totalBytes: number;
  appBytes: number;
  otherBytes: number;
  freeBytes: number;
  appRatio: number;
  otherRatio: number;
  freeRatio: number;
}

function toBytes(value: unknown) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function clamp(value: number, max: number) {
  return Math.min(Math.max(0, value), max);
}

export async function readDiskStorageStats(): Promise<DiskStorageStats | null> {
  if (!canUseNativeBridge()) return null;
  try {
    const result = await invokeNativeCommand(null, 'storage_stats', {}, { feature: 'storage' });
    const totalBytes = toBytes((result as { totalBytes?: unknown })?.totalBytes);
    if (!totalBytes) return null;
    return {
      totalBytes,
      freeBytes: toBytes((result as { freeBytes?: unknown })?.freeBytes),
      appBytes: toBytes((result as { appBytes?: unknown })?.appBytes)
    };
  } catch (err) {
    console.warn('[HOMURA] 磁盘容量统计不可用', err);
    return null;
  }
}

// 三段按磁盘总量铺满：应用占用不能超过已用，剩余不足时也不会把比例算成负数。
export function buildStorageSegments(stats: DiskStorageStats): StorageSegments {
  const totalBytes = Math.max(0, stats.totalBytes || 0);
  const freeBytes = clamp(stats.freeBytes || 0, totalBytes);
  const usedBytes = totalBytes - freeBytes;
  const appBytes = clamp(stats.appBytes || 0, usedBytes);
  const otherBytes = usedBytes - appBytes;

  return {
    totalBytes,
    appBytes,
    otherBytes,
    freeBytes,
    appRatio: totalBytes > 0 ? appBytes / totalBytes : 0,
    otherRatio: totalBytes > 0 ? otherBytes / totalBytes : 0,
    freeRatio: totalBytes > 0 ? freeBytes / totalBytes : 0
  };
}
