# HOMURA MD3 UI 与组件指南

> 适用版本：HOMURA `2.3.3`  
> 适用范围：`src/` 内所有生产界面，包括书架、阅读器、设置面板、菜单、弹层与全局反馈。  
> 不适用：`design-preview/` 原型、README 配图与一次性演示页。

新增或重做组件前先读本文，再按需查阅专项文档：

- [AGENTS.md](../AGENTS.md)：项目硬约束、架构红线与不能破坏的行为。
- [tokens.md](./tokens.md)：主题色、表面阶、组件 CSS 类字典与主题接入点。
- [bottom-sheet-spec.md](./bottom-sheet-spec.md)：`MobileBottomSheet` 与阅读器抽屉的结构、拖拽、弹簧与验收清单。
- [desktop-island.md](./desktop-island.md)：桌面灵动胶囊（`DesktopIsland.vue`）的状态机与分裂/合并动效。
- [sync-protocol.md](./sync-protocol.md)：WebDAV 同步与只读在线阅读协议边界。

规范关键词约定：**必须**（不满足即不能合入）、**应该**（默认执行，例外需说明理由）、**可以**（按场景选择）、**禁止**（不得新增或扩散到新代码）。若本文与历史笔记冲突，以**当前 `src/` 实现 + 本文 + `AGENTS.md`** 为准；改动组件时同步修正过时条目。

---

## 1. 六十秒选型

新组件的第一原则不是「设计一个新样子」，而是「复用已经成立的 MD3 角色」。

| 需求 | 首选实现 | 不要做 |
| --- | --- | --- |
| 页面主行动 | `.md-filled-button` / 书架扩展 FAB | 自造渐变按钮、一屏多个实心主按钮 |
| 次要行动 | `.md-tonal-button` | 再定义一个近似色容器 |
| 低强调行动 | `.md-text-button` | 用链接伪装按钮 |
| 只有图标的工具按钮 | `MdIconButton.vue` + `MdIcon.vue` | 小于 44px 命中区、`div @click` |
| 二到四个互斥选项 | `MdSegmentedControl.vue` | 手写一排不同圆角的按钮 |
| 布尔开关 | `MdSwitch.vue` | 自绘 checkbox 或点整行文字冒充开关 |
| 进度 / 字号滑条 | `MdRange.vue` + `.md-range` | 原生蓝轨道、圆形小拇指、另写 range 皮肤 |
| 设置列表 / 目录条目 | `.md-drawer-list-item` | 临时拼 `div + @click` |
| 漫画页码 | `.md-toc-grid` + `.md-toc-page` | 五颜六色的页码按钮 |
| 通用手机 / 自适应面板 | `MobileBottomSheet.vue` + `.md-mobile-sheet-*` | 私写 dialog / 遮罩 / 进出动画 |
| 阅读器设置 / 目录 / 字体抽屉 | `.md-drawer` + `ReaderDrawerHeader.vue` | 新写一套抽屉外壳 |
| 遮罩 | `.md-scrim` / `.md-scrim-soft` | 新建半透明黑色 |
| 书架 / 书库内容卡 | `.md-card` + `.md-shelf-card` / `.md-collection-card` | 私有圆角、私有阴影 |
| 书架网格 | `.md-shelf-grid` + `.md-featured-cell` | 组件内另写 `grid-cols-*` |
| 筛选 chip | `.md-filter-chip` | 实心彩色胶囊 |
| 菜单 | `.md-menu` + `.md-menu-item` | 系统右键菜单或无边界浮层 |

共享样式入口为 `src/assets/homura.css`（按层叠顺序导入 `src/assets/styles/*.css`）。只在**至少两个组件复用**时新增共享类；单组件构图放 scoped CSS，颜色、圆角、阴影仍必须使用 token。

---

## 2. 设计基线与视觉 Token

### 2.1 设计目标与不可破坏的基线

HOMURA 是本地优先、内容优先的 ACGN 阅读器。界面服务于「找到作品」与「进入阅读」：

1. **沉浸但不神秘**：层级清楚，主要动作明确，随时知道当前位置与返回路径。
2. **内容优先**：封面、书名、正文与漫画画面拥有最高视觉权重，控件不抢戏。
3. **安静且可恢复**：可恢复错误写入 console，不打断阅读；**禁止**重新引入全局 toast、`alert`、`confirm` 或阻塞式弹窗。
4. **跨表面一致**：10 套主题 × 白昼 / 护眼 / 夜间（含纯黑）下都成立。
5. **桌面与触屏同源**：同一组件响应式适配，不维护两套互不一致的视觉语言。

不可破坏的基线：

- 颜色只能来自 `--md-*` token；**禁止**新增十六进制色、`rgb()`、纯黑或纯白。
- 派生色使用 `color-mix(in oklab, var(--md-x) NN%, transparent)`，不要依赖 Tailwind 对 CSS 变量的透明度修饰（如 `bg-[var(--md-surface)]/92`）。
- 投影使用 `--md-shadow-color-soft`，遮罩与描边环使用 `--md-shadow-color`；**禁止**把 `--md-on-surface` 或 `--md-on-surface-variant` 用作阴影或遮罩色（夜间会翻转成近白并泛光），交付前必须过 `npm run check:dark-glow`。
- **禁止**新增 `--brand-*`、`--bg-*`、`--fg-*`、`--border-line` 等遗留别名（`tokens.css` 末尾映射仅保留给尚未迁完的存量文件）。
- 一屏只保留一个 `primary` 实心主行动；书架页唯一主行动是「导入」FAB / 桌面灵动胶囊，面板底部的「完成」不与页面 FAB 同时出现。
- 布局主断点只有 **900px**（`<900` 紧凑布局 / `>=900` 桌面布局）。
- 图标统一走 `MdIcon.vue` 的 Material Symbols 内联 SVG；**禁止**引入图标库、组件库或远程字体。
- 交互元素必须是原生 `button` / `a` / 表单控件；**禁止** `<div @click>` 冒充按钮，**禁止**按钮内嵌套按钮。
- 重对象（`File`、Zip 内容、`Animation`、timer、DOM 引用）必须使用 `shallowRef` 或普通变量，禁止进 Vue 深度响应式代理。

