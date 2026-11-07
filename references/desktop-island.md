# HOMURA 桌面灵动胶囊设计细节

> 适用版本：HOMURA `2.2.1`
>
> 适用范围：桌面端（`>= 900px`）右下角的导入 / 更新 / 书库确认胶囊。
>
> 不适用：手机端（`< 900px`）的 `ImportStatusBar`、`ShelfDialog` 与 `UpdateDialog`。

本文记录灵动胶囊的**当前实现**，用于以后改布局、补状态或调整动效时快速定位。
如果与代码冲突，以当前 `src/` 为准，并同步修正本文。

相关文件：

- [DesktopIsland.vue](../src/components/DesktopIsland.vue)：唯一锚点、surface 路由、分裂 / 合并、焦点管理。
- [ImportProgressPanel.vue](../src/components/ImportProgressPanel.vue)：导入进度内容，桌面用 embedded 模式嵌入 island。
- [ShelfDialogContent.vue](../src/components/ShelfDialogContent.vue)：删除 / 建库 / 命名 / 移动书库的内容层。
- [UpdateIslandPanel.vue](../src/components/UpdateIslandPanel.vue)：检查更新、下载、完成、失败等更新状态。
- [useShelfDialogs.js](../src/composables/useShelfDialogs.js)：书库确认的 Promise 队列。
- [importProgress.js](../src/stores/importProgress.js)：导入任务、取消、失败重试、自动收起。
- [updates.js](../src/stores/updates.js)：更新版本、下载、安装与更新面板开关。
- [App.vue](../src/App.vue)：桌面 / 手机分流、body overflow 锁定与 island 挂载。

## 1. 设计目标

桌面端只保留一个右下角锚点，所有导入、书库确认和更新状态都从同一颗胶囊形变而来：

1. **一个 anchor**：`md-fab-pos` 固定在右下角，不新增第二套 FAB 或居中 modal。
2. **一个 surface**：同一时刻只有一个主面板，避免菜单、确认框、更新面板互相叠放。
3. **可分裂**：存在待处理更新时，可以分成“更新圆钮 + 导入胶囊”两个并列控件。
4. **可合并**：更新处理完或不再需要提示时，更新圆钮收拢、淡出，回到单颗导入胶囊。
5. **业务不分叉**：桌面只替换外壳；导入、更新、书库确认仍调用原 store / composable。
6. **手机不动**：`< 900px` 继续使用原有顶部导入按钮、状态条、bottom sheet 和居中确认框。

不要把它做成“居中的多个 dialog 换个位置”。如果新增状态需要多个互相竞争的浮层，先回到这张状态机重新排序。

## 2. 响应式分流

`App.vue` 中：

```html
<LibraryImportActions v-if="isCompact" compact ... />

<DesktopIsland
  v-if="desktopIslandVisible"
  :active-nav="activeNav"
  ...
/>

<UpdateDialog v-if="isCompact" ... />
<ShelfDialog v-if="isCompact" />
```

规则：

- `isCompact === true`：手机 / 窄屏仍走旧路径。
- `isCompact === false`：桌面走 `DesktopIsland`；桌面不再挂载 `UpdateDialog` 与 `ShelfDialog`。
- 桌面 island 也不在设置页无条件出现，只有导入运行、更新待处理或更新面板打开时才保留入口。

当前 `desktopIslandVisible` 条件：

```js
!isCompact
&& (
  activeNav !== 'settings'
  || importProgress.status !== 'idle'
  || updates.updateDialogOpen
  || updates.hasNewRelease
  || updates.hasPendingInstall
  || !!pendingShelfDialog.value
)
```

修改设置页行为时，先确认这条条件，不要直接在组件内部用 CSS 隐藏。
书库确认必须挂着 `pendingShelfDialog`：用户打开删除 / 建库确认后再切到设置页，island 仍要保留，否则确认框卸载后 Promise 会悬空。

## 3. 锚点与尺寸

### 3.1 锚点

`DesktopIsland` 复用 `.md-fab-pos`：

```css
position: fixed;
right: 28px;
bottom: 26px;
z-index: 40;
```

