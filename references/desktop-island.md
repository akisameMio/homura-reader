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
- [ImportProgressPanel.vue](../src/components/ImportProgressPanel.vue)：导入进度内容，桌面与手机共用。
- [DuplicateImportContent.vue](../src/components/DuplicateImportContent.vue)：同名导入确认，桌面与手机共用内容。
- [ShelfDialogContent.vue](../src/components/ShelfDialogContent.vue)：删除 / 建库 / 命名 / 移动书库的内容层。
- [UpdateIslandPanel.vue](../src/components/UpdateIslandPanel.vue)：检查更新、下载、完成、失败等更新状态。
- [ImportMenuSheet.vue](../src/components/ImportMenuSheet.vue)：手机导入菜单 bottom sheet。
- [ImportProgressSheet.vue](../src/components/ImportProgressSheet.vue)：手机导入进行中 / 完成 bottom sheet。
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
6. **手机同源**：`< 900px` 使用顶部导入按钮、状态条和 bottom sheet；菜单、导入进度、同名确认、书库确认与更新共享同一套内容组件。

不要把它做成“居中的多个 dialog 换个位置”。如果新增状态需要多个互相竞争的浮层，先回到这张状态机重新排序。

## 2. 响应式分流

`App.vue` 中：

```html
<LibraryImportActions v-if="isCompact" compact ... />
<ImportMenuSheet v-if="isCompact" ... />
<ImportProgressSheet v-if="isCompact" ... />

<DesktopIsland
  v-if="desktopIslandVisible"
  :active-nav="activeNav"
  ...
/>

<UpdateDialog v-if="isCompact" ... />
<DuplicateImportDialog v-if="isCompact" />
<ShelfDialog v-if="isCompact" />
```

规则：

- `isCompact === true`：手机 / 窄屏使用顶部导入按钮与 bottom sheet；同名确认、书库确认与更新的内容层与桌面共用。
- `isCompact === false`：桌面走 `DesktopIsland`；桌面不挂载手机 sheet 外壳。
- 桌面 island 不在设置页无条件出现，只有导入运行、更新待处理、更新面板打开或待处理确认时才保留入口。

当前 `desktopIslandVisible` 条件：