### 2.2 表面、文字与 Error token

每个背景色必须与其对应的 `on-*` 前景色成对使用，不要只按白昼模式挑颜色：

| 角色 | 背景 token | 前景 token | 典型用途 |
| --- | --- | --- | --- |
| 页面画布 / 顶栏 | `surface` | `on-surface` | 书架画布、页眉 |
| 浮动侧栏 / 次级表面 | `surface-low` | `on-surface` | `SideNav`、设置页底 |
| 浮层 / 抽屉 / 菜单 | `surface-container` | `on-surface` | sheet、浮动面板、菜单 |
| 输入槽 / 次要控件底 | `surface-high` | `on-surface` | 搜索槽、分段控件槽、内联提示 |
| 内容卡 / 深一阶中性底 | `surface-highest` | `on-surface` | 书架卡、开关关闭态轨道、按压反馈 |
| 主行动 | `primary` | `on-primary` | 导入 FAB、完成按钮、开关开启轨道 |
| Tonal 行动 / 选中导航 | `secondary-container` | `on-secondary-container` | 次要按钮、当前目录项、侧栏/底栏选中指示器 |
| 特色容器 | `primary-container` | `on-primary-container` | 继续阅读特色卡、空态格式标签 |
| 辅助强调 | `tertiary-container` | `on-tertiary-container` | 少量装饰与渐变混色 |
| 次要说明 | 透明或对应容器 | `on-surface-variant` | 副标题、分组标签、元信息 |
| 边界 | 透明 | `outline-variant` / `outline` | 0.5px 分割线、控件描边 |

Error token 已在 `src/assets/styles/tokens.css` 的白昼 / 护眼 / 夜间三个表面统一定义（色值同步在 `tokens.md`）：

- 可恢复错误可使用 `role="alert"` 的内联提示，容器为 `surface-high` / `surface-container`，文字使用 `on-surface`。
- 需要语义错误容器时使用 `--md-error-container` / `--md-on-error-container`；错误文字使用 `--md-error`；高风险操作按钮使用 `.md-mobile-sheet-danger`（`--md-error` / `--md-on-error`），不得写死红色。
- 修改 error 色值必须三个表面一起改，并同步更新 `tokens.md`。

### 2.3 主题与表面控制

- **主题色**（`data-theme`）：`green / mint / cyan / blue / violet / orchid / sakura / red / amber / olive`（共 10 套）。
- **表面模式**（`data-mode`）：`light / warm / dark`；夜间支持纯黑开关（`data-black`）。
- 组件**必须**通过 `theme.setThemeColor()`、`theme.setSurfaceMode()`、`theme.setPureBlackMode()` 切换，不得自行修改根节点或伪造局部主题。
- 表面切换的圆形 reveal 动画（`SURFACE_REVEAL_DURATION = 720`）、原生窗口标题栏同步和 `html.surface-switching` 过渡抑制统一在 `src/stores/theme.ts` 维护，组件不得叠加冲突的全局 transition。
- 应用设置页使用 `ThemeSwatchGrid.vue` 展示主题色，阅读器设置使用 `SurfaceModePreview.vue` 展示阅读纸面。

### 2.4 字体与字号密度

| 角色 | 字体族 | 使用范围 |
| --- | --- | --- |
| 正文与 UI | `font-sans` | 标题、按钮、正文、表单、说明 |
| 书封与展示标题 | `font-display` | 书封、继续阅读标题、空态标题 |
| 元信息 | `font-mono` | 页数、章节、百分比、快捷键、英文 kicker |
| 竖排书封 | `'Songti SC', 'Instrument Serif', serif` | 仅竖排封面标题 |

数字类信息（页码、百分比、计数）应同时使用 `font-mono` 与 `font-variant-numeric: tabular-nums`，防止更新时抖动。**禁止**通过 `@font-face` 或 CDN 临时引入远程字体。

| 层级 | 字号 | 字重 | 用途 |
| --- | --- | --- | --- |
| 页面标题 | 桌面 22px / 手机 21px | 500–600 | 书架等主页面标题 |
| 新 bottom sheet 标题 | 22px；同行页签 20px | 600 | `ReaderDrawerHeader prominent` |
| 存量默认抽屉标题 | 17px | 600 | 非 prominent 的 `md-drawer-title` |
| 手机 sheet 输入 | 16px | 400–600 | `.md-mobile-sheet-field`，防止移动浏览器聚焦缩放 |
| 正文、输入、按钮 | 13px | 500–600 | 主要可读文字、侧栏展开标签 |
| 紧凑控件 | 12px | 600 | 菜单条目、开关行、桌面作品计数 |
| 分组标签 | 11px | 600 | `md-drawer-group-label`、折叠侧栏标签 |
| 元信息 / 徽章 | 10–10.5px；极小徽标 8–9.5px | 500–600 | 手机作品计数、分段控件、页脚元信息 |

除上述输入场景外，新组件**禁止**随手插入 `14 / 15 / 16px` 等中间档。

### 2.5 间距、尺寸与圆角

间距以 M3 的 **8px（`--md-space-100`）为主节奏**（定义于 `tokens.css` 的 `--md-space-25` ~ `--md-space-900`）：4px 用于紧凑排布，2px 只用于描边与视觉校正；既有 6 / 10 / 14 / 20 / 22 / 28px 光学修正可保留，不再新增中间档。

- 页面 gutter：手机 `16px`、平板 `20px`、桌面 `28px`、`>=1600px` 为 `36px`。
- 书架网格 gap：手机 `12px`、平板与桌面 `16px`、`>=1600px` 为 `24px`。
- 组内纵向间距 `8–16px`，组间 `20–24px`（抽屉分组间距 `20px`，首个分组顶部 `8px`）。

