import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const tauriRoot = new URL('../src-tauri/', import.meta.url);
const read = path => readFileSync(new URL(path, tauriRoot), 'utf8');

test('本地主窗口允许已注册的原生命令，包括导入命令的 IPC 别名', () => {
  const capability = JSON.parse(read('capabilities/default.json'));
  assert.ok(capability.windows.includes('main'));
  assert.notEqual(capability.local, false);
  assert.equal(capability.remote, undefined);

  const handlers = read('src/lib.rs').match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1];
  assert.ok(handlers, '找不到应用原生命令注册表');
  const registered = new Set();
  for (const [, module, handler] of handlers.matchAll(/(\w+)::(\w+)/g)) {
    const declaration = read(`src/${module}.rs`).match(
      new RegExp(`#\\[tauri::command([^\\]]*)\\]\\s+pub (?:async )?fn ${handler}\\(`)
    );
    assert.ok(declaration, `找不到原生命令 ${module}::${handler}`);
    registered.add(declaration[1].match(/\brename\s*=\s*"([^"]+)"/)?.[1] ?? handler);
  }
  assert.ok(registered.has('scanImportPaths'));
  assert.ok(registered.has('stageImportPath'));

  const allowed = new Set();
  for (const file of readdirSync(new URL('permissions/', tauriRoot))) {
    if (!file.endsWith('.toml')) continue;
    for (const permission of read(`permissions/${file}`).split('[[permission]]').slice(1)) {
      const identifier = permission.match(/^identifier\s*=\s*"([^"]+)"/m)?.[1];
      if (!capability.permissions.includes(identifier)) continue;
      const commands = permission.match(/^commands\.allow\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
      for (const [, command] of commands.matchAll(/"([^"]+)"/g)) allowed.add(command);
    }
  }
  assert.deepEqual(allowed, registered);
});
