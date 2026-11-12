# AGENTS.md — HOMURA 协作指南

> 本文件写给接手 HOMURA 的 AI agent 或新协作者。动代码前先读完这里。
> README、`.trae/documents` 里的旧笔记可能滞后；若与代码冲突，以**当前代码 + 本文件**为准。

## 1. 项目是什么

HOMURA 是一个**本地优先**的 ACGN 阅读器：漫画、轻小说、图集拖进来就能看，解析与渲染全部在本机完成，不上传任何文件。桌面端用 Tauri 2 打包（macOS / Windows / Linux），同一套前端也构建 Android APK。

- 当前版本 `2.2.6`
- 技术栈：Vue 3 + Pinia + Vite 6 + Tauri 2（Rust）
- **TypeScript**：`src/services/`（39 个）、`src/stores/`（7 个）、`src/composables/`（10 个）三层的逻辑代码已全部迁移为 `.ts`；`components/`（41 个 `.vue`）的 `<script setup>` 已全部升级为 `lang="ts"`（保留原有运行时 `defineProps({...})` / `defineEmits([...])` 写法，未改写成泛型语法）；入口 `src/main.ts` 亦已迁移。`tsconfig.json` 开 `allowJs: true` 允许 JS/TS 混存，`strict: true`，且 `noImplicitAny` / `noUnusedLocals` / `noUnusedParameters` 均已开启。`npm run typecheck`（`vue-tsc --noEmit`）已清零 0 报错，可作为门槛使用。没有 ESLint；**有单元测试**（`node:test` + jsdom），没有 E2E
- 新增 / 迁移文件时，指向已迁移 `.ts` 文件（services / stores / composables）的 import 必须写 `.ts` 后缀（Node `--experimental-strip-types` 不会把 `./x.js` 解析到 `x.ts`，只有 Vite / tsc 会）
- 数据存本机 IndexedDB（`homura_shelf`，v3，4 个 store：`books` / `sources` / `progress` / `collections`）；Tauri 环境额外把书目 / 书库 / 进度镜像到 `$APPDATA/homura-metadata/homura.sqlite3`；原文件按平台写 `$APPDATA/homura-native-sources`、OPFS（`homura-sources`）或 IndexedDB Blob；主题与设置偏好写 localStorage

支持的格式：

| 格式 | 扩展名 | 实现入口 |
| --- | --- | --- |
| EPUB / KEPUB | `.epub`、`.kepub.epub` | `src/services/epubParser.ts`（`parsers.ts` 调度） |
| CBZ / ZIP | `.cbz`、`.zip` | `src/services/cbzParser.ts`（原生按需解页 + JSZip 回退） |
| PDF | `.pdf` | `src/services/pdf.ts`（pdf.js，按页懒渲染） |
| MOBI | `.mobi`、`.prc`、`.azw` | `src/services/mobi.ts`（不支持 DRM / AZW3） |
| 纯文本 / Markdown | `.txt`、`.md` | `parsers.ts` + `markdown.ts` + `textEncoding.ts`（GB18030 兜底） |
| 图片文件夹 | jpg/jpeg/png/webp/gif/avif/bmp | `parsers.ts` 的图片文件夹构建 + `collections.ts` 的目录建库 |

CBZ / ZIP 与 EPUB 共用原生 ZIP 通道：漫画压缩包只把图片条目按自然序暴露成页，EPUB 仍按文档条目读取。

## 2. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装前端依赖；Tauri 命令找不到时先跑这个 |
| `npm test` | `node --experimental-strip-types --test tests/*.test.mjs`，当前 36 个测试文件、259 条用例全绿，约 4 秒。`--experimental-strip-types` 让 Node 直接加载测试所引用的 `.ts` service |
| `npm run typecheck` | `vue-tsc --noEmit`，类型检查 |
| `npm run dev:vite` | 只起 Vite 开发服务器，固定端口 **5173**（strictPort），带 HMR |
| `npm run build:vite` | `check:dark-glow` + 构建前端到 `dist/`（最常用的快速验证） |
| `npm run check:dark-glow` | 扫描夜间白色泛光；`build:vite` 会自动执行 |
| `npm run dev` | `tauri dev`；Vite 由 `beforeDevCommand` 自动拉起，不要手拼两条命令 |
| `npm run build` | `tauri build`，产物在 `src-tauri/target/release/bundle/` |
| `npm run icons:generate` | 从源图生成全平台应用图标 |
| `npm run android:init` | `tauri android init` + `android:sync-icons` |
| `npm run android:dev` | Android 开发 |
| `npm run android:build` | Android arm64 release APK（需本地配置 release keystore） |
| `npm run android:build:debug` | Android arm64 debug APK |
| `npm run tauri` | 直通 Tauri CLI |