| 元素 | 规范尺寸 / 圆角 |
| --- | --- |
| 最小触控命中区 | `44px × 44px`（小图标用 `.md-hit-target` 补足） |
| 常规图标按钮 | `48px` 圆形容器（图标 `24px`，阅读器顶栏收为 `40px` / 组内 `36px`） |
| 常规行动按钮 | 最小 `48px` 高，`999px` 胶囊圆角 |
| 菜单条目 / 设置条目 | 最小 `44px`（手机）/ `48px`（常规），目录项 `52px`；菜单项圆角 `10–12px` |
| 书架 / 书库卡封面 | `clamp(12px, 2.9vw, 16px)`（`.md-card` 基础圆角 `12px`） |
| 手机 sheet 输入框 | `52px` 高，`16px` 圆角 |
| 分段控件 | `20px` 外框、`17px` 滑块 |
| 通用 sheet 分组卡片 | `26px` 圆角（`.md-mobile-sheet-card`） |
| 浮层、侧栏、sheet | `28px` 圆角（手机 bottom sheet 顶部 `28px`） |
| 手机悬浮底栏 | `64px` 高、`32px` 圆角、左右 `24px` |

### 2.6 层级（z-index 阶梯）

新增浮层必须沿用现有层级，**禁止**随手写 `z-[999]`：

| z-index | 用途 | 代表位置 |
| --- | --- | --- |
| 20 | Sticky 顶栏、页内菜单点击背板 | `LibraryHeader.vue`、`SettingsView.vue` |
| 30 | 桌面浮动侧栏、阅读器顶栏、阅读手势层、页内菜单 | `SideNav.vue`、`overlays.css`、`PaginatedView.vue`（必须高于舞台 `20`） |
| 31 | 阅读器返回边缘触发区 | `.reader-back-edge` |
| 35 | 阅读器底部常驻页脚 / 状态条 | `ReaderFooter.vue`（`.md-reader-footer`） |
| 40 | 手机底部导航、遮罩、FAB、桌面灵动胶囊 | `#homura-mobile-nav-root`、`.md-scrim`、`.md-fab-pos` |
| 45 | 阅读器预测式返回遮罩、设置容器变换 | `.reader-back-scrim`、`.settings-transition-layer` |
| 50 | 阅读器本体、`.md-drawer` side/bottom sheet | `.md-drawer`、`ReaderModal.vue` |
| 60 / 65 | 全窗拖拽导入遮罩 / 长按拖拽 ghost | `DragOverlay.vue`、`.md-touch-drag-ghost` |
| 9999 / 10000 | 表面切换 reveal / 启动 Splash（专用） | `.surface-reveal`、`#homura-splash` |

> `MobileBottomSheet.vue` 使用原生 `<dialog>.showModal()` 的浏览器 top layer 与 `::backdrop`，不受普通 z-index 排序控制；不要给它补 `z-40` / `z-50`，也不要依赖 `z-60` 遮住原生模态框。

---

## 3. 通用组件写法

### 3.1 行动按钮与 FAB

共享按钮只有三档，尺寸、圆角、状态与触控高度已统一：

```html
<button type="button" class="md-filled-button">完成</button>
<button type="button" class="md-tonal-button">选择封面图片</button>
<button type="button" class="md-text-button">恢复默认</button>
```

- 一个面板只保留一个 `.md-filled-button`；次要操作用 `.md-tonal-button`、`.md-text-button` 或 `.md-icon-button`，禁止“按钮彩虹”。
- 同组按钮 `gap` 用 `8–12px`，按钮文字必须使用动词；图标作辅助并带 `aria-hidden="true"`。
- 加载时保持原宽度，不让底部操作区跳动。
- 书架唯一主行动是「导入」扩展 FAB（`.md-fab-pos`）：高 `56px`、横向内边距 `20px`、圆角 `16px`、`primary` + `on-primary`、`active:scale-95`。

### 3.2 图标按钮

```html
<MdIconButton
  class="md-icon-button"
  title="关闭目录"
  aria-label="关闭目录"
  @click="close"
>
  <MdIcon name="close" />
</MdIconButton>
```

- 基础态透明底；`is-outlined` 加 1px `outline-variant`；`is-filled` 用于当前方向、主行动或明确选中态；`is-favorite` 用于收藏。
- 图标统一走 `MdIcon.vue`（Material Symbols 24dp 网格）；选中态改用 `:filled="true"`，不自制实心/描边两套几何。
- 按钮内默认 `24px`，菜单 `20px`，筛选 chip `18px`，行内状态 `16px`。`MdIconButton` 内置 `44px` 最小命中区，相邻小按钮的中心至少间隔 `44px`。
- 底板用 `--icon-button-background`，描边与投影用 `--icon-button-shadow`。组件统一缩放底板和图标，键盘焦点描边留在原生按钮上。
- 需要在原生点击事件中唤起软键盘或进入浏览器全屏时，传 `preserve-user-activation`。
- 只用图标时 `title` 与 `aria-label` 至少有一个，同时存在时文案一致；`MdIcon` 已设 `aria-hidden="true"`，不要给图标本身补可访问名称。
- 触发模态抽屉/对话框的按钮设置 `aria-haspopup="dialog"` 与 `aria-expanded`；有真实容器 ID 时再加 `aria-controls`（不能指向标题 ID）。

### 3.3 菜单、下拉与确认操作

菜单结构为「触发按钮 + 点击背板（`fixed inset-0`）+ `.md-menu` + `.md-menu-item`」：

- 容器：`surface-container`、圆角 `16px`、阴影使用 `--md-shadow-color-soft`、宽度受限（操作菜单 `176–224px`），不按最长文案无限撑开。
- 条目：最小高度 `44px`（手机）/`48px`、圆角 `10–12px`；选中态使用 `primary-container` + `on-primary-container` + 勾选图标。
- 触发按钮带 `aria-haspopup="menu"` + `aria-expanded`；菜单项使用 `role="menuitem"` 或 `role="menuitemradio"` + `aria-checked`。
- 必须支持点击外部 / `Esc` 关闭并在关闭后恢复触发按钮焦点。

