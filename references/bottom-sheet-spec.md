# HOMURA Bottom Sheet 规范

> 适用版本：HOMURA `2.2.7`  
> 状态：新增 bottom sheet 必须遵守；存量组件在重做时逐步收敛。  
> 目标：所有手机底部面板使用同一套结构、表面、尺寸、手势和物理弹簧，不再出现第三套 sheet 皮肤。

本文是 bottom sheet 的权威规范。组件选型、实现示例和验收清单以本文为准；
颜色 token 见 [tokens.md](./tokens.md)，通用组件写法见 [md3-component-guide.md](./md3-component-guide.md)。

视觉基准是已确认的阅读设置：大标题、左侧圆形关闭按钮、柔和容器底色与大圆角分组卡片。
阅读目录、字体选择、更新日志按用户要求保留当前设计；本文不要求将这三项重新设计，也不要求机械改造所有存量组件。

## 1. 先选模板

新组件只允许从下面两种模板中选一种，不允许自己写一套 fixed 定位 + 固定时长 transition 的 sheet。

| 场景 | 必须使用 | 典型组件 |
| --- | --- | --- |
| 页面级、全局流程、确认 / 导入 / 更新 / 设置弹层 | `MobileBottomSheet.vue` | `ImportMenuSheet.vue`、`UpdateDialog.vue`、`ShelfDialog.vue` |
| 阅读器内部、需要和阅读状态互斥的抽屉 | `.md-drawer` + `ReaderDrawerHeader.vue` | `ReaderSettingsDrawer.vue`、`ReaderFontDrawer.vue`、`ReaderTocDrawer.vue` |

判断规则：

- 打开后是否要盖住整个应用、并由 `dialog` 接管焦点和返回：用 `MobileBottomSheet.vue`。
- 是否属于阅读器、需要跟随阅读器顶栏 / 底栏 / 返回手势：用 `.md-drawer` 模板。
- 阅读器桌面 `>=900px` 需要变成右侧 side sheet 时，使用 `.md-drawer` 响应式模板。
- 通用流程在 compact 分支使用 `MobileBottomSheet`，桌面分支按场景提供对话框、菜单或 side sheet。
- 桌面只是一个锚定在按钮旁的小浮层，不叫 bottom sheet；使用菜单或 `AppearanceSheet` 的桌面浮层写法。

禁止：

- 新组件直接使用历史类 `.md-bottom-sheet` 或 `.md-sheet-enter-active` 作为 sheet 进出场。
- 在业务组件里手写 `position: fixed; bottom: 0` 再拼一套圆角、遮罩和动画。
- 为了“更稳妥”写 `z-[999]`、私有遮罩色或私有圆角。

## 2. 统一结构

```text
┌────────────────────────────────────┐
│            拖拽条 32×4             │  仅手机
│  关闭按钮  标题 / 可选状态或页签    │  固定头部
├────────────────────────────────────┤
│                                    │
│  可滚动内容                        │  独立滚动区
│  分组卡片 / 列表 / 表单            │
│                                    │
├────────────────────────────────────┤
│  固定底部操作（可选）              │  安全区内
└────────────────────────────────────┘
```

### 2.1 头部

- 统一使用 `ReaderDrawerHeader.vue`，不要另写标题和关闭按钮。
- Bottom sheet 默认传 `prominent`：标题 `22px / 600`，左侧圆形关闭按钮 48px；桌面 side sheet 沿用同一头部，保持同源。
- 只有嵌在更小容器里的历史抽屉才使用默认 `17px` 头部，新 sheet 不作为默认样式。
- 阅读器需要标题同行页签时，给 `ReaderDrawerHeader` 传 `prominent inline-tabs`，在 `status` 插槽使用
  `ReaderDrawerTabs.vue`；此模式标题为 20px，关闭按钮为 44px。
- `MobileBottomSheet` 已内置 `prominent` 头部，只开放 `status` 插槽，当前不提供 `inlineTabs` prop。
  需要通用同行页签时应集中扩展共享外壳，不要给业务组件私加一份头部或用透传属性假定其生效。
- 头部固定，不随内容滚动；副标题最多一行，超出省略并提供 `title`。

### 2.2 拖拽条

