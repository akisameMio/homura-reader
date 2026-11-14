/* ============================================================================
   HOMURA · Vue 3 应用入口
   ========================================================================== */

import { createApp, watchEffect } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { isAndroid } from './services/platform.ts';
import { useI18n } from './composables/useI18n.ts';
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
app.use(createPinia());
app.mount('#app');
