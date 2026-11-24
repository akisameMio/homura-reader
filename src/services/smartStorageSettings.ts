/* ============================================================================
   HOMURA · 智能存储偏好
   ----------------------------------------------------------------------------
   只负责跨平台配置的校验与持久化，不依赖 Vue 或具体存储实现。后续自动转存
   策略通过同一份配置判断是否启用以及可使用的容量预算。
   ========================================================================== */

import { SMART_STORAGE_DEFAULTS } from './smartStorage.ts';

export const SMART_STORAGE_CONFIG_KEY = 'homura_smart_storage';
export const SMART_STORAGE_MIB_BYTES = 1024 * 1024;
export const SMART_STORAGE_DEFAULT_BUDGET_MB = SMART_STORAGE_DEFAULTS.defaultBudgetBytes / SMART_STORAGE_MIB_BYTES;
export const SMART_STORAGE_MIN_BUDGET_MB = 64;
export const SMART_STORAGE_MAX_BUDGET_MB = 4096;
export const SMART_STORAGE_BUDGET_STEP_MB = 64;

export interface SmartStorageConfig {
  enabled: boolean;
  budgetMb: number;
}

export interface SmartStorageSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SMART_STORAGE_CONFIG: Readonly<SmartStorageConfig> = Object.freeze({
  enabled: false,
  budgetMb: SMART_STORAGE_DEFAULT_BUDGET_MB
});

function browserStorage(): SmartStorageSettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeBudgetMb(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SMART_STORAGE_DEFAULT_BUDGET_MB;
  const stepped = Math.round(number / SMART_STORAGE_BUDGET_STEP_MB) * SMART_STORAGE_BUDGET_STEP_MB;
  return Math.min(SMART_STORAGE_MAX_BUDGET_MB, Math.max(SMART_STORAGE_MIN_BUDGET_MB, stepped));
}

export function normalizeSmartStorageConfig(value: unknown): SmartStorageConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: source.enabled === true,
    budgetMb: normalizeBudgetMb(source.budgetMb)
  };
}

export function readSmartStorageConfig(
  storage: SmartStorageSettingsStorage | null = browserStorage()
): SmartStorageConfig {
  if (!storage) return { ...DEFAULT_SMART_STORAGE_CONFIG };
  try {
    const raw = storage.getItem(SMART_STORAGE_CONFIG_KEY);
    return raw ? normalizeSmartStorageConfig(JSON.parse(raw)) : { ...DEFAULT_SMART_STORAGE_CONFIG };
  } catch {
    return { ...DEFAULT_SMART_STORAGE_CONFIG };
  }
}

export function writeSmartStorageConfig(
  value: unknown,
  storage: SmartStorageSettingsStorage | null = browserStorage()
): SmartStorageConfig {
  const config = normalizeSmartStorageConfig(value);
  try {
    storage?.setItem(SMART_STORAGE_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[HOMURA] 智能存储偏好保存失败', err);
  }
  return config;
}

export function smartStorageBudgetBytes(value: SmartStorageConfig): number {
  return normalizeSmartStorageConfig(value).budgetMb * SMART_STORAGE_MIB_BYTES;
}