环境要求：Node.js 22+、Rust stable ≥ **1.77.2**（`Cargo.toml` 的 `rust-version`），以及对应平台的 Tauri 依赖。

**验证方式**：`npm run build:vite` 必须通过；改动涉及解析 / 存储 / 书库 / 手势时先跑 `npm test`；然后在 `http://localhost:5173` 用浏览器检查控制台无报错，再按改动范围手动验证桌面 / 窄屏 / 三种表面模式。`dist/index.html` 不能直接 `file://` 双击打开，必须走开发服务器或静态服务器。

CI **不跑** `npm test`，只 `npm ci` + 构建；所以本地跑测试是唯一防线。

## 3. 目录与职责

```text
index.html                 Vite 入口；首帧前同步加载 public/homura-boot.js 恢复主题/阅读模式 + 启动图（z-index 10000）
vite.config.js             Vue 插件 + 相对路径 base + pdf.js 资源同步 + 生产 Tailwind 预编译
tailwind.config.js         构建期 Tailwind 配置（开发环境仍读 public/vendor/tailwind-config.js）
src/
  main.ts                  createApp + Pinia + 写入 documentElement.dataset.platform
  App.vue                  总布局、侧栏/底栏骨架、书架筛选与排序、FAB、离屏分页测量器、启动图收尾
  assets/
    homura.css             样式入口，只有 6 行 @import（顺序即层叠顺序）
    styles/
      tokens.css           MD3 色彩 / 间距 / 圆角 / 阴影 token，末尾是 legacy 别名映射
      base.css             根布局、平台标记、手机底栏根节点、阅读器返回遮罩与边缘
      library.css          书架、书库卡、网格、FAB、拖拽 ghost、手机底部胶囊
      overlays.css         阅读器顶栏 / 抽屉 / 菜单 / 弹层
      controls.css         按钮、开关、分段控件、44px 命中区
      canvas.css           阅读表面、翻页舞台、surface-reveal 主题切换遮罩
      legacy.css           历史遗留组件样式（.uiverse-btn 等）
      theme-picker.css     主题色板
      content.css          阅读内容排版（小说正文 / 章节 / Markdown）
  stores/                  7 个 setup store：theme / shelf / reader / ui / settings / importProgress / updates
  services/                39 个：解析、存储、平台、原生桥接、更新（不依赖 Vue / Pinia）
  composables/             10 个：useImporter / useViewport / useShortcuts / useSheetDrag / useShelfDialogs /
                           useScrollBounce / useDuplicateImport / useReaderBackDismiss / useAndroidBackExit /
                           useVolumeKeys
  components/              41 个 SFC（视图与交互）
tests/                     36 个 .test.mjs（node:test + assert/strict + jsdom）
scripts/                   5 个：check-dark-glow / generate-icons / release-notes / sync-android-icons /
                           patch-android-manifest
references/                4 份规范：md3-component-guide / tokens / ui-component-spec / desktop-island
public/homura-boot.js      首帧前的同步引导脚本（CSP 禁止内联脚本，不能挪回 index.html）
public/vendor/             开发环境运行时 Tailwind；生产构建转静态 CSS 并从 dist 删除
public/pdfjs/              pdf.js 运行时资源，由 vite 插件生成，已 gitignore
src-tauri/src/             lib.rs 命令注册 + desktop_archive / native_import / metadata_store /
                           mobi_parser / text_decoder / cover_thumb / update_downloader /
                           window_state / storage_stats
src-tauri/plugins/         6 个本地 Android 插件：android-archive / android-installer /
                           android-predictive-back / android-system-bars / android-toast /
                           android-volume-keys
design-preview/            设计原型 HTML 与截图，不是生产代码
.github/workflows/         三平台 + Android 自动打包
```

`src/services/` 的关键分工（39 个文件，别只看名字猜）：

- **解析**：`parsers.ts`（总入口与调度）、`epubParser.ts`、`cbzParser.ts`（CBZ / ZIP 漫画）、`epubType.ts`（漫画/小说判定）、`pdf.ts`、`mobi.ts`、`markdown.ts`、`pagination.ts`（小说智能分页、章节/图片页构建）、`readerLayout.ts`（页宽 / 行高 / 页边距度量）、`textEncoding.ts`
- **存储**：`storage.ts`（IndexedDB 完整存档 + SQLite 镜像）、`nativeMetadata.ts`、`nativeStorage.ts`、`opfs.ts`、`restore.ts`、`progress.ts`、`mutationQueue.ts`（串行写队列）
- **原生桥**：`nativeRuntime.ts`（错误码与能力探测）、`nativeArchive.ts`（桌面 EPUB 会话）、`nativeImport.ts`、`coverThumb.ts`、`androidSystemBars.ts`、`updateDownload.ts`
- **书库/书架**：`collections.ts`（书库归属与目录建库规划）、`collectionReading.ts`（书库内连读顺序）、`bookTitles.ts`（拼音排序）、`shelfSections.ts`（小说/漫画/其他分段）、`bookCover.ts`
- **其它**：`platform.ts`、`archiveAccess.ts`（JSZip 与原生统一的压缩包适配层）、`sanitize.ts`、`readerGestures.ts`、`updates.ts`、`external.ts`、`demo.ts`、`utils.ts`

