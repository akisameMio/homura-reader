/* ============================================================================
   HOMURA · 外部链接
   ----------------------------------------------------------------------------
   Tauri WebView 内的普通新窗口导航不可靠。桌面与 Android 包统一交给 opener
   插件调用系统浏览器；浏览器调试环境回退到带 noopener 的新标签页。
   ========================================================================== */

import { openUrl } from '@tauri-apps/plugin-opener';

function parseSafeExternalUrl(value: string) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('链接包含非法控制字符');
  }
  const url = new URL(value.trim());
  if (url.username || url.password) {
    throw new Error('拒绝打开包含内嵌凭据的链接');
  }
  return url;
}

function parseAllowedGithubUrl(value: string) {
  try {
    const url = parseSafeExternalUrl(value);
    const repositoryPath = '/Leon-Ning-san/HomuraReader';
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port) return null;
    if (url.pathname !== repositoryPath && !url.pathname.startsWith(`${repositoryPath}/`)) return null;
    return url;
  } catch (error) {
    return null;
  }
}

export async function openGitHubUrl(value: string) {
  const url = parseAllowedGithubUrl(value);
  if (!url) throw new Error('拒绝打开非 HOMURA GitHub 地址');

  if (typeof window !== 'undefined' && window.__TAURI__) {
    await openUrl(url.href);
    return;
  }

  const link = document.createElement('a');
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

// 正文外链与更新仓库白名单分开校验，只允许用户点击打开网页。
export async function openReadingUrl(value: string) {
  const url = parseSafeExternalUrl(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('拒绝打开非网页链接');
  if (typeof window !== 'undefined' && window.__TAURI__) {
    await openUrl(url.href);
    return;
  }
  const link = document.createElement('a');
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}