- 仅 `<900px` 渲染；桌面 side sheet 不显示拖拽条。
- 拖拽区高度 36px；`prominent` 头部为 24px。
- 拖拽条 `32px × 4px`，胶囊圆角，颜色 `outline-variant`。
- 拖拽区挂 `data-sheet-drag-handle`，手势统一由 `useSheetDrag()` 接管。

### 2.3 内容区

- 通用 sheet：`.md-mobile-sheet-body`。
- 阅读器抽屉：`.md-drawer-body`。
- 内容区必须 `flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain`。
- 通用内容区 padding 为 `0 18px 20px`；无 footer 时底部为
  `calc(20px + env(safe-area-inset-bottom, 0px))`；有 footer 时由 footer 承担安全区。
- 阅读器内容区按现有模板保留安全区与滚动留白，不直接复制通用外壳的定位规则。
- 长标题、路径、错误信息必须 `overflow-wrap: anywhere`，不能把 sheet 撑出横向滚动。

### 2.4 底部操作

- 通用 sheet：`.md-mobile-sheet-footer`；阅读器抽屉：`.md-drawer-actions`。
- footer 固定，不随内容滚走；按钮全宽，主行动只有一个。
- 通用 footer padding 为 `12px 18px max(16px, env(safe-area-inset-bottom, 0px))`，
  按钮间距 8px、最小高度 48px。
- 主行动使用 `.md-filled-button`；次要行动使用 `.md-tonal-button` 或 `.md-text-button`。
- 高风险操作使用 `.md-mobile-sheet-danger`，不得自写错误红。

## 3. 尺寸与响应式

### 3.1 手机 `<900px`

| 项目 | 规范 |
| --- | --- |
| 宽度 | `100%`，贴底 |
| 默认高度 | `78dvh` |
| 最大高度 | `calc(var(--md-sheet-viewport-height, 100dvh) - env(safe-area-inset-top, 0px) - 8px)` |
| 顶部圆角 | `28px 28px 0 0` |
| 底部 | `env(safe-area-inset-bottom)` |
| 遮罩 | `.md-scrim`，z-index `40` |
| `.md-drawer` sheet | z-index `50` |

`MobileBottomSheet` 走原生 `dialog` 的 top layer，不再额外写 z-index。

- 默认支持双档位：默认 `78dvh`，整卡上拖到状态栏下方；向下拖先回默认档，再继续下拉才关闭。
  禁止拖动的流程通过 `draggable=false` 明确关闭该入口，保留其他适用的关闭方式。
- 软键盘弹起时使用 `window.visualViewport` 同步可用高度；通用模板已写入 `--md-sheet-viewport-height`。
- 不允许让 sheet 顶到状态栏图标上；顶部至少保留 `safe-area-top + 8px`。

### 3.2 桌面 `>=900px`

- 阅读器抽屉在桌面变为右侧 side sheet：宽 372px、最大 92%、高度 100%、左侧 28px 圆角。
- 通用 `MobileBottomSheet` 面向 compact 布局；新桌面流程应优先用对话框、菜单或 side sheet，不要强行把手机底栏搬到桌面。
- 桌面打开阅读抽屉时，阅读正文要预留 372px，不能让 sheet 盖住仍可点击的正文。

### 3.3 层级

以下数值适用于阅读器等自定义遮罩结构：

| 层 | z-index |
| --- | --- |
| 遮罩 | 40 |
| Bottom sheet / side sheet | 50 |
| 全窗拖拽导入遮罩 | 60 |

只使用 `AGENTS.md` 的层级阶梯。`MobileBottomSheet` 的 `showModal()` 使用浏览器 top layer，
不受普通 z-index 排序控制；不要给它补 z-40 / z-50，也不要依赖 z-60 遮住原生模态框。
更新日志当前的 `z-70` 属于历史特例，新组件不得照抄。

## 4. 表面与内容语言

### 4.1 外壳

- Sheet 外壳统一使用：
  `color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low))`
- 文字使用 `--md-on-surface`；次要文字使用 `--md-on-surface-variant`。
- 遮罩统一 `color-mix(in oklab, var(--md-shadow-color) 32%, transparent)`；`.md-drawer` 使用
  `.md-scrim`，`MobileBottomSheet` 使用 `dialog::backdrop`，两者颜色必须一致。
