<div align="center">
  <img src="https://github.com/user-attachments/assets/818e7aba-f12a-49e1-8640-8852cb852b8b" width="180" alt="HOMURA" />
  <h1>HOMURA</h1>
  <p><b>本地漫画与轻小说阅读器</b></p>
  <p><i>本鱼只负责把书塞进你的本地书架：上传云端那种事，想都别想。🐳</i></p>
  <img src="https://github.com/user-attachments/assets/049e7a11-e0af-4a94-a77e-8f8c72cb50e7" width="160" alt="HOMURA 动图" />
</div>
# HOMURA — 本地漫画与轻小说阅读器

> 本鱼只负责把书塞进你的本地书架；上传云端那种事，想都别想。🐋

HOMURA是一个**本地优先**的阅读器：漫画、轻小说、PDF 和图集导入后即可阅读，解析、分页与渲染全部在本机完成，书籍内容不会上传。桌面端使用 Tauri 2 打包，同一套前端也提供 Android 构建。

- 当前版本：**2.2.5**
- 技术栈：Vue 3 + Pinia + Vite 6 + Tauri 2 + TypeScript
- 仓库：[Leon-Ning-san/HOMURA-reader](https://github.com/Leon-Ning-san/HOMURA-reader)
- 下载：[GitHub Releases](https://github.com/Leon-Ning-san/HOMURA-reader/releases)

## 项目现状

| 项目 | 当前状态 |
| --- | --- |
| 发布版本 | `2.2.5`，`package.json`、`Cargo.toml`、`tauri.conf.json` 三处版本一致 |
| 桌面平台 | macOS / Windows / Linux |
| 移动平台 | Android arm64-v8a APK |
| 核心链路 | 导入、本地存档、恢复、分页/滚动阅读、目录跳转、进度记忆、一级书库、收藏、自定义封面、导入进度与失败重试、应用内更新均可用 |
| 尚未完成 | 标签功能尚未实现；书签功能尚未实现 |
| 质量保障 | 有 `node:test` + jsdom 单元测试（224 条）与 `vue-tsc` 类型检查；没有 ESLint 或 E2E，关键阅读流程仍需手动回归 |
| 许可 | MIT，完整条款见 [`LICENSE`](LICENSE) |

## 功能概览

- **多格式书架**：EPUB / KEPUB、PDF、MOBI、TXT、Markdown 和图片文件夹。
- **一级书库与收藏**：可新建、改名、删除书库，书本可多选移入或跨库搬移；收藏页平铺展示全部收藏书。
- **两种阅读方式**：小说使用自动分页引擎；漫画支持单页、双页、首页单排和上下条漫。
- **本地进度记忆**：按书保存页码、阅读比例、方向、单双页、字号、字体、行距、页边距和条漫尺寸，重开自动续读。
- **导入进度与更新**：导入过程可取消、单本失败可重试，同名书会提示确认；应用内可检查、下载并安装新版本。
- **Material Design 3 界面**：10 套主题色、白昼 / 护眼 / 夜间三种表面，桌面与窄屏分别适配。
- **离线书库**：书籍元数据、封面、原文件与进度都保存在本机；应用不同步或上传书籍内容。

## 支持格式

| 格式 | 扩展名 | 当前能力 |
| --- | --- | --- |
| EPUB / KEPUB | `.epub`、`.kepub.epub` | 读取 OPF spine 与章节正文；图片占主导的 EPUB 会自动按漫画阅读 |
| PDF | `.pdf` | 按页懒加载并渲染为位图，保留原始版式；不支持重排或改字号，加密 PDF 暂不支持 |
| MOBI | `.mobi`、`.prc`、`.azw` | 解析 PalmDOC 容器，提取正文、封面与内嵌图片；不支持 DRM、AZW3 / KF8 和 Huffman 压缩 |
| 纯文本 / Markdown | `.txt`、`.md` | TXT 兼容 UTF-8、GBK / GB18030、带 BOM 的 UTF-16 及有明显零字节特征的无 BOM UTF-16，按常见章节标题切分；Markdown 按一级/二级标题切章并渲染常见 GFM 内容 |
| 图片文件夹 | `.jpg`、`.jpeg`、`.png`、`.webp`、`.gif`、`.avif`、`.bmp` | 按所在子文件夹分组，一组图片视为一本漫画 |

Markdown 输出会经过安全处理：原始 HTML 只作为文本显示，链接和图片仅放行相对路径与 `http`、`https`、`mailto`、`tel` 协议。

## 导入与书架

- 点击右下角「导入」选择文件或文件夹；桌面端还支持把文件、目录直接拖进窗口。
- 文件选择支持多选，一次可以连续导入多种格式。Android 的系统文件选择器只接受文件，不提供文件夹入口；iOS Safari 也不支持目录选择。
- 图片文件夹会按子目录自动拆成多本书；空书架首次启动时会放入示例漫画与示例轻小说。
- 「新建」可建立自定义一级书库；支持拖入书本、多选移入、跨库移动与移回主页。每本书只属于一个书库，删除书库会将书本放回主页，保留原文件和阅读进度。
- 书库始终排在单本前；文件夹外观显示库内排序的第一本封面及后面最多三本的薄叠影，不足的叠影以主题色补齐。
- 导入包含多本作品的文件夹时，可以选择按目录分别创建书库，逐个确认名称；深层目录也会展平为独立书库，不建立嵌套书库。在书库中导入单独文件会归入当前书库。
- 书架与收藏支持类型筛选（全部 / 漫画 / 轻小说 / 其他），PDF 及不属于漫画、小说的书归入「其他」；还支持格式筛选（EPUB / PDF / MOBI / TXT / Markdown）和三种排序（书名 / 最近添加 / 阅读进度）。默认按书名排序：数字按自然顺序排列，中文按拼音与英文字母混排。
- 主页在同一个网格中紧接排列「继续阅读 → 书库 → 小说 → 漫画 → 其他」，不显示分类标题、不按类别强制换行；同类书本沿用所选排序，PDF 放在「其他」。继续阅读也可直接返回书库内上次阅读的作品。
- 阅读器顶栏「本目录」右侧的星星可收藏 / 取消收藏本书，独立书本也支持收藏。导航中的「收藏」平铺展示所有已收藏书本（包含库内书本），支持排序、搜索和格式筛选，不显示继续阅读卡或书库；导入书籍的收藏重启后保留，示例书收藏随本次示例保留。
- 收藏页卡片的移除按钮仅取消收藏，保留原书、书库归属和阅读进度；书架中的移除按钮仍用于删除书本。继续阅读卡片会在原有左侧窄栏中裁切展示封面，并向右渐变融入背景，不改变卡片尺寸；无封面时保留文字书脊。
- 点击桌面左上角的 HOMURA 主图标可返回主页，同时退出当前书库、多选和筛选，恢复默认书名排序。
- 导入与书架中已有作品同名的书本时，会提示确认，默认跳过，也可选择「仍然导入」保留独立版本。同批次导入也会检查重名，识别时忽略英文大小写、首尾空白及全半角差异，以解析后的书名为准。
- 搜索支持书名和书库名称；界面占位文案中的作者搜索尚未实现。
- 可以单本移除或清空书架。清除应用数据会同时删除本地书架记录。
- 标签功能尚未实现（书架筛选里没有标签入口）。

## 阅读器

### 布局与操作

- 阅读方向支持左到右、右到左（日漫）和上下条漫。
- 漫画支持单页 / 双页与「首页单排」；窗口宽度小于 `768px` 时强制按单页显示。
- 小说正文可选宋体 / 黑体 / 楷体，行距与页边距各有三档；字号可在 `14–28px` 之间拖动滑块或逐级调整，只提供偶数档。每页行数随字体、字号、行距、页边距和窗口自动重新计算，长段落也会继续分页，按书保留排版与阅读进度。
- 阅读设置最下方可选择本地图片作为自定义封面，支持恢复原封面；书架、继续阅读与书库封面同步更新，导入书籍的封面重启后保留，不修改原书文件。示例书封面仅在本次打开期间保留。
- 阅读设置面板仅在内容超出可用高度时显示滚动条。
- 条漫提供完整单张、适中宽幅、超宽满屏三档尺寸。
- 翻页动画可选丝滑平移、柔和淡入和极速无动画。
- 全屏按钮默认只在 Windows 的阅读器与主页顶栏显示；其他系统可在「设置 → 调试」中强制显示。
- 阅读工具栏在无操作 2.2 秒后自动隐藏；设置抽屉或目录抽屉打开时不会自动隐藏。
- 阅读书库内作品时，顶部「本目录」按进入阅读器时的书库顺序显示所有书本，并高亮当前书本。末页继续向后翻会打开下一本首页，首页向前翻会打开上一本末页；首本和末本不循环。鼠标、触屏和键盘翻页共用此规则，单本不启用跨书阅读。
- 鼠标和触屏均支持横向跟手翻页；短点在松手时生效：画布左侧 30% 与左方向键一致，右侧 30% 与右方向键一致，中间 40% 切换工具栏。长按达到 300ms 或移动达到 8px 后不再视为点击，滑动不足翻页距离会回弹。
- 目录支持漫画页码与小说/EPUB 章节跳转；目录状态不会持久化，书签功能尚未实现。

### 主题与表面

10 套主题色：森系绿、薄荷青、海盐青、深海蓝、鸢尾紫、兰花紫（默认）、樱雾粉、落日赤陶、琥珀金、橄榄青。

三种阅读表面：白昼、护眼、夜间。护眼模式会给漫画图片叠加柔和暖色滤镜；切换背景时会同步更新原生窗口标题栏和窗口底色。

### 快捷键

| 按键 | 作用 |
| --- | --- |
| `←` / `→` | 上一页 / 下一页；右到左模式会反转翻页方向 |
| `Space` | 下一页 |
| `↑` / `↓` | 上一页 / 下一页 |
| `Esc` | 逐层退出：先关设置/目录抽屉，再唤出工具栏，最后退出阅读器 |
| `F` | 进入 / 退出全屏；桌面端走 Tauri 原生窗口 API |

条漫模式保留原生纵向滚动，不使用左右翻页快捷键。输入框获得焦点时，键盘快捷键会自动让位。

Android 端可在「设置 → 外观与阅读」里打开「音量键翻页」：音量加键上一页、音量减键下一页，默认关闭。打开抽屉或设置面板时音量键会交还系统调节音量。

## 下载与安装

到 [GitHub Releases](https://github.com/Leon-Ning-san/HOMURA-reader/releases) 下载对应安装包：

| 平台 | 发布产物 |
| --- | --- |
| macOS | `.dmg`，Universal 构建，支持 Apple Silicon 与 Intel；最低系统版本 10.15 |
| Windows | `.msi` 或 NSIS `-setup.exe` |
| Linux | 仅 `.deb` 与 `.rpm` |
| Android | `.apk`，arm64-v8a，release keystore 签名 |

> **macOS**：当前安装包没有 Apple 开发者签名与公证，首次打开可能需要右键 `HOMURA.app` →「打开」，或执行 `xattr -cr /Applications/HOMURA.app`。
>
> **Android**：安装 release APK 时需要允许「安装未知来源应用」。debug 签名版本不能与 release 版本覆盖升级，切换前请先卸载旧版。

## 从源码构建

### 环境要求

- Node.js 22+
- Rust stable ≥ 1.77.2
- 对应平台的 Tauri 2 构建依赖

macOS 需要 Xcode Command Line Tools；Windows 需要 WebView2 与 MSVC 构建工具；Linux 需要 WebKitGTK 4.1、AppIndicator、librsvg 和 patchelf。以 Ubuntu 为例：

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### 常用命令

```bash
npm install
npm run dev        # tauri dev，Tauri 会自动执行 Vite 开发前置命令
npm run build      # tauri build，Tauri 会先构建前端再打包安装包
```

| 命令 | 作用 |
| --- | --- |
| `npm test` | `node --experimental-strip-types --test tests/*.test.mjs`，224 条用例，覆盖解析、书名排序、同名识别、书库归属、目录分组和阅读手势规则 |
| `npm run typecheck` | `vue-tsc --noEmit`，类型检查（当前 0 报错） |
| `npm run dev:vite` | 只启动 Vite 开发服务器，端口固定为 `5173`，支持 HMR |
| `npm run build:vite` | `check:dark-glow` + 构建前端到 `dist/`，是最快的构建验证 |
| `npm run dev` | 启动 Tauri 开发窗口；`beforeDevCommand` 自动运行 Vite |
| `npm run build` | 构建桌面安装包；`beforeBuildCommand` 自动构建前端 |
| `npm run icons:generate` | 从 `src-tauri/app-icon.png` 母版生成各平台图标，并同步网页、启动页和已初始化的 Android 工程 |
| `npm run android:init` | 初始化 Android 工程 |
| `npm run android:dev` | 运行 Android 开发版 |
| `npm run android:build` | 构建 Android arm64 release APK，需要本地 release keystore |
| `npm run android:build:debug` | 构建 Android arm64 debug APK |
| `npm run check:dark-glow` | 扫描夜间白色泛光（`build:vite` 会自动执行） |
| `npm run tauri` | 直通 Tauri CLI |

桌面构建产物位于 `src-tauri/target/release/bundle/`。Vite 资源通过相对路径加载，不能直接双击 `dist/index.html` 以 `file://` 打开；请使用开发服务器或本地静态服务器。

`vite.config.js` 中的 PDF 资源同步插件会把 cmaps、标准字体、wasm 和 ICC 资源复制到 `public/pdfjs/`。该目录是构建产物并已加入 `.gitignore`，不要提交。

## 项目结构

```text
homura-reader/
├── index.html                  # Vite 入口，首帧前加载 homura-boot.js 恢复主题
├── vite.config.js              # Vue 插件、相对路径 base、PDF 资源同步、生产 Tailwind 预编译
├── tsconfig.json               # 类型检查配置（allowJs 渐进迁移，strict 已开）
├── AGENTS.md                   # 项目协作与实现约束（动代码前先读）
├── src/
│   ├── main.ts                 # createApp + Pinia
│   ├── App.vue                 # 总布局、侧栏/底栏骨架、书架筛选排序、FAB、离屏分页测量器
│   ├── types.ts                # Book / BookSource / ReaderPage / Collection / ReadingProgress 等核心领域类型
│   ├── assets/
│   │   ├── homura.css          # 样式入口，只有 6 行 @import
│   │   └── styles/             # tokens / base / library / overlays / controls /
│   │                           # canvas / legacy / theme-picker / content 九个模块
│   ├── stores/                 # 7 个 setup store：theme / shelf / reader / ui / settings / importProgress / updates
│   ├── services/               # 35 个：解析、存储、平台适配、原生桥接、更新（不依赖 Vue / Pinia）
│   │   ├── parsers.ts / epubParser.ts / epubType.ts   # 解析调度与漫画/小说判定
│   │   ├── pagination.ts       # 小说智能分页、章节与图片页构建
│   │   ├── pdf.ts / mobi.ts / markdown.ts / textEncoding.ts
│   │   ├── storage.ts / nativeMetadata.ts / nativeStorage.ts / opfs.ts / restore.ts / progress.ts
│   │   ├── nativeRuntime.ts / nativeArchive.ts / nativeImport.ts / coverThumb.ts
│   │   ├── collections.ts / collectionReading.ts / bookTitles.ts / shelfSections.ts
│   │   └── updates.ts / updateDownload.ts / external.ts / readerGestures.ts / archiveAccess.ts / sanitize.ts 等
│   ├── composables/            # 10 个：useImporter / useViewport / useShortcuts / useSheetDrag /
│   │                           # useShelfDialogs / useScrollBounce / useDuplicateImport /
│   │                           # useReaderBackDismiss / useAndroidBackExit / useVolumeKeys
│   └── components/             # 41 个 SFC：SideNav、LibraryHeader、BookShelf、BookCard、
│                               # ReaderModal、PaginatedView、WebtoonView、DesktopIsland、SettingsView 等
├── tests/                      # 32 个 .test.mjs（node:test + jsdom）
├── scripts/                    # check-dark-glow / generate-icons / release-notes / sync-android-icons /
│                               # patch-android-manifest
├── references/                 # MD3 组件写法、token、系统布局、桌面灵动胶囊状态机
├── src-tauri/                  # Tauri 2 壳、Rust 命令、6 个本地 Android 插件、权限与打包配置
├── public/homura-boot.js       # 首帧前的同步引导脚本（CSP 禁内联，不能挪回 index.html）
├── public/vendor/              # 开发环境运行时 Tailwind；生产构建转静态 CSS
├── design-preview/             # 设计原型与截图，不是生产代码
└── .github/workflows/          # 三平台桌面与 Android 自动构建
```

services / stores / composables 三层已全部迁移为 TypeScript（`components/` 的 `<script setup>` 也已是 `lang="ts"`）。PDF、Markdown 安全渲染和分页测量需要 DOM / Canvas，因此 `services/` 并非全部是纯逻辑模块；`stores/` 负责状态与动作，`components/` 负责视图与交互。翻页引擎 `PaginatedView.vue` 与 `WebtoonView.vue` 直接操作 DOM 和 Web Animations API，不通过 `v-for` 重渲染翻页画面。

## 本地存储与隐私

- IndexedDB 数据库名为 `homura_shelf`，包含 `books`、`sources`、`progress`、`collections` 四个对象仓库，分别保存书籍元数据/封面、原始文件来源、阅读进度以及书库与书本归属；旧书架会自动升级。
- Tauri 包会把书目、封面缩略图、书库归属与阅读进度镜像到 `$APPDATA/homura-metadata/homura.sqlite3`（WAL）。启动优先读 SQLite；首次启用或发现 `homura-native-metadata-dirty` 时，会从 IndexedDB 完整重建镜像。IndexedDB 仍是数据存在性与原始文件来源的最终兜底，SQLite 清理失败不会让已删除的书复活。
- 书架封面优先由 Rust `image` 解码并缩到最长边 480px；AVIF 等原生不支持的格式、旧安装缺少命令或非 Tauri 环境会回退 Canvas / OffscreenCanvas。原生安全上限与像素上限不会继续交给 JS 重试。
- Tauri 平台（含桌面）优先把原文件写入应用私有 AppData，容量只受磁盘剩余空间限制；桌面普通文件仍保留 `FileSystemFileHandle` 零拷贝引用，无句柄或原生写入失败才回退 OPFS 与 IndexedDB Blob。桌面 EPUB 会在解析前 staging 到 AppData，让 Rust 直接随机读取 ZIP 条目；原生失败时仍按 AppData、OPFS、句柄、Blob 逐层恢复或回退 JSZip。
- 桌面原生 ZIP 通道只接受 `homura-native-sources` 下的路径，EPUB 条目按需解到 AppCache，并按最近访问时间保留 24 个文件 / 192MB；安全限制与资源超限错误不会回退到 JSZip。
- 设置页的「存储与数据」在原生环境显示磁盘总容量、HOMURA / 其他应用 / 剩余可用三段占用，并单独列出书库原始文件与缓存、WebView 本地数据；浏览器调试环境回退到 WebView 配额估算。
- 导入后会检查存储配额；已用空间达到 85% 或剩余不足 200 MB 时会提示。
- 阅读进度写入做了 350 ms 防抖，并在关闭阅读器、页面卸载或切到后台时补写。
- 应用内更新会从 GitHub Releases 读取最新版本，下载安装包后交给系统安装；下载只校验字节数是否完整，没有签名/哈希校验，请以官方仓库发布为准。
- `localStorage` 保存主题偏好、表面模式、翻页过渡样式、阅读器默认排版、桌面侧栏折叠状态、封面缩略图迁移版本与 SQLite 镜像 dirty 标记等。
- 每本书会记住阅读方向、单双页、首页单排、字号、字体、行距、页边距和条漫尺寸；目录状态不会持久化，书签功能尚未实现。
- 应用不上传书籍内容，也没有云同步。清除应用本地数据会一起清掉书架记录，重要文件请保留原始副本。
- Google Fonts 需要联网，完全断网时会回退到系统字体；Tailwind 运行时已随应用分发，PDF 资源也随包构建。

## 已知限制

- 不支持 DRM 加密书籍、AZW3 / KF8、旧版 Huffman 压缩 MOBI 和加密 PDF。
- PDF 按固定版式渲染，不能改字号或重排；EPUB 的固定版式、复杂 CSS 和自定义字体也不能完整还原。
- 目录可以跳转，但目录状态不保存；书签功能尚未实现。
- 书架搜索只匹配书名与书库名，不支持作者搜索或标签筛选。
- macOS 安装包尚未签名/公证，首次启动需要手动放行。
- 项目提供书名排序、同名识别、书库归属、目录分组和手势判定等单元测试（`npm test`，224 条），配合 `npm run typecheck` 做类型检查；但没有 E2E、覆盖不到完整阅读流程，也没有 ESLint，改动后仍需执行构建并手动回归关键阅读流程。

## 开发与发布

开发和代码约束以仓库根目录的 [`AGENTS.md`](AGENTS.md) 为准。提交前至少运行：

```bash
npm test          # 单元测试（224 条）
npm run typecheck # vue-tsc 类型检查
npm run build:vite
```

提交信息使用 Conventional Commits：`feat:`、`fix:`、`perf:`、`refactor:`、`docs:`、`build:`、`ci:`、`chore:`。发版时需同步修改以下三处版本号：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

CI 只在推送 `v*` 标签或手动触发 `workflow_dispatch` 时运行，不响应普通 `main` 分支推送：

- **macOS**：Universal `.dmg`
- **Windows**：`.msi` / NSIS
- **Linux**：仅 `.deb` 和 `.rpm`
- **Android**：arm64-v8a release APK，使用 GitHub Secrets 中的 keystore 签名

推送版本标签会创建草稿 Release，并把桌面安装包与 APK 一并上传；手动触发只保留构建产物 14 天。Release 说明由 `scripts/release-notes.mjs` 按提交类别自动生成。

## Star 趋势

<a href="https://star-history.com/#Leon-Ning-san/HOMURA-reader&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=leon-ning-san/homura-reader&amp;type=Date&amp;theme=dark">
    <img alt="HOMURA Star 趋势图" src="https://api.star-history.com/svg?repos=leon-ning-san/homura-reader&amp;type=Date&amp;theme=light" width="800">
  </picture>
</a>

不想让本鱼饿肚子的话，顺手点个 Star 吧 🐋 图表由 [star-history.com](https://star-history.com) 实时生成，显示当前仓库的累计 Star 增长曲线。

## 反馈

发现 bug、格式兼容问题或有功能建议，请到 [Issues](https://github.com/Leon-Ning-san/HOMURA-reader/issues) 提交。反馈解析问题时可附上格式、复现步骤和必要的脱敏样本，别把带版权或隐私的原书直接扔进公开仓库。

## 许可

本项目以 **MIT License** 授权，完整条款见 [`LICENSE`](LICENSE)。

可以自由使用、修改、分发，包括商业用途，只需保留版权声明与许可声明。软件按「原样」提供，不附带任何明示或暗示的担保。

---

*README 按 v2.2.5 当前实现整理。功能状态以代码为准；本鱼写完先去吃小鱼干了。* 🐋