注意：README 的「项目结构」段落仍列着 `AppHeader / DropZone / ReaderToolbar` 等旧组件名，**已过时**，实际以 `src/` 为准。

## 4. 代码与架构约定

- **Vue 3 `<script setup>` 单文件组件**，TypeScript。保持现有风格：2 空格缩进、单引号、语句结尾分号。
- 分层边界：
  - `services/` 不依赖 Vue / Pinia，负责解析、存储、平台适配；需要 DOM/Canvas 的逻辑（如 PDF 渲染）也集中在这里。
  - `stores/` 只放状态与动作，不直接写复杂 DOM。
  - `composables/` 放可复用的组合逻辑。
  - `components/` 只负责视图与交互。
- Pinia 使用 **setup 写法**（`defineStore('x', () => {...})`），动作就是普通函数。现有 store id：`theme`、`shelf`、`reader`、`ui`、`settings`、`importProgress`、`updates`。
- **重对象必须 `shallowRef`**：`zipContent`、`File`、`Animation`、timer、DOM 引用一律不要被 Vue 深度代理，否则会拖慢动画，甚至让 `Animation.cancel()` 异常。
- 翻页引擎 `PaginatedView.vue` / `WebtoonView.vue` **直接操作 ref DOM + Web Animations API**，不走响应式重渲染。不要为了“优雅”改写成 `v-for` + 响应式布局。
- Tauri 通过 `window.__TAURI__` 全局对象与 `@tauri-apps/plugin-*` 调用，项目不直接依赖 `@tauri-apps/api`。新增原生能力时必须同步 Rust 插件注册与 `src-tauri/capabilities/default.json` 的 permissions。
- **原生错误码有硬边界**：`nativeRuntime.ts` 的 `NEVER_FALLBACK_CODES = { SECURITY_LIMIT, LIMIT_EXCEEDED }` 绝不允许回退到 JS 实现；其余错误（`UNAVAILABLE` / `UNSUPPORTED` / `DISABLED` / `COMMAND_FAILED` / `INVALID_DATA` / `CANCELLED`）才允许回退。回退链统一走 `archiveAccess.ts`，不要在业务组件里手写 try/catch 降级。
- P4 的 SQLite 只是元数据镜像，IndexedDB 的 `books + sources` 事务才是书籍是否存在与删除顺序的最终依据。任何原生元数据写入前必须先落 `homura-native-metadata-dirty`，成功后清除；下次启动发现标记时从 IndexedDB 全量重建 SQLite。禁止改成 SQLite 先删、IndexedDB 后删。
- SQLite 位于 `$APPDATA/homura-metadata/homura.sqlite3`，使用 WAL 与 `rusqlite` bundled，不能依赖系统 SQLite。`image` 固定 `0.25.5` 以兼容项目 MSRV；升级前先确认其 `rust-version`。
- 书库、收藏、进度这类会写盘的状态统一走 `mutationQueue.ts` 串行化（`shelf.ts` 内有 `collectionQueue` / `favoriteQueue` / `mutationQueue` 三条队列），不要并发直写。
- Android 漫画页由 Kotlin 按屏幕长边降采样并转成 WebP，再由 asset 协议直接喂给 `<img>`。`src-tauri/Cargo.toml` 的 `protocol-asset` feature 与 `tauri.conf.json` 的 `$APPCACHE/**` scope 必须保留，删掉会退回 Blob 通道并明显变慢。
- 原生页缓存（Android Kotlin / 桌面 Rust）按最近访问时间 LRU 淘汰（24 个文件 / 192MB）。EPUB 的条目索引和阅读页序无关，禁止按 index 前后窗口删缓存或预取；前端页图 URL 回收也必须跟翻页同步执行，不能依赖延时的预载任务。
- 图标统一走 `src/components/MdIcon.vue`（Material Symbols 24dp 内联路径），选中态用 `filled`；不引入图标库 / 组件库。新增依赖需要明确理由。
- 注释用中文；复杂模块顶部保留现有的 banner 注释风格。只在逻辑不直观处写注释，不要给没改动的代码补注释。
- 全局 Toast 已移除：不要重新引入 toast / alert；可恢复错误记录到 console。唯一例外是 Android 原生返回提示（`plugin:android-toast|show`，文案「再按一次退出」）。