- 手机投影使用 `--md-shadow-color-soft`；禁止把 `--md-on-surface` 当阴影色，否则夜间泛白。

### 4.2 分组卡片

- 通用 sheet 使用 `.md-mobile-sheet-card`；新增阅读器卡片沿用阅读设置的卡片结构，适用时复用该类。
  `.md-drawer-section` 是存量分隔线分组，不能当作 26px 圆角卡片的等价替代。
- 卡片圆角 26px，背景 `--md-surface`，卡片之间间距 18px。
- 分组标签使用 `.md-mobile-sheet-label` / `.md-drawer-group-label`，`11–12px / 600`。
- 当前项使用 `secondary-container` + `on-secondary-container`，不能只靠颜色变化表达选中。
- 图标容器、危险提示、表单字段分别复用 `.md-mobile-sheet-icon`、`.md-mobile-sheet-notice`、`.md-mobile-sheet-field`，不要在业务组件里另造一套。

### 4.3 内容密度

| 内容 | 共享类 / 尺寸 |
| --- | --- |
| 卡片 | `.md-mobile-sheet-card`；底部间距 18px，末张为 0；`is-padded` 内边距 18px |
| 分组标签 | `.md-mobile-sheet-label`；12px / 600，外边距 `20px 14px 10px`，首组顶部 2px |
| 列表行 | `.md-mobile-sheet-row`；最小高度 64px，padding `14px 18px`，gap 12px |
| 图标容器 | `.md-mobile-sheet-icon`；40×40px，圆角 14px，内部图标 21px |
| 主文字 | `.md-mobile-sheet-copy b`；13px / 600，行高 1.55 |
| 辅助文字 | `.md-mobile-sheet-copy small` / `.md-mobile-sheet-hint`；11px，行高 1.75 |
| 数字元信息 | `.md-mobile-sheet-meta`；11px，`tabular-nums` |
| 表单输入 | `.md-mobile-sheet-field`；高 52px，圆角 16px，文字 16px，避免移动浏览器聚焦缩放 |

- 可点击的列表行使用原生 `button`；只展示信息的行可使用 `div`，不能让静态信息获得无意义的焦点。
- 一屏只保留一个 `primary` 实心主行动。
- 长文本、错误信息、文件路径必须换行，不允许横向溢出。
- 不用 toast / `alert` 打断 sheet；可恢复错误写在 sheet 内的 `role="alert"` 区域。

## 5. 动效

### 5.1 进出场：物理弹簧

新增 sheet 必须使用 `useSheetSpring()`（`src/composables/useSheetSpring.ts`），不再新增固定时长的
`enter-active-class` / `leave-active-class`。

统一步骤：

1. 用 `<Transition :css="false">` 绑定 `onBeforeEnter`、`onEnter`、`onBeforeLeave`、`onLeave`、
   `onAfterLeave`、`onLeaveCancelled`。
2. `useSheetSpring({ isCompact })`：手机从底部 `translate3d(0, 100%, 0)` 进入，桌面 side sheet
   从右侧 `translate3d(100%, 0, 0)` 进入。
3. 入场使用 `stiffness 380 / damping 0.86`，允许最多 2px 过冲后收束。
4. 退场使用 `stiffness 760 / damping 1`，加速滑出；拖拽关闭已经把卡片移出屏幕时跳过二次离场。
5. 阅读器遮罩单独使用 `.md-fade-*` 淡入淡出；自定义整体容器可按现有实现传 `fadeRoot: true`。
   通用外壳的 `dialog::backdrop` 当前保持固定 32% 遮罩，随原生模态框开启 / 关闭，不执行独立淡入淡出。

禁止：

- 用 `transition: transform 200ms` 代替弹簧，造成“能看出时长”的段落感。
- 在业务组件里给通用原生 backdrop 另加定时器或第二层遮罩；需要改进时集中修改共享外壳。
- 在 sheet 内部再叠一层覆盖全屏的私有遮罩。

### 5.2 拖动

手势统一走 `useSheetDrag()`（`src/composables/useSheetDrag.ts`）：

