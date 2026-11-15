/* ============================================================================
   HOMURA · Vue 3 应用入口
   ========================================================================== */

import { createApp, watchEffect } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { isAndroid } from './services/platform.ts';
import { logRuntime } from './services/runtimeLogs.ts';
import { useI18n } from './composables/useI18n.ts';
import { useRuntimeLogStore } from './stores/runtimeLogs.ts';
import { useSettingsStore } from './stores/settings.ts';
import './assets/homura.css';

// 平台标记只用于渲染性能降级，不参与业务判断
document.documentElement.dataset.platform = isAndroid ? 'android' : 'desktop';

const { locale, t } = useI18n();
watchEffect(() => {
  document.documentElement.lang = locale.value;
  document.title = t('HOMURA — ACGN GO 本地漫画与轻小说阅读器');
  document.getElementById('homura-splash')?.setAttribute('aria-label', t('HOMURA 正在启动'));
});

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
// 先由 settings 配置等级与开关，再安装捕获，避免启动日志使用旧默认值。
useSettingsStore(pinia);
useRuntimeLogStore(pinia).installCapture();
logRuntime('info', '应用启动', 'APP', isAndroid ? 'Android' : '桌面端');
app.mount('#app');