`z-index: 40` 属于现有层级：高于 sticky 顶栏与浮动侧栏，低于 sheet / 浮层 `50`。
不要再加新的 z-index 阶梯。

### 3.2 单胶囊

| 元素 | 尺寸 | 圆角 | 容器色 | 说明 |
| --- | --- | --- | --- | --- |
| 导入胶囊 | `104 × 56px` | `28px` | `primary-container` | 图标 `20px` + “导入” |
| 导入进度环 | `56 × 56px` | `999px` | `primary-container` | 42px 左右的 SVG 环与数字 |
| 更新圆钮 | `56 × 56px` | `50%` | `secondary-container` | 更新中；完成下载后可切 `primary-container` |
| 两枚控件间距 | `14px` | - | - | 更新圆钮 + 导入椭圆并排时 |

补充：

- 更新圆钮右上角通知点 `7 × 7px`，`1.5px` 描边使用圆钮当前背景色，避免“贴纸感”。
- 导入进度环的 SVG 使用 `stroke-width: 3`，在 `56 × 56` 圆钮内 inset `6px`。
- 更新圆钮在下载已完成时显示 `check`，不再显示通知点。
- 所有图标走 `MdIcon.vue`；不要引入 Material Icons 字体或图标库。

### 3.3 Island surface

| surface | 宽度 | 内容 |
| --- | --- | --- |
| 导入菜单 | `292px` | 文件 / 文件夹 / 新建书库 |
| 导入进度 | `372px` | `ImportProgressPanel embedded` |
| 删除 / 取消收藏确认 | `372px` | `ShelfDialogContent` |
| 文件夹建库 / 命名 / 移动 | `390px` | `ShelfDialogContent` |
| 更新 | `430px` | `UpdateIslandPanel` |

统一规则：

- `border-radius: 28px`
- 背景：`surface-container`
- 文字：`on-surface`
- 阴影只使用 `var(--md-shadow-color)` 派生，不直接使用 `on-surface` / `on-surface-variant`
- 最大高度：
  - 普通 surface：`calc(100dvh - 112px)`
  - 更新 surface：`min(680px, calc(100dvh - 112px))`
- 更新 surface 自己滚动，`overscroll-behavior: contain`
- 书库 surface 在移动目标很多时自己滚动，不能裁掉后段选项

surface 宽度由 `surfaceWidth` 决定，并写入 CSS 变量：

```html
:style="{ '--island-width': `${surfaceWidth}px` }"
```

新增 surface 时先在这里补宽度，不要给内容组件单独写一个会破坏锚点的 `position: fixed`。

## 4. 状态机

### 4.1 输入状态

`DesktopIsland` 只看四组输入：

1. `pendingShelfDialog`：来自 `useShelfDialogs()`，代表删除、建库、命名或移动。
2. `menuOpen`：导入菜单。
3. `importProgress.status` / `importProgress.expanded`：导入任务和进度面。
4. `updates.updateDialogOpen` 与 `updates.updateStatus`：更新面板。

### 4.2 surface 优先级

当前顺序：

```text
书库确认
  > 导入菜单
  > 导入进度
  > 更新面板
  > null（只显示触发按钮）
```

对应实现：

```js
const surface = computed(() => {
  if (pendingShelfDialog.value) return 'shelf';
  if (menuOpen.value && importProgress.status === 'idle') return 'menu';
  if (importSurfaceOpen.value) return 'import';
  if (updates.updateDialogOpen) return 'update';
  return null;
});
```

为什么是这个顺序：

- 删除 / 建库是阻断性确认，不能被导入进度或更新提示挤掉。
- 导入菜单是用户刚刚主动打开的短任务，优先级高于后台更新。
- 导入进度优先级高于更新，因为导入可能正在写 IndexedDB / 原生文件。
- 更新最后，确保它不会抢走输入和确认的焦点。

### 4.3 surfaceKey

`surfaceKey` 控制进入 / 离开过渡：

```js
shelf-${kind}
update-${updateStatus}
menu
import
```

同一 surface 内内容变化不一定触发整块过渡；更新状态变化会触发，因为 key 包含 `updateStatus`。
如果新增的状态切换不应重播整块动画，就不要把变化量放进 `surfaceKey`。