- 拖拽条和整张卡片都能起手；按钮、输入、滑条、页签、`[data-sheet-no-drag]` 不接管。
- 内容滚动区未回到顶部时，向下拖动交还原生滚动；回到顶部后才接管 sheet。
- 向上拖动增加高度，最大到状态栏下方；最大档位下继续向上交给内容滚动。
- 向下拖动先收缩回默认档，继续下拉才关闭。

吸附阈值：

| 行为 | 条件 |
| --- | --- |
| 关闭 | 下拉超过 `min(112px, 基础档高度 × 22%)`，或下拉超过 24px 且速度 > `0.6 px/ms` |
| 展开 | 向上扩展超过半程，或高度速度 > `0.35 px/ms` |
| 回弹 | 未达到关闭 / 展开阈值，回到最近档位 |

跟手阶段直接写 DOM style，不驱动 Vue 响应式；松手吸附使用 200ms
`cubic-bezier(0.2, 0, 0, 1)` 的 `height` / `transform` 过渡。
起手意图阈值为 8px。展开判定还要求没有向下偏移；阈值由共享 composable 维护，
业务组件不得复制常量或覆盖弹簧参数。拖动高度与页签滑块宽度是共享组件内受控的布局过渡例外。

### 5.3 页签与内容切换

- 页签胶囊使用 `ReaderDrawerTabs.vue`，滑块位移 / 宽度 280ms
  `cubic-bezier(0.22, 1.2, 0.36, 1)`，允许轻微回弹。
- 页签面板使用 `.md-drawer-tab-panel`：220ms 淡入 + 6px 上移，`backwards` 填充。
- 不要为每个面板各写一套动画；页签切换必须保留滚动位置策略，目录切换后按既有逻辑滚到当前项。

### 5.4 减少动态效果

`prefers-reduced-motion: reduce` 下：

- 跳过进出场弹簧，直接落到最终位置。
- 跳过拖动吸附的位移过渡，直接更新档位。
- 页签滑块、面板淡入、卡片 hover 位移全部关闭。
- 不能因为关闭动画而丢失最终状态、焦点或滚动锁释放。

## 6. 交互与无障碍

每个 sheet 至少满足：

- 通用外壳使用原生 `<dialog>.showModal()`，由浏览器提供模态语义与焦点圈定，并设置
  `aria-labelledby`；自定义阅读器 drawer 显式设置 `role="dialog"`、`aria-modal="true"`，
  自行接入焦点圈定。异步繁忙状态加 `aria-busy`。
- 有明确的关闭按钮，`title` 与 `aria-label` 一致。
- 默认允许点击遮罩、关闭按钮、`Esc` 和下拉关闭；需要限制时使用第 7 节的独立开关。
- `busy` 表示暂时不可退出的提交阶段，禁止外壳的所有关闭入口；可取消的下载不能仅因为在加载就设为 `busy`。
- 打开后焦点进入 sheet，关闭后回到触发按钮；Tab 焦点不能跑到 sheet 外。
- 触发按钮带 `aria-haspopup="dialog"` 与 `aria-expanded`。只有存在真实 dialog 容器 ID 时才设置
  `aria-controls`；`titleId` 是标题 ID，不能代替容器 ID，也不能假定属性会穿透 `Teleport`。
- 初始焦点选关闭 / 取消等安全入口，不自动聚焦删除确认按钮；命名表单可在 `opened` 后主动聚焦并选中文本。
- 打开期间锁背景滚动；关闭动画完成后再释放锁。多个 sheet / 菜单交替打开时使用共享计数锁。
- Android 阅读器内的 drawer 还要接入 `useReaderBackDismiss`，不能让返回键直接退出阅读器。
- 自定义阅读器 drawer 还需由调用方负责互斥状态、背景滚动锁、工具栏暂停与关闭后的焦点恢复。
  `.md-drawer` 只是样式，不会提供这些行为；参考 `ReaderSettingsDrawer.vue` 与 `ReaderModal.vue` 的配合。

## 7. 实现模板

### 7.1 通用页面级 sheet

优先直接复用 `MobileBottomSheet.vue`，业务组件只提供标题、内容和 footer：

#### 接口契约