高风险且不可撤销的操作**必须**使用明确的内联确认或专用确认面板（如 `ShelfDialogSheet.vue` / `ShelfDialogContent.vue`），禁止使用浏览器 `confirm` / `alert`。确认文案必须说明：**1. 将发生什么；2. 是否可撤销；3. 安全出口是哪一个**，禁止只用含糊的「确定 / 取消」。

### 3.4 搜索框与筛选 Chips

- **搜索框**：手机高 `52px`（圆角 `26px`）、桌面高 `40px`（圆角 `20px`），背景 `surface-high`，输入 `13px`，图标 `20px`（`on-surface-variant`），清除按钮 `36px` 视觉 / `44px` 命中区（仅在有值时显示）。使用 `type="search"`、`inputmode="search"`、`enterkeyhint="search"`，由外层容器承担焦点底色。
- **筛选 Chips**（`.md-filter-chip`）：视觉高度 `32px`、命中区 `48px`（手机 `44px`），未选中透明/surface 底 + `0.5px outline-variant`，选中态 `secondary-container` + `on-secondary-container`，同步 `aria-pressed`；横向列表必须使用 `.no-scrollbar` 并保留键盘可达性。

### 3.5 分段控件

```html
<MdSegmentedControl
  class="w-full"
  :model-value="config.direction"
  :options="directionOptions"
  aria-label="阅读方向"
  @update:model-value="setDirection"
/>
```

- 槽体使用 `surface-high`、`20px` 圆角与 `3px` 内边距。选项等宽排列，滑块始终保持一列宽，和反色字形共用轨道内的逐帧裁切。默认使用 `primary` / `on-primary`，可用组件色彩变量替换配对。
- 建议 `2–4` 个短而平行的互斥选项；更多选项改用菜单或列表。必须传 `aria-label`。
- `update:modelValue` 第二个参数会 emit 点击元素中心坐标 `origin`，供表面切换 reveal 使用，不要丢掉。
- 可从滑块上横向拖动，松手时按当前覆盖位置选中并继承拖拽速度。手机 `<=480px` 且选项达 3 个时默认隐藏图标，保留标签空间。`prefers-reduced-motion` 下滑块直接落位。

### 3.6 开关

```html
<MdSwitch
  :model-value="config.coverOffset"
  title="双页模式下首页单独显示，确保后续跨页大图对齐"
  @update:model-value="toggleCoverOffset"
>
  <span class="text-[13px] font-medium">首页单排</span>
</MdSwitch>
```

- 行高至少 `48px`，说明文字放默认 slot（作为点击目标的一部分），右侧为 `52px × 32px` 轨道。
- 原生 `<button type="button" role="switch" :aria-checked="modelValue">`，禁止套 checkbox。
- 关闭态：`surface-highest` 轨道 + 极淡内槽边缘 + `24px outline` 实心滑块（四周 `4px` 同心留白）；开启态：`primary` 轨道 + `24px on-primary` 滑块；桌面悬停与按压提供状态光环与轻度滑块缩放反馈。
- 切换由物理弹簧驱动位移与形变，连点只更新弹簧目标、保留当前位置和速度；`prefers-reduced-motion` 下直接落位。

### 3.7 进度与字号滑条

统一复用 `MdRange.vue` + `.md-range`：

- 触控高度 `48px`；`16px` 胶囊轨道内嵌 `3.2px` 点阵（活动段 `primary` + `on-primary` 点阵；未活动段 `secondary-container` + `primary` 点阵）；`4 × 36px` 竖条手柄配合 `4px` 表面色光环切开轨道。
- 必须提供 `aria-label`；阅读进度需提供包含当前页与百分比的 `aria-valuetext`；RTL 翻页传 `:rtl="inverted"`，不要反转整个底栏。
- 阅读设置字号滑条使用 `variant="bubble"`：`28px` 轨道、`40px` 数值圆钮、每档一个 `4px` 点阵，两端 `A−` / `A+` 为 `48px` 按钮，只提供 `14–28px` 偶数档。

### 3.8 设置分组、卡片与选择菜单

抽屉内传统分隔分组使用 `.md-drawer-section`（由其 `outline-variant` 边框分隔，不要自画 `<hr>`）：

```html
<section class="md-drawer-section">
  <div class="md-drawer-group-head">
    <span class="md-drawer-group-label">阅读方向</span>
    <b class="md-drawer-group-value">{{ directionLabel }}</b>
  </div>
  <MdSegmentedControl ... />
</section>
```

新 bottom sheet / 卡片化设置统一使用 `.md-mobile-sheet-card`（`26px` 圆角、`--md-surface` 底、间距 `18px`）；`.md-drawer-section` 仅作存量分隔线分组，不能当作 `26px` 圆角卡片的等价替代。

设置页（`SettingsView.vue`）专项约束：