```js
!isCompact
&& (
  activeNav !== 'settings'
  || importProgress.status !== 'idle'
  || updates.updateDialogOpen
  || updates.hasNewRelease
  || updates.hasPendingInstall
  || !!pendingDuplicate.value
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
| 导入菜单 | `348px` | 文件 / 文件夹 / 新建书库 |
| 导入进度 | `432px` | `ImportProgressPanel` |
| 同名确认 | `432px` | `DuplicateImportContent` |
| 删除 / 建库 / 命名 / 移动 | `432px` | `ShelfDialogContent` |
| 更新 | `448px` | `UpdateIslandPanel` |

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
- 内容层右下角只让出主行动位置，不再渲染第二颗主按钮；实际操作按钮就是导入胶囊本体
- 同一颗按钮在关闭时是导入胶囊 / 进度圆环，展开后移动到卡片右下角并切换为当前动作：
  高度 `56px`、圆角 `28px`、图标 `20px`、`gap: 7px`、水平 padding `13px`；
  四字文案约 `106 × 56px`，与 `104 × 56px` 的导入胶囊几乎同宽
- 卡片动作不投影，保持平面；回到导入胶囊时再恢复悬浮阴影。不要用克隆层补按钮
- 动作色调：`primary` 用 `primary-container / on-primary-container`，`tonal` 用
  `secondary-container / on-secondary-container`，`danger` 用
  `error-container / on-error-container`；不要在卡片里再放实心 `primary` 大按钮
- 共享内容组件通过 `host-primary-action` 在桌面端隐藏内部主按钮，并暴露
  `primaryAction` / `runPrimaryAction()`；手机 bottom sheet 不传该属性，继续渲染原按钮
- 桌面 surface 不显示右上角关闭图标；点外部、`Escape` 或底部取消 / 关闭动作退出

surface 宽度由 `surfaceWidth` 决定，并写入 CSS 变量：

```html
:style="{
  '--island-width': `${surfaceWidth}px`,
  '--trigger-width': `${triggerWidth}px`,
  '--enter-seed-width': `${enterSeed.width}px`,
  '--enter-seed-right': `${enterSeed.right}px`,
  '--enter-seed-bottom': `${enterSeed.bottom}px`
}"
```

`DesktopIsland` 触发行的 spacer 保持右侧按钮的自然占位，surface 与真实按钮都使用
`position: absolute`：surface 锚定 `right: 0; bottom: 0`，按钮关闭时锚定
`right: 0; bottom: 0`、展开时锚定 `right: 20px; bottom: 20px`。
surface 的缩放原点固定为 `100% 100%`，按钮宽度变化和更新圆钮进出都不会推动 surface。
`triggerWidth` 为空闲态 `104px`、导入进行中 `56px`，用于**收起时的目标控制**。
入场种子另用 `enterSeed`：在 `surfaceKey` 从空变为某个 surface 时同步读取按钮当时的
`offsetWidth`，此时按钮在锚点 `right: 0; bottom: 0`。这样从空闲胶囊直接开始导入时
仍从 `104 × 56` 长出来，而从进度环重新展开时则从 `56 × 56` 长出来。

非空 surface 之间切换时按钮仍停在卡片动作位，入场种子改用按钮当前宽度并带上
`right: 20px; bottom: 20px`，保证新卡片也精确从这颗动作按钮长出来，而不是从卡片
外框的右下角另起一颗小圆。surface 不再按 `seed-x / seed-y` 压扁，而是用 `clip-path`
从按钮的真实矩形长出来。

surface 自身的 `border-radius` 始终是 `28px`。不要把它过渡到 `999px`：`104 × 56` 与
`56 × 56` 的种子在 `28px` 圆角下本来就是胶囊 / 圆形，而把整张 `432 × 400` 的卡片
动画到 `999px` 会先变成一颗大白球，正是之前“卡片收缩出现巨大白块”的原因。

新增 surface 时先在这里补宽度，不要给内容组件单独写一个会破坏锚点的 `position: fixed`。

## 4. 状态机

### 4.1 输入状态

`DesktopIsland` 只看五组输入：

1. `pendingDuplicate`：来自 `useDuplicateImport()`，代表同名导入确认。
2. `pendingShelfDialog`：来自 `useShelfDialogs()`，代表删除、建库、命名或移动。
3. `menuOpen`：导入菜单。
4. `importProgress.status` / `importProgress.expanded`：导入任务和进度面。
5. `updates.updateDialogOpen` 与 `updates.updateStatus`：更新面板。

### 4.2 surface 优先级

当前顺序：

```text
同名确认
  > 书库确认
  > 导入菜单
  > 导入进度
  > 更新面板
  > null（只显示触发按钮）