### 4.4 胶囊收起

```js
const replaceSurface = computed(() => !!surface.value && surface.value !== 'update');
const triggerCollapsed = computed(() => replaceSurface.value);
```

- 打开菜单、导入进度、书库确认时：导入胶囊宽度收为 `0`、透明度下降、`inert` 且 `tabindex="-1"`，surface 占用锚点。
- 打开更新面板时：导入胶囊保留，更新圆钮让位给更新 surface。
- surface 退出后，触发按钮重新获得焦点。

### 4.5 更新待处理与分裂

```js
const updatePending = computed(() => (
  updates.hasNewRelease
  || updates.hasPendingInstall
  || ['available', 'downloading', 'downloaded', 'download-error']
    .includes(updates.updateStatus)
));

const showUpdateOrb = computed(() => (
  updatePending.value
  && !surface.value
  && !importSurfaceOpen.value
));
```

分裂态的典型路径：

1. 启动检查或手动检查发现新版本。
2. `updates.updateDialogOpen = true`，更新 surface 打开。
3. 用户点“稍后提醒”或关闭更新 surface。
4. `updateDialogOpen = false`，但 `hasNewRelease` 仍为 `true`。
5. 更新圆钮出现，和导入胶囊并排；导入仍可点。

合并的典型路径：

1. 更新被安装、版本被判定为最新，或待安装状态被清除。
2. `updatePending` 变为 `false`。
3. `showUpdateOrb` 变为 `false`。
4. 更新圆钮宽度收为 `0`、向导入胶囊方向位移并淡出，回到单胶囊。

注意：当前“合并”指更新圆钮退场，不是把两块内容重新排成一块新的复杂面板。若未来要改成“合并后显示安装按钮”，需要新增一个明确的 collapsed surface，而不是只改 CSS。

## 5. 分裂 / 合并动效

### 5.1 节奏

空间位移和宽度：

- `var(--md-duration-medium)`，当前为 `280ms`
- `var(--md-ease-emphasized)`

内容透明度：

- `var(--md-duration-short)`，当前为 `200ms`
- 旧内容离场可缩短到 `120ms`

更新圆钮进入：

- `width / transform / border-radius / opacity` 使用同一组 280ms 过渡
- 透明度 200ms
- `transition-delay: 60ms`

surface 进入：

- opacity 200ms，延迟 60ms
- transform 280ms，延迟 40ms
- 从 `translate3d(8px, 16px, 0) scale(0.3)` 展开

surface 离开：

- opacity 120ms
- transform 160ms
- `--md-ease-accelerate`

### 5.2 为什么不用弹簧

胶囊是系统级浮层，分裂 / 合并需要看起来“稳定地吸附”在锚点上。
不要给整颗胶囊使用明显 overshoot。项目里 `--md-ease-spring` 留给开关滑块等短行程控件；
灵动胶囊优先使用 emphasized easing。

### 5.3 Reduced motion

`prefers-reduced-motion: reduce` 下：

- 所有宽度、位移、透明度、圆角过渡关闭
- 更新检查中的旋转图标停止
- 直接切换状态，不播放分裂 / 合并中间帧

新增动画时把这个媒体查询一起补上；不能只给主面板加，漏掉圆钮或环形进度。

## 6. 内容组件

### 6.1 导入菜单

菜单只包含：

- 导入文件
- 导入文件夹（平台支持时）
- 新建书库

行为：

- 打开前必须 `importProgress.status === 'idle'`
- 选择动作后先关闭菜单，再触发原有 `pick-files` / `pick-folder` / `create-collection`
- 导入状态一旦进入 `running`，菜单自动关闭

不要在这个菜单里新增第二套导入入口；原生文件选择、文件夹扫描、重名确认都仍由 `useImporter` 处理。

### 6.2 导入进度

桌面复用 `ImportProgressPanel`，传入 `embedded`：

- 去掉自身 `372px` 宽、28px 外圆角和外阴影
- 内容宽 `100%`，padding 由 island 内部保持 20px
- 进度面板本身仍有 `role="dialog"` 与 `aria-label="导入进度"`
- `aria-live` 在内部节流；不会每帧播报