- 页面使用 `surface-low`，设置卡片（`.settings-card`）使用 `surface` / `on-surface`，圆角 `34px`（窄屏 `28px`），投影用 `--md-shadow-color-soft`，不抬升卡片；书页示意（`.settings-book-stage`）衬底用 `primary-container` 且标记 `aria-hidden="true"`，仅作装饰。
- 卡片进入二级页统一走 `useSettingsTransition()`：按压缩至 `0.985`，抬手后在根浮层用 `380ms` 展开。卡片和详情分段淡出、淡入，浮层同步插值圆角、表面色和遮罩。桌面容器在前 `60%` 完成底色过渡，详情从 `55%` 开始淡入并等比适配容器宽度；真实详情的不透明顶栏先就绪，再移除浮层。桌面按钮返回用 `255ms` 缓起曲线，剩余位移进入 `2px` 内即可落位。
- 手机底栏保留挂载并随进度显隐；Android 14+ 返回手势直接驱动进度，松手速度沿用到最长 `265ms` 的收尾弹簧，取消时恢复详情滚动位置和焦点。转场期间 Android 暂停顶栏模糊和副本内动画，屏外分组保留定高占位。
- 外观二级页使用 `ThemeSwatchGrid` 的 `strip` 模式（承载容器声明 `container: theme-palette / inline-size`：可用宽度 `>=640px` 十列一行，不足时五列两行，不横向滚动）。
- 列表选择项复用 `SettingsSelectRow`：菜单 Teleport 到根节点并按视口避让，支持方向键、`Home`/`End`、`Escape`、`Tab` 与外部点击关闭，选择后恢复焦点并保留原始值类型（如单双页数字类型）。菜单展开前锁定背景滚动（桌面保留原滚动条并固定背景滚动位置），覆盖停驻与收缩全过程。动效由 `settingsSelectMotion.ts` 的 `0.7×` 物理弹簧驱动（展开 `ζ=0.58 / k=400` 回弹对齐，收起 `ζ=0.85 / k=500` 先下探拉成圆囊再向上合回）；`prefers-reduced-motion` 下直接落位。

### 3.9 抽屉与 Sheet 入口

**所有新增或重做 bottom sheet 必须完整遵守 [bottom-sheet-spec.md](./bottom-sheet-spec.md)**，禁止自造 fixed 外壳或 `.md-sheet-enter-active` 固定时长动画：

| 场景 | 必须使用 | 典型组件 |
| --- | --- | --- |
| 页面级 / 全局流程 / 自适应面板 | `MobileBottomSheet.vue`（桌面可用 `desktop-side`） | `ImportProgressSheet.vue`、`ShelfDialogSheet.vue`、`DuplicateImportSheet.vue`、`UpdateDialog.vue` |
| 阅读器内部、与阅读状态互斥的抽屉 | `.md-drawer` + `ReaderDrawerHeader.vue` | `ReaderSettingsDrawer.vue`、`ReaderFontDrawer.vue`、`ReaderTocDrawer.vue` |

通用手机流程直接使用 `MobileBottomSheet.vue`（保持外壳挂载，用 `open=false` 触发退场、禁止 `v-if="open"` 直接卸载；业务 payload 与列表清理延后到 `closed` 事件；`busy` 时如需点击遮罩收起并后台继续，传 `scrim-closeable`）：

```vue
<MobileBottomSheet
  :open="open"
  title="示例面板"
  title-id="example-sheet-title"
  close-label="关闭示例面板"
  @close="close"
  @cancel="close"
>
  <p class="md-mobile-sheet-label">分组</p>
  <div class="md-mobile-sheet-card">
    <div class="md-mobile-sheet-row">
      <span class="md-mobile-sheet-icon is-accent"><MdIcon name="info" /></span>
      <span class="md-mobile-sheet-copy"><b>标题</b><small>说明文字</small></span>
    </div>
  </div>
  <template #footer>
    <button type="button" class="md-filled-button" @click="close">完成</button>
  </template>
</MobileBottomSheet>
```

阅读器抽屉使用 `.md-scrim`（`z-40`）+ `<aside class="md-drawer">`（`z-50`）+ `ReaderDrawerHeader`（新抽屉传 `prominent`，含同行页签时加 `inline-tabs` 并在 `#status` 放 `ReaderDrawerTabs.vue`），进出场统一 `useSheetSpring()`，拖拽统一 `useSheetDrag()`（整卡可起手，向上吸附展开到 `100dvh - safe-area-top - 8px`，向下先回默认 `78dvh` 再下拉关闭）；打开时禁止背景滚动、暂停工具栏自动隐藏，关闭后恢复焦点与滚动位置。阅读目录、字体选择、更新日志保留当前设计。

### 3.10 列表项与页格

- 章节、排序、筛选项连续条目使用 `.md-drawer-list-item`（`role` / 原生 `button`）：选中项用 `secondary-container` / `on-secondary-container` 并同步 `aria-current`，不靠左侧粗色条标示。
- 漫画页码使用 `.md-toc-grid`（5 列）+ `.md-toc-page`，当前页同样使用 `secondary-container` 对。

---

## 4. 页面与业务模块规范

### 4.1 书架内容卡与网格

- **书架网格**（`.md-shelf-grid`）：`<768px` 3 列（gap 12px / pad 16px）；`768–899px` 5 列（gap 16px / pad 20px）；`>=900px` 4 列（gap 16px / pad 28px）；`>=1080px` 5 列；`>=1280px` 6 列；`>=1600px` 8 列（gap 24px / pad 36px）。禁止局部覆盖 `grid-cols-*`。
- **单本内容卡**（`BookCard.vue` / `.md-shelf-card`）：语义化 `<article>` 内放覆盖整卡的 `<button class="md-shelf-open">`；沿用 `.md-card--filled`（`surface-highest`，默认无边框无阴影，hover 仅 fine pointer 叠加 8% 状态层、不抬升不推动网格）；`348/512` 封面比例；右上角 `.book-badges`（格式与云端徽标，多选态切换为 `.md-select-badge`）；底部 `4px` `.book-progress-track`（填充 `--md-primary`）；标题 `line-clamp-2`。
- **继续阅读特色卡**（`ContinueReading.vue` / `.continue-card.md-featured-cell`）：占网格首格跨 3 列，仅在书架首页与收藏页显示（进入具体书库后隐藏）；整卡为单一 `<button>`；`primary-container` + `on-primary-container`；包含小封面、元数据、波浪进度条与右侧异形「继续阅读 / 开始阅读」行动区。
- **书库卡**（`CollectionCard.vue` / `.md-collection-card`）：与书本卡同构等高，使用 `.md-collection-stack` 展示领衔封面，右上角 `.md-collection-badges` 显示「N 册」与「系列」；支持书本拖入移库，高亮时显示 `.md-collection-drop`（「松开移入书库」）。
- **空态**（`EmptyShelf.vue`）：`surface-container` + `0.5px dashed outline-variant`（`16px` 圆角）；格式标签使用 `primary-container` + `on-primary-container`；手机只提示右下角 FAB 路径，桌面提供文件/文件夹按钮，不与 FAB 抢占视觉主位；筛选无结果时的空态文案必须与「书架为空」明确区分。

