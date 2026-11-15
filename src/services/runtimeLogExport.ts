/* ============================================================================
   HOMURA · 运行日志导出
   ----------------------------------------------------------------------------
   日志是本地调试数据，导出时不经过网络：
   - 桌面 Tauri 交给 Rust 弹出系统保存对话框并直接写盘；
   - 浏览器环境退化为 Blob 下载；
   - Android 没有可靠的保存目录权限，改为复制到剪贴板。
   ========================================================================== */

import { canUseNativeBridge, invokeNativeCommand, NativeBridgeError, NativeErrorCode } from './nativeRuntime.ts';
import { isAndroid } from './platform.ts';
import { formatRuntimeLogSource, formatRuntimeLogTimestamp, type RuntimeLogEntry } from './runtimeLogs.ts';

export type RuntimeLogExportOutcome = 'saved' | 'downloaded' | 'copied' | 'cancelled' | 'failed';

const DOWNLOAD_REVOKE_DELAY = 1000;

export function runtimeLogExportFileName(at = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `homura-logs-${date}-${time}.txt`;
}

export function formatRuntimeLogEntries(entries: RuntimeLogEntry[]) {
  return entries
    .map(entry => {
      const head = `${formatRuntimeLogTimestamp(entry.at)}  [${entry.level}]  ${formatRuntimeLogSource(entry.source)}`;
      if (!entry.detail) return `${head}\n${entry.message}`;
      const detail = entry.detail.split('\n').map(line => `  ${line}`).join('\n');
      return `${head}\n${entry.message}\n${detail}`;
    })
    .join('\n\n');
}

function downloadFile(contents: string, fileName: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY);
  return true;
}

async function copyToClipboard(contents: string) {
  try {
    await navigator.clipboard.writeText(contents);
    return true;
  } catch {
    // WebView 里 clipboard API 可能缺少焦点权限，退到隐藏 textarea。
    try {
      const area = document.createElement('textarea');
      area.value = contents;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.inset = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function isFallbackNativeError(error: unknown) {
  if (!(error instanceof NativeBridgeError)) return false;
  return error.code === NativeErrorCode.UNAVAILABLE
    || error.code === NativeErrorCode.UNSUPPORTED
    || error.code === NativeErrorCode.DISABLED;
}

export async function deliverRuntimeLogExport(contents: string, fileName: string): Promise<RuntimeLogExportOutcome> {
  if (isAndroid) {
    return (await copyToClipboard(contents)) ? 'copied' : 'failed';
  }

  if (canUseNativeBridge()) {
    try {
      const path = await invokeNativeCommand(null, 'export_runtime_logs', {
        contents,
        defaultName: fileName
      });
      return typeof path === 'string' && path ? 'saved' : 'cancelled';
    } catch (error) {
      // 用户主动取消保存时 Rust 返回 null，不会走到这里；其余可回退错误继续走下载。
      if (!isFallbackNativeError(error)) return 'failed';
    }
  }

  if (downloadFile(contents, fileName)) return 'downloaded';
  return (await copyToClipboard(contents)) ? 'copied' : 'failed';
}