| Prop | 默认值 | 用途 |
| --- | --- | --- |
| `open` | `false` | 受控打开状态，外壳不会自行修改 |
| `title` / `titleId` | 必填 | 标题文字与唯一标题 ID |
| `descriptionId` | `''` | 可选说明元素 ID，映射到 `aria-describedby` |
| `closeLabel` | `关闭面板` | 关闭按钮的可访问名称 |
| `backdropDismissible` | `true` | 只控制点击遮罩关闭 |
| `draggable` | `true` | 控制拖拽条和拖动，不影响关闭按钮 / Esc |
| `busy` | `false` | 禁止关闭按钮、Esc、遮罩、拖动，并设置繁忙语义 |

| 事件 / 插槽 | 契约 |
| --- | --- |
| `close` | 关闭按钮、遮罩、拖动发出的请求；调用方更新 `open` |
| `cancel` | 原生 dialog 的取消请求（如 Esc）；调用方更新 `open`，不能漏接 |
| `opened` | 内容插入且初始焦点处理后触发，**不是入场动画完成事件** |
| `closed` | 退场完成、原生 dialog 关闭、滚动锁释放后触发 |
| 默认插槽 | 可滚动内容 |
| `status` | 头部的可选状态 |
| `footer` | 可选固定操作区 |

`busy` 不会自动禁用业务插槽中的按钮；调用方仍须设置 `disabled`、阻止重复提交，
并决定哪些异步动作允许取消。可取消下载可用 `backdropDismissible=false`、`draggable=false`、
`busy=false`，把 `close` / `cancel` 统一接到取消下载动作。

#### 可直接起步的组件

以下示例按组件放在 `src/components/` 编写，父层按 `isCompact` 选择手机分支；桌面另提供适合的容器。

```vue
<template>
  <button type="button" aria-haspopup="dialog" :aria-expanded="open" @click="open = true">
    打开示例面板
  </button>
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
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';

const open = ref(false);
function close() {
  open.value = false;
}
</script>
```

不要在业务组件里重新实现 `dialog`、遮罩、焦点圈定、背景滚动锁和弹簧。

#### 关闭时序

- 保持外壳挂载，通过 `open=false` 触发退场；禁止 `<MobileBottomSheet v-if="open">`，
  否则会直接卸载并跳过退场。按布局使用 `v-if="isCompact"` 可以。
- 关闭请求只切换打开状态；依赖业务 payload 的标题、列表和结果应保留到 `closed`，
  避免离场时变成空壳。可缓存最后一个非空 payload，参考 `ShelfDialog.vue` / `DuplicateImportDialog.vue`。
- 导入结果清空等会改变整张卡片的动作放到 `closed`，参考 `ImportProgressSheet.vue`。
- 快速重开、关闭后马上打开下一张、组件卸载均需正确收尾；不通过额外延时模拟 `closed`。

### 7.2 阅读器抽屉

以 `ReaderSettingsDrawer.vue` 为参考，最小骨架如下：

```vue
<Transition
  enter-active-class="md-fade-enter-active"
  enter-from-class="opacity-0"
  enter-to-class="opacity-100"
  leave-active-class="md-fade-leave-active"
  leave-from-class="opacity-100"
  leave-to-class="opacity-0"
>
  <div v-if="open" class="absolute inset-0 z-40 md-scrim" @click="close"></div>
</Transition>

<Transition
  :css="false"
  @before-enter="onSheetBeforeEnter"
  @enter="onSheetEnter"
  @before-leave="onSheetBeforeLeave"
  @leave="onSheetLeave"
  @after-leave="onSheetAfterLeave"
  @leave-cancelled="onSheetLeaveCancelled"
>
  <aside
    v-if="open"
    ref="sheetRef"
    class="md-drawer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="example-sheet-title"
  >
    <ReaderDrawerHeader
      :is-compact="isCompact"
      prominent
      title="示例面板"
      title-id="example-sheet-title"
      close-label="关闭示例面板"
      @close="close"
      @drag-start="onDragStart"
      @drag-move="onDragMove"
      @drag-end="onDragEnd"
      @drag-cancel="onDragCancel"
    />
    <div class="md-drawer-body">
      <section class="md-mobile-sheet-card is-padded"><!-- 内容 --></section>
    </div>
    <div class="md-drawer-actions">
      <button type="button" class="md-filled-button">完成</button>
    </div>
  </aside>
</Transition>
```

脚本部分必须同时实例化：