### 4.2 导航与页面头部

- **桌面浮动侧栏**（`SideNav.vue`，`>=900px`）：`sticky top: 16px`、高 `100dvh - 32px`、`28px` 圆角、`surface-low` 底色；展开 `220px` / 折叠 `104px`（偏好存 `localStorage.homura_sidenav_collapsed`，`280ms` 过渡，文案用宽/窄两份交叉淡化不插值 `font-size`）。固定 4 项主导航「书架 / 最近 / 收藏 / 设置」，选中指示器 `.sidenav-indicator` 使用 `secondary-container` + `on-secondary-container`（`300ms` 纵向滑动，带 `:aria-current="active === item.key ? 'page' : undefined"`）；每个导航项与收起按钮必须有 `title` 与 `aria-label`。
- **手机悬浮胶囊底栏**（`SideNav.vue` 的 `.mobile-nav`，`<900px`）：Teleport 到 `#homura-mobile-nav-root`（`z-40`），左右 `24px`、高 `64px`、圆角 `32px`、最大宽 `560px`、贴 `bottom: env(safe-area-inset-bottom)`；果冻选中指示器 `.mobile-nav-indicator`（`82px × 56px`，圆角 `28px`，`secondary-container`）由物理弹簧驱动点击与横向拖拽切换；主内容区必须挂 `.md-bottom-nav-space`。
- **书架 / 最近 / 收藏顶栏**（`LibraryHeader.vue`）：滚动时常驻 `z-20`，手机 `88px`（另计顶部安全区）/ 桌面 `104px`。内容从渐隐磨砂层 `.md-topbar-fade` 下方滚过。标题与设置页共用 `.md-topbar-title`，容器宽度不超过 `599px` 时为 `22px`，其余为 `26px`。书库内可点击标题重命名。右侧工具胶囊包含多选、筛选排序和搜索，手机另有导入，桌面可选全屏按钮。多选与搜索共用展开动效，多选时胶囊内显示已选数量和批量操作。
- **设置页布局**（`SettingsView.vue`）：首页顶栏与书架共用渐隐磨砂层 `.md-topbar-fade`。卡片按设置内容区容器宽度排版：`>=1040px` 三列、`600–1039px` 两列、`<600px` 单列；该容器断点仅用于设置卡片排版，不替代全局 `900px` 主断点。

### 4.3 阅读器组件

- **顶栏**（`ReaderTopBar.vue`）：通栏书眉（`min-height: 64px`、`z-30`、透明底、`--md-reader-ink` 文字），左侧胶囊组（返回、目录，`36px` 按钮），中间书名，右侧字体 `Aa`（仅可重排格式显示）、设置、收藏与桌面全屏按钮（`40px`）。
- **页脚**（`ReaderFooter.vue`）：常驻纸面底部（`z-35`），不随顶栏自动隐藏；左侧显示「回到上次位置」（目录跳读后出现），中间显示单页/双页页码，右侧显示「本章还剩 N 页」，底部为通栏可拖拽进度条（拖动只预览气泡，松手或键盘 change 提交翻页；触屏拖动期间钉住顶栏）。`NovelCard.vue` 的 `.reader-page-folio` 保留占位高度但隐藏文字，避免与页脚重复和正文重排。
- **工具栏自动隐藏**：`AUTO_HIDE_DELAY = 2200ms`（在 `stores/ui.ts` 维护，组件内不另设时长）；抽屉打开期间不自动隐藏，关闭后重新显示并开始计时。
- **目录抽屉**（`ReaderTocDrawer.vue`）：漫画使用 5 列页码格（`44px` 高）；小说使用章节列表（最小 `44px` 高，可显示两行标题）；当前项用 `secondary-container` 对；空目录显示「暂无章节信息」；跳转后关闭目录并恢复工具栏。
- **阅读设置与字体抽屉**（`ReaderSettingsDrawer.vue` / `ReaderFontDrawer.vue`）：阅读设置页签固定为「外观 / 排版 / 封面」（`ReaderDrawerHeader prominent inline-tabs` + `MdSegmentedControl tab-id-prefix`），包含排版预览、字号 `MdRange variant="bubble"` + `48px` `A−`/`A+` 按钮、`SettingsSelectRow`（字体/行距/页边距）、`MdSegmentedControl`、`MdSwitch`、阅读纸面 `SurfaceModePreview cards` 与恢复默认卡片；窄屏强制单页时必须给出解释文案。`ReaderFontDrawer` 复用 `ReaderDrawerHeader prominent`、遮罩与 `useSheetDrag()`，固定搜索区，按字体本身展示 `READER_FONT_OPTIONS`，打开时与其他阅读抽屉互斥。
- **阅读画布与手势**（`PaginatedView.vue` / `WebtoonView.vue`）：手势层（`.reader-gesture-layer`，`z-30`，`touch-action: none; overscroll-behavior: contain`）必须高于翻页舞台图片层（`z-20`）；横向滑动跟手、阻尼与回弹；轻点左/右 `30%` 翻页、中间切换工具栏；`<768px`（`DOUBLE_SPREAD_MIN_WIDTH`）强制单页；双缓冲动画对象、DOM 引用与 `Animation` 保持非深度响应式，禁止改写成响应式 `v-for` 动画布局。

### 4.4 全局反馈与系统界面

