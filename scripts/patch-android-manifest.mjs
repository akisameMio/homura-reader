#!/usr/bin/env node
// Tauri 生成的 AndroidManifest.xml 只声明了 INTERNET。WebView 里的
// navigator.vibrate 没有 VIBRATE 权限时不会报错，而是被静默丢弃——
// 底栏槽位震动、书架长按震动在实机上就完全没反应。
//
// gen/android 是 gitignore 的构建产物，每次 `tauri android init` 都会被
// 模板重新生成，所以权限只能在这里补。脚本幂等，找不到工程时直接跳过。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST = resolve('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
const PERMISSION = '<uses-permission android:name="android.permission.VIBRATE" />';

if (!existsSync(MANIFEST)) {
  console.log('[android-manifest] 未检测到 Android 工程，跳过 VIBRATE 权限补写');
  process.exit(0);
}

const source = readFileSync(MANIFEST, 'utf8');
if (source.includes('android.permission.VIBRATE')) {
  console.log('[android-manifest] VIBRATE 权限已存在');
  process.exit(0);
}

const patched = source.replace(
  /(<manifest\b[^>]*>\s*\n)/,
  `$1    ${PERMISSION}\n`
);

if (patched === source) {
  // 工程存在却补写失败必须让构建失败：否则会静默产出没有震动权限的 APK
  console.error('[android-manifest] 未匹配到 <manifest> 开头，VIBRATE 权限补写失败');
  process.exit(1);
}

writeFileSync(MANIFEST, patched, 'utf8');
console.log('[android-manifest] 已补写 VIBRATE 权限');