导入完成后：

- 无失败且未取消：8 秒后自动收起。
- 有失败：保留面板，展示失败汇总与“重试失败项”。
- 用户停止：保留“已停止”状态。
- 面板打开时不自动收起用户正在操作的 surface。

### 6.3 书库确认 / 建库 / 命名

桌面使用 `ShelfDialogContent`，手机仍使用 `ShelfDialog`。两边共享内容与 Promise 队列：

```js
const title = await askShelfDialog({ kind: 'name', ... });
```

不要在桌面复制一份 `askShelfDialog`；否则会出现两套队列、两个未完成 Promise。

内容规则：

- `kind: 'confirm'`：删除书本 / 删除书库 / 取消收藏。
- `kind: 'folder'`：为导入内容创建书库。
- `kind: 'name'`：新建 / 重命名 / 创建导入书库。
- `kind: 'move'`：移动所选书本到其他书库。
- 只有消息里确实包含“原始文件”时，才展示“原始文件与阅读记录会一起移除”的警告。删除空书库不能误报。
- 删除确认的初始焦点应落在安全按钮（取消），不能默认聚焦“确认删除”。

### 6.4 更新

桌面使用 `UpdateIslandPanel`，业务动作仍由 `updates` store 提供：

| 动作 | Store 方法 |
| --- | --- |
| 打开更新 / 完成卡片 | `openUpdateDialog()` |
| 检查更新 | `checkForUpdates()` |
| 开始下载 | `startUpdateDownload()` |
| 取消下载 | `cancelCurrentDownload()` |
| 关闭更新 | `closeUpdateDialog()` |
| 安装 | `installDownloadedUpdate()` |

不要从 island 直接拼 GitHub URL、直接调用下载服务或自己维护第二份 `updateStatus`。

当前更新 surface 的四种主要状态：

- `available`：版本摘要、安装包选择、立即更新 / 稍后提醒 / 查看详情。
- `downloading`：下载进度、取消。
- `downloaded`：安装包位置、稍后安装 / 立即安装。
- `error`：检查失败；`download-error`：下载失败。

`loading`、`latest` 也复用同一 surface，避免桌面出现一个新弹窗壳。

## 7. 焦点与可访问性

### 7.1 初始焦点

- 菜单：第一个菜单项。
- 导入进度：`.import-progress-panel`。
- 书库确认：取消按钮；命名：输入框并选中文本。
- 更新：关闭按钮；下载中：取消按钮。

### 7.2 关闭后恢复

关闭 surface 后，优先恢复：

1. 打开书库确认前的元素
2. 更新圆钮（如果刚从更新 surface 关闭）
3. 导入胶囊
4. 最后触发更新的按钮

否则会掉到 `body`，键盘用户会突然失去位置。

### 7.3 Tab 与 Escape

- 焦点进入 surface 后，Tab 在 surface 内循环。
- `Escape` 顺序：书库确认 → 导入菜单 → 导入进度 → 更新。
- 删除确认不能因为点外部空白就消失；必须点“取消”或按 `Escape` 明确结束。
- 更新面板在下载中按 `Escape` 会走 `closeUpdateDialog()`，即取消下载；这是当前行为。

### 7.4 不要抢输入焦点

后台检查更新完成后，如果用户正在外部 `input` / `textarea` / `select` / `contenteditable` 中输入，
不要自动把焦点移到更新面板。`DesktopIsland.focusSurface()` 已加文本输入守卫。

新增自动弹出的 surface 时，沿用这个判断：

```js
const isTextEntry = active && (
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
  || active.isContentEditable
);
```

## 8. ARIA 与视觉 token

- 书库确认 surface：`role="alertdialog"`（确认）或 `role="dialog"`，`aria-modal="true"`，标题 `shelf-dialog-title`。
- 更新 surface：自身 `role="dialog"`、`aria-modal="false"`、`aria-busy` 跟随 loading / downloading。
- 菜单：`role="menu"`，条目 `role="menuitem"`。
- 导入触发：`aria-haspopup` 与 `aria-expanded` 跟随菜单 / 进度。
- 更新圆钮：`aria-haspopup="dialog"`，标题明确“有新版本可用”或“更新已下载”。
- 所有颜色必须来自 `--md-*`；禁止新增 hex / `rgb()` / 纯黑纯白。
- 投影必须使用 `var(--md-shadow-color)`，否则夜间会泛白。
- 新增图标必须有 `title` 或 `aria-label`。
- 不新增 toast / `alert` / 全局消息条。