## 5. UI 规则（弱约束 / 倾向性指引）

界面已全量 Material Design 3 化：**10 套主题 × 白昼/护眼/夜间 3 种表面**。以下规则是**推荐约定**，帮助新 UI 与既有界面保持一致；一般情况下优先遵循，如果确有必要、且经过权衡（或在 PR / 说明里写明理由）可以偏离，不算违规。真正的硬边界（启动不黑屏、CSP、存储降级等）见第 6 节。

### 5.1 颜色

- 所有颜色走 CSS 变量 `--md-*`，Tailwind 写任意值类，例如 `bg-[var(--md-surface-container)]`、`text-[var(--md-on-surface-variant)]`。
- 推荐用 CSS 变量而不是新增 hex / rgb / 纯黑纯白；需要派生色用 `color-mix(in oklab, var(--md-x) NN%, ...)`；阴影、渐变里的透明色除外。
- 容器色建议成对使用 `on-*` 文字色；暗色模式靠这对 token 自动反转，尽量避免写死白字/黑字。
- 新代码尽量别用旧别名 `--brand-* / --bg-* / --fg-* / --border-line`。注意 `tokens.css` 末尾仍保留这组 legacy 别名到 `--md-*` 的映射，`DragOverlay.vue`、`WebtoonView.vue`、`NovelCard.vue`、`ReaderModal.vue`、`legacy.css` 等存量代码还在用；迁移一处删一处，但不要直接删映射，否则存量会瞬间失色。
- Tailwind 在 CSS 变量上直接加透明度修饰（如 `bg-[var(--md-surface)]/92`）不可靠，会变成透明；需要透明度就用 `color-mix`。
- 投影用 `var(--md-shadow-color-soft)`（shadow-color 与 surface 的 52% 混合，夜间不再变亮），遮罩（scrim）与描边环继续用 `var(--md-shadow-color)`；不要在 `box-shadow` / `drop-shadow` / `text-shadow` / scrim 背景里使用 `--md-on-surface` 或 `--md-on-surface-variant`，它们在夜间会翻转成近白色并产生泛光。`npm run check:dark-glow` 会拦截这类写法。
- 一屏只保留一个 `primary` 实心主行动（书架只有「导入」FAB / 桌面灵动胶囊）。

### 5.2 主题与表面

- 根节点靠 `data-theme`（green/mint/cyan/blue/violet/orchid/sakura/red/amber/olive）+ `data-mode`（light/warm/dark）切换。组件应统一调 `theme.setThemeColor()` / `theme.setSurfaceMode()` 切主题，不要自行改 `data-theme` / `data-mode`。
- 新增主题必须同步：`styles/tokens.css` 的明色块与暗色块；`stores/theme.ts` 的 `THEME_OPTIONS`（名称与三阶 `tones` 预览色）。两处入口共用 `ThemeSwatchGrid.vue`，不要再复制色板数组。
- 三种表面的画布底色是硬编码常量，改主题时要一起看：`{ light: '#F8FAFC', warm: '#FAF6EE', dark: '#0F1115' }`，同时出现在 `public/homura-boot.js` 与 `stores/theme.ts`。
- 外观面板宽 **280px**，10 个主题色块固定为 **5 列 × 2 行**（`ThemeSwatchGrid` 的 `columns` 默认 5）；单个色块保持约 44px 的触控尺寸。

### 5.3 布局与断点

