import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SMART_STORAGE_CONFIG,
  SMART_STORAGE_CONFIG_KEY,
  SMART_STORAGE_DEFAULT_BUDGET_MB,
  SMART_STORAGE_MAX_BUDGET_MB,
  SMART_STORAGE_MIN_BUDGET_MB,
  readSmartStorageConfig,
  smartStorageBudgetBytes,
  writeSmartStorageConfig
} from '../src/services/smartStorageSettings.ts';

test('智能存储默认关闭并使用 512 MB 预算', () => {
  const storage = { getItem: () => null, setItem() {} };
  assert.deepEqual(readSmartStorageConfig(storage), DEFAULT_SMART_STORAGE_CONFIG);
  assert.equal(DEFAULT_SMART_STORAGE_CONFIG.enabled, false);
  assert.equal(SMART_STORAGE_DEFAULT_BUDGET_MB, 512);
  assert.equal(smartStorageBudgetBytes(DEFAULT_SMART_STORAGE_CONFIG), 512 * 1024 * 1024);
});

test('智能存储预算按 64 MB 取整并限制在允许范围', () => {
  const saved = new Map();
  const storage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  };
  assert.deepEqual(writeSmartStorageConfig({ enabled: true, budgetMb: 700 }, storage), {
    enabled: true,
    budgetMb: 704
  });
  assert.deepEqual(JSON.parse(saved.get(SMART_STORAGE_CONFIG_KEY)), { enabled: true, budgetMb: 704 });
  assert.equal(writeSmartStorageConfig({ enabled: true, budgetMb: 1 }, storage).budgetMb, SMART_STORAGE_MIN_BUDGET_MB);
  assert.equal(writeSmartStorageConfig({ enabled: true, budgetMb: 9000 }, storage).budgetMb, SMART_STORAGE_MAX_BUDGET_MB);
});

test('无效或不可读取的智能存储配置回退默认值', () => {
  const invalid = { getItem: () => '{', setItem() {} };
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(readSmartStorageConfig(invalid), DEFAULT_SMART_STORAGE_CONFIG);
    assert.deepEqual(readSmartStorageConfig(denied), DEFAULT_SMART_STORAGE_CONFIG);
    assert.deepEqual(writeSmartStorageConfig({ enabled: 'true', budgetMb: 'wide' }, denied), DEFAULT_SMART_STORAGE_CONFIG);
  } finally {
    console.warn = warn;
  }
});
