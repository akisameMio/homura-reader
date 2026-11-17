#!/usr/bin/env node
// `tauri dev` 被强退（Ctrl+C 连按、IDE 停止、终端被关）时，Vite 子进程常变成
// 孤儿继续占着 5173；而 vite.config.js 是 strictPort，下一次 `npm run dev` 会
// 直接报 "Port 5173 is already in use"。这里按端口找占用者并结束它：
// macOS / Linux 走 lsof，Windows 走 netstat + taskkill。
import { execFileSync } from 'node:child_process';

const PORT = Number(process.argv[2] || 5173);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[dev-port] 端口必须是 1 到 65535 的整数');
  process.exit(1);
}
const isWindows = process.platform === 'win32';

function listPids() {
  try {
    if (isWindows) {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = out
        .split('\n')
        .filter((line) => line.includes(`:${PORT} `) && line.includes('LISTENING'))
        .map((line) => line.trim().split(/\s+/).pop());
      return [...new Set(pids.filter(Boolean))];
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    });
    return [...new Set(out.split('\n').map((line) => line.trim()).filter(Boolean))];
  } catch {
    // lsof 在端口空闲时退出码为 1，netstat 也可能不可用：都按「没人占用」处理
    return [];
  }
}

function kill(pid, force) {
  try {
    if (isWindows) {
      const args = ['/PID', pid, '/T'];
      if (force) args.push('/F');
      execFileSync('taskkill', args, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), force ? 'SIGKILL' : 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

const initial = listPids();
if (initial.length === 0) {
  console.log(`[dev-port] ${PORT} 端口空闲，无需清理`);
  process.exit(0);
}

console.log(`[dev-port] ${PORT} 被 PID ${initial.join(', ')} 占用，正在结束`);
const signaled = initial.filter((pid) => kill(pid, false));
if (signaled.length < initial.length) {
  console.warn('[dev-port] 部分进程无法发送 SIGTERM，可能是其他用户或受保护进程');
}

await new Promise((resolve) => setTimeout(resolve, 1000));

const remaining = listPids();
remaining.filter((pid) => signaled.includes(pid)).forEach((pid) => {
  console.log(`[dev-port] PID ${pid} 未响应 SIGTERM，强制结束`);
  kill(pid, true);
});

if (remaining.length > 0) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const leftovers = listPids();
if (leftovers.length > 0) {
  console.error(`[dev-port] 端口仍被 PID ${leftovers.join(', ')} 占用，可能需要 sudo 或手动处理`);
  process.exit(1);
}

console.log(`[dev-port] ${PORT} 已清空，可以重新 npm run dev`);