- 布局主断点 **900px**：`<900` 走手机布局（悬浮胶囊底栏 + bottom sheet），`>=900` 走桌面布局（浮动侧栏 + side sheet）。JS 用 `isCompact`（`COMPACT_MAX = 899`），Tailwind 用 `min-[900px]:`。
- `useViewport` 还暴露 `isPhone(≤767)`、`isTablet(768–1023)`、`isDesktop(≥1024)`，只用于细节，不要拿它替代 900 主断点。
- 桌面窗口 `minWidth` 是 900，所以桌面端基本不会进入 compact；compact 主要服务于 Android / 浏览器窄屏调试。
- 桌面骨架：浮动圆角侧栏（展开 220px / 折叠 104px，`SideNav.vue`）→ 主列 → 64px sticky 顶栏（手机 56px）。侧栏展开/折叠只跟随用户手动偏好（`homura_sidenav_collapsed`），不按窗口宽度强制折叠。
- 侧栏展开/折叠使用 `280ms` 宽度与内部位置过渡；`prefers-reduced-motion: reduce` 时直接切换。
- 展开侧栏在 `900–1079px` 时，书架顶栏搜索框独占一行；`>=1080px` 才嵌入顶栏中段，避免压住标题和右侧按钮。
- 手机底部导航是悬浮胶囊（`SideNav.vue` 的 `.mobile-nav`）：`left/right 14px`、`height 76px`、`border-radius 38px`、`max-width 560px`、`bottom: calc(14px + env(safe-area-inset-bottom))`；内容区必须挂 `.md-bottom-nav-space`（`6.5rem + safe-area`）。
- 网格建议只用 `.md-shelf-grid`，跨列用 `.md-featured-cell`；FAB 与桌面灵动胶囊都用 `.md-fab-pos`，尽量避免在组件里另写 `grid-cols-*`。
- 抽屉：桌面右侧 `w-[372px]`；手机底部 `max-h-[78dvh] rounded-t-[28px]` + 拖拽条 + 安全区 padding。遮罩用 `.md-scrim`，进出场用 `md-sheet-enter-active` / `md-sheet-leave-active`。
- **z-index 阶梯**（新增层先沿用现有层级，别随手写大数）：

  | 层 | z-index | 位置 |
  | --- | --- | --- |
  | sticky 顶栏 | 20 | `LibraryHeader.vue`、`SettingsView.vue` |
  | 浮层菜单 / 阅读器顶栏 / 阅读手势层 / 浮动侧栏 | 30 | `overlays.css:142`、`PaginatedView.vue` 手势层（必须高于翻页舞台的 20） |
  | 阅读器返回边缘 | 31 | `.reader-back-edge` |
  | 阅读状态条 | 35 | `.md-reader-status` |
  | 手机底部导航 / 遮罩 / FAB / 灵动胶囊 | 40 | `#homura-mobile-nav-root`、`.md-scrim`、`.md-fab-pos` |
  | 阅读器返回遮罩 | 45 | `.reader-back-scrim` |
  | sheet / 抽屉 / 阅读器本体 | 50 | `.md-drawer`、`ReaderModal.vue` |
  | 拖拽导入遮罩 / 长按拖拽 ghost | 60 / 65 | `DragOverlay.vue`、`.md-touch-drag-ghost` |
  | 主题切换遮罩 / 启动图 | 9999 / 10000 | `.surface-reveal`、`#homura-splash` |

### 5.4 文字与动效

- 字体：`font-sans` 正文（Inter/PingFang），`font-display` 书封标题，`font-mono` 元信息，竖排书封用宋体 / Instrument Serif。
- 字号建议沿用现有档位：正文/输入 13、次要 12、分组标签与元信息 11 / 10 / 10.5、页面标题 21–22、sheet 标题 17、极小徽标 8–9.5。3 个连续的小字号（如 14 / 15 / 16）容易让层次糊掉，能避开就避开。
- 动效统一 200ms `cubic-bezier(0.2, 0, 0, 1)`；卡片 hover 可用 280ms `cubic-bezier(0.16, 1, 0.3, 1)`。只过渡颜色/位移/阴影，不给布局属性加 transition；侧栏展开/折叠、桌面灵动胶囊分裂/合并的宽度与内部重排过渡是仅有的例外。
- 尊重 `prefers-reduced-motion`。图标按钮建议带 `title` 或 `aria-label`；开关用 `role="switch"`；用 `<div @click>` 当按钮的可访问性与键盘支持较差，优先用原生 `<button>`。
- 触控命中区：小图标按钮挂 `.md-hit-target`（命中区补到 `max(100%, 44px)`）；手机菜单条目挂 `.md-mobile-menu-item`（`min-height: 44px`）。

### 5.5 参考

- 新增或重做组件前，先读 [references/md3-component-guide.md](references/md3-component-guide.md)；里面有按钮、开关、分段控件、列表和抽屉的直接写法。
- Token 全表见 [references/tokens.md](references/tokens.md)，系统级布局说明见 [references/ui-component-spec.md](references/ui-component-spec.md)。
- 桌面灵动胶囊的状态机、尺寸、分裂 / 合并动效与焦点规则见 [references/desktop-island.md](references/desktop-island.md)；实现是 `DesktopIsland.vue` + `ImportMenuSheet.vue` + `ImportProgressPanel.vue` + `UpdateIslandPanel.vue`。
- 旧笔记 `.trae/skills/homura-md3-ui/SKILL.md` 只作补充；`.trae/` 被 gitignore，克隆仓库后可能不存在。与上述文档或当前 `src/` 冲突时，以当前代码和 `references/md3-component-guide.md` 为准。

## 6. 不能破坏的行为

这些是已经踩过坑、且用户明确要求保留的行为：