- **拖拽导入**（`DragOverlay.vue`）：仅支持拖拽的平台挂载监听；全窗遮罩 `z-[60]`，明确提示支持格式与「松手即可加入书架」；离开、取消和 drop 后必须清理状态不留遮罩。
- **启动 Splash**（`#homura-splash`）：首帧前由 `public/homura-boot.js` 同步读取主题并写入 `data-theme` / `data-mode` / `dark`，避免黑屏或主题闪白；底色与画布一致（白昼 `#F8FAFC` / 护眼 `#FAF6EE` / 夜间 `#0F1115` / 纯黑 `#000000`）；仅用于等待首次书架恢复（`SPLASH_MIN_DURATION = 720`），淡出约 `200ms`，`prefers-reduced-motion` 下直接结束。
- **错误与恢复**：可恢复错误写入 `console.warn` / `console.error`，保持界面可操作；阻断性错误留在对应区域说明原因与下一步动作，不写“出错了”这类空话。

---

## 5. 响应式断点与状态模型

### 5.1 断点

| 范围 | 名称 | 布局 |
| --- | --- | --- |
| `<= 767px` | Phone | 紧凑布局：手机悬浮底栏、3 列书架、bottom sheet、安全区 |
| `768–899px` | Compact Tablet | 仍属紧凑布局（bottom sheet / 悬浮底栏）；书架 5 列；阅读器允许双页 |
| `>= 900px` | Desktop | 桌面布局：浮动侧栏 + 主列 + side sheet |
| `>= 1080 / 1280 / 1600px` | Wide Desktop | 书架增至 5 / 6 / 8 列；`>=1080px` 搜索胶囊嵌入顶栏 |

- `useViewport().isCompact`（`COMPACT_MAX = 899`）、Tailwind `min-[900px]:` 与 CSS `@media (min-width: 900px)` 必须表达同一条主断点；`isPhone`、`isTablet`、`isDesktop` 只用于密度与能力细节，不得另起布局壳。
- macOS Tauri 书架开启 `.has-contained-shelf-scroll` 内部滚动，滚轮与回到顶部需与 `main.library-scroll` 同步。

### 5.2 组件状态模型

所有可交互组件应明确覆盖以下 7 种状态：

| 状态 | 视觉要求 | 行为要求 |
| --- | --- | --- |
| Default | 使用正确 token 与层级 | 键盘可聚焦、可点击 |
| Hover | 状态层或 1–2px 反馈 | 仅在 `@media (hover: hover) and (pointer: fine)` 生效 |
| Pressed | 8–12% 状态层或 `scale(0.95~0.98)` | 按下后不丢失焦点 |
| Focus-visible | `2px primary` 外框，`2px` offset | 键盘可见，鼠标点击不强制显示 |
| Selected | `primary-container` / `secondary-container` + 对应 `on-*` 或勾选 | 同步 `aria-pressed` / `aria-checked` / `aria-current` |
| Disabled | 保持可读轮廓，降低强调（如 `0.38`） | 使用原生 `disabled`，禁止触发动作 |
| Loading | 保持原尺寸，不跳动 | 阻止重复提交 |

触屏不得依赖 hover 才能发现操作；选中态不能只靠颜色差异，必须有容器、勾选或 `aria-*` 辅助。

---

## 6. 可访问性与文案规范

### 6.1 可访问性

- 交互元素只用原生 `button`、`a`、`input`、`select`；禁止随意 `outline: none` 破坏 `:focus-visible`。
- 图标按钮必须有 `title` 或 `aria-label`（同时存在时一致）；装饰性 SVG 加 `aria-hidden="true"`。
- 开关用 `role="switch"` + `aria-checked`；互斥按钮用 `aria-pressed`；单选菜单项用 `aria-checked`；当前页/章节/导航用 `aria-current`；触发器用 `aria-haspopup` + `aria-expanded`（有真实容器 ID 再加 `aria-controls`）。
- 输入控件必须有 `label` 或 `aria-label`（`placeholder` 不算 label）。
- 视觉图标可以小，但交互命中区不得小于 `44px`。
- 动态页码、百分比与状态必须有可读文本（如 `aria-valuetext`），不能只靠颜色。
- 触屏手势（翻页、返回等）必须提供按钮或键盘替代；正文内容区可选中，控件区保持 `select-none`。

### 6.2 文案与 i18n

- 界面文案统一通过 `useI18n()` 的 `t()` 输出（以简体中文原文作 key，英文 / 日文在 `src/locales/` 覆盖，插值用 `{0}`），**禁止**在组件内手拼语言分支。
- 动作按钮使用动词（「导入文件」「恢复默认」「关闭目录」）；高风险动作明确对象与范围（「清空书架」而非「清理」）。
- 省略号使用中文排版 `…`，不写三个英文句点；数字与单位之间保留空格（如 `12 页`、`18 px`）；状态文案说明结果（「窄屏会自动按单页显示」）。
- 一张卡片信息尽量控制在「标题 + 1–2 项关键元信息」，不使用装饰性英文填充空白。

---

## 7. 动效与性能

| 场景 | 时长 / 曲线或弹簧参数 |
| --- | --- |
| 常规颜色、透明度、非 sheet 浮层进出 | `200ms` / `--md-ease-emphasized`（`cubic-bezier(0.2, 0, 0, 1)`） |
| 卡片 hover | `200–280ms`，只改状态层透明度或柔和投影 |
| 侧栏展开/折叠 | `280ms` / `--md-ease-emphasized` |
| 分段控件滑块 | 质量 `1`，横向位移刚度 `460` / 阻尼 `34` |
| 开关滑块 | 位移与形变弹簧（`--md-ease-spring`），收敛后结束 |
| Sheet 进出场 | `useSheetSpring()`：入场刚度 `380` / 阻尼比 `0.86`，退场 `760` / `1` |
| Sheet 松手吸附 | `useSheetDrag()`：`200ms` / `cubic-bezier(0.2, 0, 0, 1)` |
| 表面切换 reveal | `720ms`（系统级，只在 `src/stores/theme.ts` 维护） |

规则：

- 只过渡颜色、透明度、transform、shadow；布局过渡仅沿用已有侧栏、桌面灵动胶囊、共享 sheet 吸附高度与页签滑块宽度，不在业务组件新增。
- 新增动效必须提供 `prefers-reduced-motion: reduce` 分支，关闭非必要位移与动画并保留最终状态。
- 高频手势、双缓冲动画、timer、DOM 引用使用 `shallowRef` 或直接写 DOM style / Web Animations API，不触发每帧 Vue 响应式重渲染。