```

对应实现：

```js
const surface = computed(() => {
  if (pendingDuplicate.value) return 'duplicate';
  if (pendingShelfDialog.value) return 'shelf';
  if (menuOpen.value && importProgress.status === 'idle') return 'menu';
  if (importSurfaceOpen.value) return 'import';
  if (updates.updateDialogOpen) return 'update';
  return null;
});
```

为什么是这个顺序：

- 同名确认直接决定“保留还是跳过”，必须先于导入进度和书库整理。
- 删除 / 建库是阻断性确认，不能被导入进度或更新提示挤掉。
- 导入菜单是用户刚刚主动打开的短任务，优先级高于后台更新。
- 导入进度优先级高于更新，因为导入可能正在写 IndexedDB / 原生文件。
- 更新最后，确保它不会抢走输入和确认的焦点。

### 4.3 surfaceKey

`surfaceKey` 控制进入 / 离开过渡：

```js
duplicate
shelf-${kind}
update-${updateStatus}
menu
import
```

同一 surface 内内容变化不一定触发整块过渡；更新状态变化会触发，因为 key 包含 `updateStatus`。
如果新增的状态切换不应重播整块动画，就不要把变化量放进 `surfaceKey`。

### 4.4 胶囊收起

- 触发行只保留一个与导入胶囊同宽的 spacer（idle `104px`、导入进行中 `56px`）和更新圆钮；
  surface 打开时 spacer 收成零宽，真实按钮是 `position: absolute`，不会推动 surface。
- 打开任意 surface 时，真实按钮不隐藏、不 `inert`、不复制；它直接移动到卡片右下角，
  切换成当前 surface 的 `primaryAction`，并承担卡片主行动。
- 内容组件在桌面端通过 `host-primary-action` 隐藏自己的主按钮，只保留其他辅助 text button。
- surface 退出后，同一颗按钮回到导入胶囊位置并恢复焦点。

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

更新圆钮只在没有 surface 时出现。更新面板打开后，导入胶囊收起、圆钮隐藏，
整块更新内容占用同一个右下角锚点。

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

- 卡片裁切使用 `--island-morph-ease: cubic-bezier(0.22, 1, 0.36, 1)`，不回弹，
  避免 `clip-path` 先缩过头再弹回
- 按钮自身的位置 / 宽度同样使用 `--island-morph-ease`，不要用带过冲的弹簧驱动
  `right / bottom / width`，否则收起时按钮会短暂越过锚点
- 轻微的 `scale` 回弹使用 `--island-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`
- `--island-morph-duration: 480ms`
- 按钮宽度 / 位置使用 `420ms`，位置延迟 `50ms`，与卡片外框同步收放
- 更新圆钮仍使用 `var(--md-duration-medium)` / `var(--md-ease-emphasized)`

内容透明度：

- `var(--md-duration-short)`，当前为 `200ms`
- 旧内容离场可缩短到 `120ms`

更新圆钮进入：

- `width / transform / border-radius / opacity` 使用同一组 280ms 过渡
- 透明度 200ms
- `transition-delay: 60ms`

surface 进入：

- `clip-path` 使用 `--island-morph-duration` 与 `--island-morph-ease`
- `transform` 使用同一时长与 `--island-spring`，只负责很轻的整体回弹
- surface 绝对定位在根节点右下角，`transform-origin: 100% 100%`
- 起点是导入按钮**入场前**的真实矩形：空闲胶囊为 `104 × 56 / 28px`，
  进度环或已完成环为 `56 × 56 / 28px`
- `clip-path` 从
  `inset(calc(100% - var(--enter-seed-bottom) - 56px) var(--enter-seed-right) var(--enter-seed-bottom) calc(100% - var(--enter-seed-right) - var(--enter-seed-width)) round 28px)`
  展开到完整卡片，不再把整张卡片压扁成长条
- `transform` 只从 `scale(0.985)` 轻微回弹到 `1`，避免内容跟着按钮尺寸失真
- 外壳保持实色，不做整卡 opacity 淡入；否则会像 modal 幽灵浮现，而不是胶囊本体变大
- 形变期间给 surface 轻微 `filter: blur(0.6px)`，220ms 内衰减到 0，模拟运动模糊
- 内容层 420ms、延迟 50ms 进入：`opacity 0 → 1`、`blur(5px) → 0`、
  `translateY(6px) scale(0.93) → translateY(0) scale(1)`

surface 离开：

- `clip-path` 430ms，延迟 60ms，使用不回弹的 `--island-morph-ease`
- 起点是比 surface 外扩 `80px` 的裁切框，保留正常投影；终点收成右下角
  `104 × 56`（导入进行中为 `56 × 56`），圆角固定 `28px`；收起目标跟随当前状态，
  不沿用入场时的种子
- 外壳不做整体透明度淡出，最终裁切矩形与真实按钮重合，由按钮接管视觉
- 内容层不参与缩放：文字保持原尺寸，由裁切框从右下角向左上收走
- 内容层 140ms 后开始淡出，并在 220ms 内轻微 `scale(0.97)` / `blur(3px)`
- 同一颗真实按钮从卡片操作位 `right: 20px; bottom: 20px` 回到触发锚点
  `right: 0; bottom: 0`；位置、宽度、圆角、底色、文字色与阴影在同一段过渡内完成
- 动作文案先保留约 140ms，再与导入文案交叉淡入淡出；不允许出现克隆节点
- 收起期间 `surfaceLeaving` 为真，按钮关闭指针事件，避免动画中途重复触发动作
- 非空 surface 之间切换（例如同名确认 `duplicate → import`、更新
  `available → downloading`）时 Transition **不再使用 `out-in`**：旧卡片离场与
  新卡片入场同时进行，新卡片叠在旧卡片上方。这样卡片始终存在，不会在旧卡收成
  按钮后留下几百毫秒“只剩进度环”的空档。`surfaceSwapping` 只负责动作文案交接，
  按钮继续停在卡片右下角，不再先缩回进度环
- 同时过渡时给 `.island-surface-enter-active` 显式 `z-index: 2`，保证入场卡片
  盖住离场卡片；否则两张卡片的文字会短暂叠在一起
- `prefers-reduced-motion` 下跳过位移与文案延迟，直接恢复到导入胶囊

进入与离开都以 `clip-path` 为主，让卡片从右下角按钮矩形里长出来 / 收回去；
`transform` 只负责很轻的整体回弹。实现不过渡 surface 宽高，内容不跟着卡片缩放。
按钮自己只过渡位置、宽度、圆角、颜色与阴影。

改这里时先用 1440×900 实测：展开首帧按钮应在导入胶囊原矩形内，展开末帧右下角
应精确落在 `x = surfaceRight - 20 - buttonWidth`、
`y = surfaceBottom - 20 - 56`；收起末帧应回到
`x = viewportRight - 28 - 104`、`y = viewportBottom - 26 - 56`。
同时确认展开 / 收起前后 `document.querySelector('.island-import-trigger')`
仍是同一个节点，且页面中不存在 `.island-action-handoff`。

### 5.2 为什么裁切不用弹簧

形变的主体是 `clip-path`。它一旦带回弹，收起时会先缩到比按钮更小再弹回，
露出“卡片已经没了、按钮还在原地”的空档；展开时也会先冲过卡片边界再收回来。
所以裁切和按钮几何统一使用不回弹的 `cubic-bezier(0.22, 1, 0.36, 1)`。

`cubic-bezier(0.34, 1.56, 0.64, 1)` 只保留给 surface 的轻微 `scale(0.985 → 1)`，
让整体有一点呼吸感，但不能拿它驱动裁切、宽度或锚点位置。两个曲线都只定义在
`DesktopIsland` 内部，不替换项目通用的 `--md-ease-spring`。

如果后续调整参数量级，先确认两件事：起点仍精确覆盖导入按钮，终点仍准确落在
`right: 20px; bottom: 20px` 的卡片动作位。

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

桌面复用 `ImportProgressPanel`：

- 内容宽 `100%`，padding 由面板自身保持 20px；外圆角与阴影由 island surface 承担
- 进度面板本身有 `role="group"` 与 `aria-labelledby="import-progress-title"`
- `aria-live` 在内部节流；不会每帧播报

导入完成后：

- 无失败且未取消：8 秒后自动收起。
- 有失败：保留面板，展示失败汇总与“重试失败项”。
- 用户停止：保留“已停止”状态。
- 面板打开时不自动收起用户正在操作的 surface。

手机 `ImportProgressSheet` 复用同一内容组件：进行中与完成后都使用 bottom sheet，
关闭进行中的 sheet 只收起内容，不取消导入任务；取消任务仍由“停止导入”按钮完成。

### 6.3 同名确认 / 书库确认 / 建库 / 命名

桌面使用 `DuplicateImportContent` 与 `ShelfDialogContent`；手机分别使用
`DuplicateImportDialog` 与 `ShelfDialog` 的 bottom sheet 外壳。两边共享内容与 Promise 队列：

```js
const duplicateSession = createDuplicateSession();
const keep = await duplicateSession.confirmDuplicates([{ title, existingTitle }]);
const title = await askShelfDialog({ kind: 'name', ... });
```

不要在桌面复制一份 `askShelfDialog`；否则会出现两套队列、两个未完成 Promise。

内容规则：

- `pendingDuplicate`：先于书库确认处理；默认焦点落在“跳过”，明确选择后才继续导入。
- 一次导入共用 `createDuplicateSession()`：连续跳过同名书时保持当前卡片，
  下一本只替换 `pendingDuplicate` 内容，不再先清空 pending 让卡片收缩重开。
- 卡片底部提供“跳过此书 / 全部跳过”；“全部跳过”会立即关闭确认卡，并让本次导入
  后续所有同名检测直接返回跳过，不再逐本弹出。“仍然导入”保持原有独立书本语义。
- `kind: 'confirm'`：删除书本 / 删除书库 / 取消收藏。
- `kind: 'folder'`：为导入内容创建书库。
- `kind: 'name'`：新建 / 重命名 / 创建导入书库。
- `kind: 'move'`：移动所选书本到其他书库。
- 只有消息里确实包含“原始文件”时，才展示“原始文件与阅读记录会一起移除”的警告。删除空书库不能误报。
- 删除确认的初始焦点应落在安全按钮（取消），不能默认聚焦“确认删除”。
- 手机同名确认保留 bottom sheet；其他手机确认也同样使用 bottom sheet 外壳，不再回到居中 modal。

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
- 导入进度：当前主行动（进行中为停止，完成为重试 / 完成）。
- 同名确认：跳过按钮。
- 书库确认：取消按钮；命名：输入框并选中文本。
- 更新：当前主行动；下载中为取消。

### 7.2 关闭后恢复

关闭 surface 后，优先恢复：

1. 打开书库确认前的元素
2. 更新圆钮（如果刚从更新 surface 关闭）
3. 导入胶囊
4. 最后触发更新的按钮

否则会掉到 `body`，键盘用户会突然失去位置。

### 7.3 Tab 与 Escape

- 焦点进入 surface 后，Tab 在 surface 内循环；桌面端真实主行动按钮位于 surface 外，
  由 `focusableElements()` 追加到循环末尾，而不是在内容层复制一份。
- `Escape` 顺序：同名确认 → 书库确认 → 导入菜单 → 导入进度 → 更新。
- 删除确认不能因为点外部空白就消失；必须点“取消”或按 `Escape` 明确结束。
- 同名确认点外部按“跳过”结束，避免没有可见关闭图标时卡住。
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
- 同名确认 surface：`role="dialog"`、`aria-modal="true"`，标题 `duplicate-import-title`。
- 导入进度 surface：`role="dialog"`，标题 `import-progress-title`；内容面板内部使用 `role="group"`。
- 更新 surface：自身 `role="dialog"`，不声明 `aria-modal`，`aria-busy` 跟随 loading / downloading。
- 菜单：`role="menu"`，条目 `role="menuitem"`。
- 导入触发 / 卡片主行动：关闭时 `aria-haspopup` 与 `aria-expanded` 跟随菜单 / 进度；
  展开为卡片动作时移除这两个属性，标题改成当前动作文案。surface 通过
  `aria-owns="homura-island-action"` 把外置按钮纳入对话框语义。
- 更新圆钮：`aria-haspopup="dialog"`，标题明确“有新版本可用”或“更新已下载”。
- 所有颜色必须来自 `--md-*`；禁止新增 hex / `rgb()` / 纯黑纯白。
- 投影必须使用 `var(--md-shadow-color)`，否则夜间会泛白。
- 新增图标必须有 `title` 或 `aria-label`。
- 不新增 toast / `alert` / 全局消息条。

## 9. 已知取舍

- 书库确认的 surface 使用 `aria-modal="true"` 和手写焦点环，但当前没有把整个书架 DOM 设为 `inert`。如果后续要更严格的屏幕阅读器隔离，需要额外做背景 inert，而不是只加 `aria-modal`。
- 更新面板打开时导入胶囊会收起，因此不能在更新 surface 上再叠一个导入菜单；它们共享同一个锚点，同一时刻只存在一个 surface。
- 更新下载中暂不以“后台下载 + 圆钮进度”形式收起；当前必须保持面板或取消。若要做后台下载，需要单独设计 `update-collapsed` 状态，不能直接放行外部点击。
- 桌面更新不再锁定 `body` 滚动；只有手机更新弹窗和更新日志会锁定。不要为了“统一”把桌面 island 重新改成全屏 modal。

## 10. 修改入口

### 10.1 新增一个 desktop surface

1. 在 `DesktopIsland.vue` 的 `surface` computed 中加入状态来源。
2. 明确它相对现有五级的优先级。
3. 在 `surfaceKey`、`surfaceWidth`、`surfaceClass` 补分支。
4. 新建内容组件，至少暴露 `focusInitial()`、`primaryAction` 与 `runPrimaryAction()`。
5. 内容组件接受 `hostPrimaryAction`；桌面端隐藏内部主按钮，手机端保持默认按钮。
6. 在模板中挂到 `.desktop-island-surface` 内并传 `host-primary-action`，不要 `Teleport` 到 body。
7. 在 `onKeydown` / `onDocumentPointerDown` 决定 Escape 与点外部行为。
8. 在 `prefers-reduced-motion` 下关闭新动效。
9. 手机端是否同步？确认后优先复用同一个内容组件，只替换成 bottom sheet 外壳。

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

- [ ] `npm run build:vite`
- [ ] `npm run check:dark-glow`
- [ ] `git diff --check`
- [ ] 1440px 桌面：idle / 菜单 / 导入进度 / 同名确认 / 删除确认 / 建库 / 命名 / 更新 available / downloading / downloaded
- [ ] 1440px 桌面：更新关闭后的双状态、更新圆钮点击、下载结束后的重新合并
- [ ] 900px：surface 不横向溢出，不盖住可操作按钮
- [ ] 390px：导入菜单、导入进度、同名确认、书库确认与更新都走 bottom sheet，不能出现桌面 island
- [ ] `prefers-reduced-motion: reduce` 下不崩、不闪、不残留中间态
- [ ] 键盘：Tab 不逃出 surface，Escape 能关闭，关闭后焦点回到正确触发点
- [ ] 输入框聚焦时后台更新不会抢焦点
- [ ] 白昼 / 护眼 / 夜间三种表面都没有硬编码白字、暗底发灰或白色泛光