1. **启动不许黑屏**：`tauri.conf.json` 里主窗口 `visible: false`，`src-tauri/src/lib.rs` 在 `PageLoadEvent::Finished` 后才 `show()`；前端另有 `#homura-splash`（`SPLASH_MIN_DURATION = 720`）接棒。不要改成启动即显示。
2. **首帧不许闪主题**：`public/homura-boot.js` 在 `<head>` 里以普通脚本同步加载，首帧前读 `homura_theme_color` / `homura_surface_mode` 并写 `data-theme` / `data-mode` / `dark`，同时改 theme-color meta。不要挪进 Vue 里异步恢复，也不要退回 `index.html` 内联写法（CSP 的 `script-src` 不含 `'unsafe-inline'`）。
3. **标题栏跟内容一起换色**：模式切换时，原生窗口 `setTheme` / `setBackgroundColor` 必须在动画**开始时**调用，不能等动画结束。逻辑在 `stores/theme.ts` 的 `setSurfaceMode`。
4. **模式切换动画**：从被点击的「白昼 / 护眼 / 夜间」按钮中心圆形展开新配色。`stores/theme.ts` 用旧表面色遮罩与透明遮罩孔实现，`SURFACE_REVEAL_DURATION = 720`；按钮坐标由 `MdSegmentedControl` 通过 `update:modelValue` 的第二个参数传入。WebKit 下 View Transitions API 不可靠，不要换回去。切换期间 `html.surface-switching` 会抑制全局过渡，别加冲突的全局 transition。
5. **顶部工具栏自动隐藏 2.2 秒**：`stores/ui.ts` 的 `AUTO_HIDE_DELAY = 2200`；点击阅读画布 / 轻点可唤出。抽屉打开时不自动隐藏。底部页脚常驻纸面，不跟随顶栏隐藏。
6. **移动端手势**：横向滑动跟手翻页，带阻尼与回弹；轻点左 30% 上一页、右 30% 下一页、中间切换工具栏（`readerGestures.ts`：`ratio < 0.3 → left`、`>= 0.7 → right`，轻点判定 `TAP_MAX_DURATION = 300` / `TAP_MAX_DISTANCE = 8`）。手势层 z-index 必须高于阅读舞台，否则会被图片层拦截。
7. **窄屏强制单页**：`DOUBLE_SPREAD_MIN_WIDTH = 768`，`<768` 即使设置里选了双页也只按单页渲染。
8. **存储降级**：Tauri 平台（含桌面）优先把原文件写入应用私有 AppData（`homura-native-sources`），容量只受磁盘剩余空间限制；桌面普通文件若有 FileSystemFileHandle 仍保留零拷贝句柄，无句柄或原生写入失败再回退 OPFS（`homura-sources`）与 IndexedDB Blob。EPUB 解析前会先 staging 到 AppData。读取时逐层回退，不能因为前一层失效就判定整本书丢失。导入后检查配额，已用 ≥85% 或剩余 <200MB 时提示。不要删掉这套备份方案。
9. **全屏走 Tauri 原生窗口 API**：Windows WebView2 不接管 F11，`stores/ui.ts` 的 `toggleFullscreen` 已处理；浏览器调试环境才回退 Fullscreen API。快捷键 `f`。
10. **PDF 资源必须随包分发**：`vite.config.js` 的 `pdfjsAssets` 插件会把 `cmaps / standard_fonts / wasm / iccs` 同步到 `public/pdfjs`。删掉插件会导致 PDF 白屏。`public/pdfjs` 已 gitignore，不要提交。
11. **PDF 渲染约束**：按页懒加载，`MAX_CACHED_PAGES = 24`；首次打开默认单页（`applyLayoutForBook` 里 `if (book.format === 'pdf') next.spread = 1`）；不支持字号调整与重排。
12. **Markdown 安全**：输出会进 `v-html`，原始 HTML 必须经 `sanitize.ts` 的 `ALLOWED_TAGS` 白名单校验，链接/图片只放行 `http/https/mailto/tel` 与相对路径。章节按一级/二级标题切分，并排除代码块内的标题标记。
13. **进度与排版记忆**：翻页、滚轮、条漫滚动、拖进度条都要按书保存，包含方向 / 单双页 / 首页单排 / 字号（14–28，偶数档）/ 字体（宋 / 黑 / 楷）/ 行距 / 页边距 / 条漫尺寸。目录展开状态与书签目前**没有**持久化，书签功能尚未实现，这是已知限制，不要假装已支持。
14. **重对象不进响应式深度代理**：见第 4 节。`PaginatedView` 的双缓冲动画对象尤其不能变成 `ref` 深层代理。
15. **桌面原生压缩包会话**：EPUB / CBZ / ZIP 只从 `homura-native-sources` 读取，Rust 按 ZIP 中央目录随机读取条目到 AppCache；CBZ 只暴露图片条目，路径越界、条目过多、解压超限必须直接失败。JSZip 只对不可用、暂不支持或普通解析失败回退，不能吞掉 `NATIVE_SECURITY_LIMIT` / `NATIVE_LIMIT_EXCEEDED`。
16. **封面与元数据原生兜底**：封面缩略图优先走 Rust `create_cover_thumbnail` / `create_cover_thumbnail_from_archive`，格式不支持、命令不可用或没有 Tauri 时才回退 Canvas；原生像素 / 输入大小上限不得继续交给 JS 重试。SQLite 元数据失败时回退 IndexedDB，但 `dirty` 标记与删除顺序不能删，否则旧镜像可能复活已删除书本。
17. **书库归属唯一**：每本书最多属于一个书库，`moveCollectionBooks` 负责搬移而不是复制；删除书库不能连带删书。
18. **导入必须可取消可重试**：`useImporter` + `importProgress` store 支持取消、单本失败重试、同名确认、按批提交。并发与批量上限是实测过的（桌面 4 / Android 2，超 64MB 降到 3、超 256MB 降到 2、Android 超 32MB 降到 1），不要随手调高。
19. **应用内更新只认官方仓库**：`updates.ts` 的 `REPOSITORY_URL` 与 `external.ts` 的白名单都锁死 `github.com/Leon-Ning-san/HOMURA-reader`；下载只校验字节数与 `expected_size` 一致，没有签名/哈希校验，不要对外宣称更强保证。
20. **Android 预见式返回**：`useReaderBackDismiss` 直接写 `--homura-back-*` CSS 变量驱动动画，**不能**改成响应式状态，否则返回手势会掉帧。native 模式（API 34+）必须同时保留 `app.onBackButtonPress` 的 JS 兜底监听：框架在 `Checker` 校验不过时只打日志、静默丢弃原生回调，插件却照样 resolve，一旦撤掉 JS 监听，阅读器期间就没有任何返回消费者，返回会落到 Tauri `AppPlugin` 的 `activity.onBackPressed()` 直接 finish 并退回桌面。原生回调是 top 时 JS 收不到事件，两条通道不会重复触发，不要「优化」成单通道。
21. **CSP 严格白名单**：`tauri.conf.json` 的 `app.security.csp` 已启用，`script-src` 不含 `'unsafe-inline'`，注入的 `<script>` 与 `on*` 事件处理器会被浏览器直接拦掉；`'unsafe-eval'` 是 vendor Tailwind 运行时与 pdf.js wasm 必需的，别删。漫画页走 asset 协议，`img-src` / `media-src` 必须保留 `asset:` 与 `http://asset.localhost`（Windows / Android 用 `http://asset.localhost`，macOS / Linux / iOS 用 `asset://localhost`），删掉会整本漫画白屏。新增站外请求域名要同步登记进 `connect-src`；启动引导只能放 `public/homura-boot.js`。

