export const sectionTitles = {
  appearance: '外观', reading: '阅读默认值', storage: '存储与数据', sync: 'WebDAV 同步',
  about: '关于 HOMURA', import: '导入偏好', debug: '调试', logs: '运行日志'
};

export type SettingsSection = keyof typeof sectionTitles;

export function readSettingsSection(state: unknown): SettingsSection | null {
  if (!state || typeof state !== 'object' || !('homuraSettings' in state) || state.homuraSettings !== true
    || !('subPage' in state) || typeof state.subPage !== 'string' || !Object.prototype.hasOwnProperty.call(sectionTitles, state.subPage)) return null;
  return state.subPage as SettingsSection;
}