```ts
const sheetSpring = useSheetSpring({ isCompact });
const {
  onBeforeEnter: onSheetBeforeEnter,
  onEnter: onSheetEnter,
  onBeforeLeave: onSheetBeforeLeave,
  onLeave: onSheetLeave,
  onAfterLeave: onSheetAfterLeave,
  onLeaveCancelled: onSheetLeaveCancelled
} = sheetSpring;
const {
  sheetRef,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel
} = useSheetDrag({
  isCompact,
  isOpen, // 当前打开状态的 Ref<boolean> / ComputedRef<boolean>
  onClose: close,
  onDragBegin: sheetSpring.cancel
});
```

`onDragBegin: sheetSpring.cancel` 不能省：拖拽开始时必须先让入场弹簧落位，否则两套位移会互相覆盖。
以上是结构片段；实际组件还需接入第 6 节的焦点、滚动锁和返回处理，不能只复制 CSS 骨架。

## 8. 验收清单

- [ ] 只使用了 `MobileBottomSheet.vue` 或 `.md-drawer` 模板，没有新增第三套 sheet。
- [ ] 手机默认 `78dvh`，允许拖动时可上拖到状态栏下方，向下拖先回默认档再关闭。
- [ ] 进出场使用 `useSheetSpring()`，拖拽使用 `useSheetDrag()`，没有固定时长 sheet transition。
- [ ] 自定义遮罩 z-40、sheet z-50；通用原生 dialog 使用 top layer，没有私有高 z-index。
- [ ] 外壳、遮罩、投影、卡片全部使用 `--md-*` token 或 `color-mix`。
- [ ] 头部固定、内容独立滚动、footer 固定并处理安全区。
- [ ] `Esc`、遮罩关闭、关闭按钮、繁忙态、焦点返回都正常。
- [ ] 打开期间背景锁定，关闭动画完成后恢复原滚动位置。
- [ ] `close` / `cancel` 都有处理；外壳保持挂载，payload 和结果在 `closed` 后才清理。
- [ ] `prefers-reduced-motion: reduce` 下直接落位，不出现卡在半途的面板。
- [ ] 390px / 899px 手机布局与 900px / 1440px 桌面对应容器无横向溢出；软键盘不遮住输入。
- [ ] 十套主题、白昼 / 夜间、跟随系统切换和纯黑夜间均无泛光、透明卡片或对比度不足；
  阅读器还需检查羊皮纸 / 护眼绿 / 跟随设置外观的相关上下文。
- [ ] 页签切换、拖动关闭、快速重开和卸载都不会遗留动画对象或滚动锁。

## 9. 维护规则与参考实现

尺寸和配色集中维护在共享头部与 `mobile-sheets.css` / `overlays.css`，
进出场和拖动参数集中维护在两个 composable。修改共享行为时同步更新本文，
并运行相关生命周期 / 拖拽测试；不要让业务组件用覆盖样式或私有参数分叉。
确需例外时在实现或评审说明中记录场景与原因，并优先扩展共享模板。

| 用途 | 文件 |
| --- | --- |
| 通用手机 sheet 外壳 | [MobileBottomSheet.vue](../src/components/MobileBottomSheet.vue) |
| 阅读器抽屉标题与拖拽条 | [ReaderDrawerHeader.vue](../src/components/ReaderDrawerHeader.vue) |
| 阅读设置 / 页签 / 卡片 | [ReaderSettingsDrawer.vue](../src/components/ReaderSettingsDrawer.vue) |
| 字体选择 sheet（保留设计） | [ReaderFontDrawer.vue](../src/components/ReaderFontDrawer.vue) |
| 目录与本目录（保留设计） | [ReaderTocDrawer.vue](../src/components/ReaderTocDrawer.vue) |
| sheet 弹簧 | [useSheetSpring.ts](../src/composables/useSheetSpring.ts) |
| 双档位拖动 | [useSheetDrag.ts](../src/composables/useSheetDrag.ts) |
| 通用 sheet 表面与列表 | [mobile-sheets.css](../src/assets/styles/mobile-sheets.css) |
| 抽屉外壳与动效 | [overlays.css](../src/assets/styles/overlays.css) |
| 模态生命周期与滚动锁回归 | [mobileBottomSheet.test.mjs](../tests/mobileBottomSheet.test.mjs) |