## 7. 常见坑

- 依赖没装就 `npm run dev` 会提示找不到 tauri 命令：先 `npm install`。
- `dist/index.html` 用 `file://` 打开会因相对路径 / IndexedDB 限制而异常，必须走 `http://localhost`。
- PDF 白屏优先查 `public/pdfjs/` 是否生成、控制台是否有 cmaps / standard_fonts 404。
- 原生漫画页白屏先确认 `protocol-asset` feature 与 assetProtocol scope 是否还在；`ensurePageUrlLoaded` 在 asset 失败时会自动回退 Blob，回退仍白屏才是解码/缓存问题。
- 桌面 EPUB 原生通道异常时先确认导入文件已写进 `$APPDATA/homura-native-sources`，并检查 `openDocument` 是否注册；安全限制错误本来就不会回退 JSZip。
- SQLite 书目异常时先查 `$APPDATA/homura-metadata/homura.sqlite3` 与控制台是否出现 `原生元数据不可用`；保留 `homura-native-metadata-dirty` 让下次启动重建，不要手工只清 SQLite 行。封面格式不支持时 Rust 返回 `NATIVE_UNSUPPORTED`，Canvas 会接管；`NATIVE_LIMIT_EXCEEDED` 不会回退。
- Tailwind 对 CSS 变量加透明度修饰会失效，改用 `color-mix`。
- 夜间出现白色泛光时，优先检查 `--md-on-surface` / `--md-on-surface-variant` 是否被当作阴影或遮罩色；投影统一改用 `--md-shadow-color-soft`（遮罩仍用 `--md-shadow-color`），并运行 `npm run check:dark-glow`。
- 触屏上不要依赖 `:hover` 显示操作按钮；触屏常显，鼠标设备才 hover。
- iOS Safari 不支持文件夹选择与 File System Access API；Android WebView 可能暴露 `showOpenFilePicker`，但 `content://` 句柄跨重启会失去权限，`platform.ts` 已强制 Android 关闭 FSA。Android 系统选择器也选不到目录，不要绕开这些降级。
- 本地与 `origin` 分叉时直接 push 会被拒；先 `git pull --rebase`，别强推。
- `.trae/` 是本地 agent 配置，已被 gitignore；不要把其中的 skill / 文档当作仓库内容。
- `.trae-html-share-packages/` 与历史遗留的 `homura-ultra.html.zip` 已在 `b5284af` 清理，不要再提交同类产物。
- `design-preview/` 是可交互设计原型和截图，不是生产代码。它在 `.gitignore` 里，但**历史提交仍跟踪 60 个文件**；要改真实界面请改 `src/`，不要把原型当发布物，也不要继续往里加新文件。
- 仓库使用 **MIT License**（`LICENSE` 根目录文件，版权方 `Leo NING` 与 `AkisameRin`）；改动依赖或捆绑第三方代码时，注意其许可与本协议兼容，并把必要声明保留在新的打包产物里。