---

## 8. Vue 与工程分层约定

- 使用 Vue 3 `<script setup lang="ts">` + **TypeScript**，保持 2 空格缩进、单引号、语句结尾分号；指向已迁移 `.ts` 文件的 import **必须写 `.ts` 后缀**（兼容 Node `--experimental-strip-types` 单测）。
- 目录分层：`src/components/`（视图与交互）、`src/composables/`（复用手势与组合逻辑）、`src/stores/`（Pinia setup store，不直接操作复杂 DOM）、`src/services/`（解析、存储、平台能力，不依赖 Vue/Pinia）。
- 双向控件统一 `modelValue` + `update:modelValue`；事件名 kebab-case；Props 写明类型与默认值（对象/数组用工厂函数）；视觉状态优先由 props / store 派生。
- 布局与 token 颜色优先使用 Tailwind 任意值类（如 `bg-[var(--md-surface-container)]`）；伪元素、复杂状态、轨道路径用 scoped CSS；跨组件复用才提炼到 `src/assets/styles/*.css` 并更新 `tokens.md`。
- 不引入第三方图标库、组件库或重复轮子。

---

## 9. 交付与验收清单

### 9.1 组件级 Definition of Done

提交前至少确认：

- [ ] 复用了现有共享组件和 CSS 类，没有重复造按钮、开关、分段控件、滑条或 sheet。
- [ ] 颜色全部来自 `--md-*` 且容器与 `on-*` 成对，没有新增 hex、`rgb()`、纯黑纯白或 `--brand-*` / `--bg-*` / `--fg-*`。
- [ ] 投影使用 `--md-shadow-color-soft`、遮罩使用 `--md-shadow-color`，`npm run check:dark-glow` 通过。
- [ ] 主行动只有一个；其余操作使用 tonal / text / icon。
- [ ] 图标按钮有 `title` 或 `aria-label`，命中区 `>=44px`；开关、选中项、菜单、抽屉具备正确 ARIA；无 `<div @click>` 伪按钮。
- [ ] `390px`、`768px`、`899px`、`900px`、`1440px` 无横向溢出；手机底栏、FAB、sheet 与安全区互不遮挡。
- [ ] Hover 只在 fine pointer 生效，触屏操作常显或可发现；10 套主题 × 白昼 / 护眼 / 夜间文字与选中态可读。
- [ ] `prefers-reduced-motion: reduce` 下动画正常收敛、无失效状态；重对象未进响应式深度代理。
- [ ] 文案已通过 `useI18n()` 的 `t()` 接入 `src/locales/`。
- [ ] `npm run typecheck` 与 `npm run build:vite` 通过，控制台无报错或 404；没有提交 `dist/`、`public/pdfjs/` 或构建产物。
- [ ] 若新增共享类 / token，已同步更新本文与 `references/tokens.md`；若是 bottom sheet，另过 [bottom-sheet-spec.md#8-验收清单](./bottom-sheet-spec.md#8-验收清单)。

### 9.2 按改动范围追加验证

| 改动范围 | 必须追加验证 |
| --- | --- |
| 书架 / 卡片 | 空书架、筛选无结果、长标题、多选与拖入书库、390/1440 网格 |
| 菜单 / sheet | 点击外部、`Esc`、关闭后焦点返回、手机拖拽双档位、背景滚动恢复 |
| 主题 / 外观 | 10 套主题切换、白昼/护眼/夜间/纯黑、720ms reveal、原生标题栏同步 |
| 阅读器 | LTR/RTL/竖排、单页/双页、翻页动画、进度恢复、工具栏自动隐藏 |
| 导入 / 错误态 | 拖拽、文件选择、取消/重试、失败后界面可操作、console 记录可定位 |
| Tauri / 窗口 | 启动不黑屏、全屏进出、标题栏随表面切换、macOS 内部滚动 |

---

## 10. 当前参考实现

| 需要抄的结构 | 参考文件 |
| --- | --- |
| 通用手机 / 自适应 sheet 与卡片 | `src/components/MobileBottomSheet.vue` + `src/assets/styles/mobile-sheets.css` |
| 书架卡片 / 书库卡 / 继续阅读 | `src/components/BookCard.vue`、`CollectionCard.vue`、`ContinueReading.vue` |
| 浮动侧栏与手机胶囊底栏 | `src/components/SideNav.vue` |
| 书架顶栏与展开搜索胶囊 | `src/components/LibraryHeader.vue` |
| 阅读器顶栏与常驻页脚 | `src/components/ReaderTopBar.vue`、`src/components/ReaderFooter.vue`、`src/components/NovelCard.vue` |
| 抽屉外壳、拖拽、页签、标题 | `src/components/ReaderSettingsDrawer.vue`、`ReaderDrawerHeader.vue`、`ReaderDrawerTabs.vue` |
| 目录 / 字体抽屉 | `src/components/ReaderTocDrawer.vue`、`src/components/ReaderFontDrawer.vue` |
| 分段选择 / 开关 / 滑条 | `src/components/MdSegmentedControl.vue`、`MdSwitch.vue`、`MdRange.vue` |
| 外观设置 / 色板 / 阅读纸面预览 | `src/components/SettingsView.vue`、`ThemeSwatchGrid.vue`、`SurfaceModePreview.vue` |
| 设置页卡片 / 转场 / 选择菜单 | `src/components/SettingsView.vue`、`SettingsSelectRow.vue`、`src/composables/useSettingsTransition.ts` |
| 共享样式与 token 入口 | `src/assets/homura.css` + `src/assets/styles/*.css` |

一句话原则：**新组件应该像这套界面里本来就长出来的一样；如果它需要三套新颜色、两套新圆角和一个新的全局层级，先回到现有 MD3 组件里找答案。**