## 9. 已知取舍

- 书库确认的 surface 使用 `aria-modal="true"` 和手写焦点环，但当前没有把整个书架 DOM 设为 `inert`。如果后续要更严格的屏幕阅读器隔离，需要额外做背景 inert，而不是只加 `aria-modal`。
- 更新面板打开时，如果用户打开导入菜单，菜单会临时覆盖更新 surface；关掉菜单后，因为 `updateDialogOpen` 仍为 `true`，更新面会恢复。这个行为来自当前优先级，不是两个 surface 同时存在。
- 更新下载中暂不以“后台下载 + 圆钮进度”形式收起；当前必须保持面板或取消。若要做后台下载，需要单独设计 `update-collapsed` 状态，不能直接放行外部点击。
- 桌面更新不再锁定 `body` 滚动；只有手机更新弹窗和更新日志会锁定。不要为了“统一”把桌面 island 重新改成全屏 modal。

## 10. 修改入口

### 10.1 新增一个 desktop surface

1. 在 `DesktopIsland.vue` 的 `surface` computed 中加入状态来源。
2. 明确它相对现有四级的优先级。
3. 在 `surfaceKey`、`surfaceWidth`、`surfaceClass` 补分支。
4. 新建内容组件，至少暴露 `focusInitial()`。
5. 在模板中挂到 `.desktop-island-surface` 内，不要 `Teleport` 到 body。
6. 在 `onKeydown` / `onDocumentPointerDown` 决定 Escape 与点外部行为。
7. 在 `prefers-reduced-motion` 下关闭新动效。
8. 手机端是否同步？默认不同步；先确认是否需要 mobile sheet。

### 10.2 新增一个更新状态

1. 改 `UpdateIslandPanel.vue` 的模板分支与标题。
2. 如果状态变化需要重播 surface 动画，加入 `surfaceKey`；不需要则不要加。
3. 动作用 `updates` store 方法，不在组件里复制业务。
4. 检查 `updatePending` 是否需要包含新状态，避免待处理圆钮提前消失。
5. 检查 `closeUpdateDialog()` 对新状态是否应该取消下载、保留安装包或只关面板。

### 10.3 调整分裂 / 合并

只改这些点：

- `updatePending`：什么时候算有更新待处理。
- `showUpdateOrb`：什么时候显示圆钮。
- `.island-update-orb`：几何、颜色、图标。
- `.island-orb-enter-active` / `.island-orb-leave-active`：圆钮出现 / 收拢。
- `.island-trigger-row` / `.desktop-island` 的 `gap`：两枚控件的间距。

不要用 `setTimeout()` 手动延迟 DOM 插入来伪造动画；让 Vue `Transition` 和 CSS 过渡完成。

## 11. 验收清单

每次修改灵动胶囊，至少验证：

- [ ] `npm test`
- [ ] `npm run build:vite`
- [ ] `npm run check:dark-glow`
- [ ] `git diff --check`
- [ ] 1440px 桌面：idle / 菜单 / 导入进度 / 删除确认 / 建库 / 命名 / 更新 available / downloading / downloaded
- [ ] 1440px 桌面：更新关闭后的双状态、更新圆钮点击、下载结束后的重新合并
- [ ] 900px：surface 不横向溢出，不盖住可操作按钮
- [ ] 390px：仍走原有手机状态条 / bottom sheet / 居中弹窗，不能出现桌面 island
- [ ] `prefers-reduced-motion: reduce` 下不崩、不闪、不残留中间态
- [ ] 键盘：Tab 不逃出 surface，Escape 能关闭，关闭后焦点回到正确触发点
- [ ] 输入框聚焦时后台更新不会抢焦点
- [ ] 白昼 / 护眼 / 夜间三种表面都没有硬编码白字、暗底发灰或白色泛光