## 8. 提交与发布

- 提交信息按 **Conventional Commits**：`feat:` / `fix:` / `perf:` / `refactor:` / `docs:` / `build:` / `ci:` / `chore:`。冒号后的描述必须使用中文；Release 说明会原样复用该描述，不做自动翻译。
- CI 只在推送 `v*` tag 或手动 `workflow_dispatch` 时运行，不响应 main 分支推送；两个 job：`build`（三平台矩阵）与 `android`（needs: build）。
- 平台产物：macOS Universal `.dmg`、Windows `.msi` / NSIS、Linux **仅 deb + rpm**（不出 AppImage）、Android arm64 release APK（CI 使用 GitHub Secrets 中的 keystore 签名）。
- tag 触发时用 `scripts/release-notes.mjs` 生成说明，由 tauri-action 建**草稿** Release；手动触发只上传 artifacts，保留 14 天。
- 发版时版本号要同步 3 处：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。
- 不要提交：`node_modules/`、`dist/`、`public/pdfjs/`、`src-tauri/target/`、`src-tauri/gen/`、`.trae/`、`.trae-html-share-packages/`、`.DS_Store`、`HOMURA-test.exe`、各 Android 插件的 `build/` 产物。

## 9. 完成定义（Definition of Done）

改动交付前至少确认：

- [ ] `npm run build:vite` 通过，控制台无报错、无 404。
- [ ] 动了 `services/` 的解析 / 存储 / 书库 / 手势逻辑时，`npm test` 全绿（必要时补用例，测试在 `tests/`）。
- [ ] 浏览器 390px / 899px / 900px / 1440px 四档宽度下无横向溢出、底部导航和 FAB 不压内容。
- [ ] 白昼 / 护眼 / 夜间三种表面逐屏检查，没有硬编码白字或暗底发灰。
- [ ] 改 UI：10 套主题都能切，外观面板 280px 双行五列，sheet 可关闭，`prefers-reduced-motion` 不崩。
- [ ] 改阅读器：LTR / RTL / 竖排、单页 / 双页、翻页动画、进度恢复都正常。
- [ ] 改导入 / 解析：用真实样本验证对应格式；PDF 需覆盖中文文本与扫描件；Markdown 需测 `<script>` 与 `javascript:` 链接。
- [ ] 改书库 / 收藏：建库改名删库、书本搬移、连读顺序、重启后恢复都正常。
- [ ] 改更新链路：手动检查 `npm run build` 后下载与安装路径，不要只测检查更新。
- [ ] 改 Tauri / 窗口：跑 `npm run dev`，确认启动不黑屏、标题栏随模式换色、全屏可进出。
- [ ] 新代码里搜不到新增 hex / `rgb(`，没有引入图标库或组件库。
- [ ] 新增投影使用 `--md-shadow-color-soft`、遮罩使用 `--md-shadow-color`，`npm run check:dark-glow` 通过。
- [ ] 没有提交任何构建产物。

## 10. 去哪里找上下文

- `README.md`：功能、快捷键、构建、已知限制（**项目结构段落过时**，且「暂无自动化测试」已不成立）。
- `references/`：MD3 组件写法、token 全表、系统布局说明、桌面灵动胶囊状态机——比 `.trae/` 里的旧笔记更可信。
- `design-preview/`：设计原型与各主题截图，用于对照视觉效果（不是生产代码）。
- `tests/`：解析、存储一致性、书库归属、排序、手势判定的可执行事实来源。
- `.github/workflows/build.yml`：CI 与各平台打包参数。
- `.trae/documents/`：Vue 3 迁移与进度记忆的历史笔记，可能滞后。
