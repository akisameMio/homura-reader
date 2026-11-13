<div align="center">
  <img src="https://github.com/user-attachments/assets/818e7aba-f12a-49e1-8640-8852cb852b8b" width="180" alt="HOMURA" />
  <h1>HOMURA</h1>
  <p><b>本地漫画与轻小说阅读器</b></p>
  <p><i>本鱼只负责把书塞进你的本地书架：上传云端那种事，想都别想。🐳</i></p>
  <img src="https://github.com/user-attachments/assets/049e7a11-e0af-4a94-a77e-8f8c72cb50e7" width="160" alt="HOMURA 动图" />
</div>

[简体中文](README.md) | [English](README.en.md)

> 本鱼只负责把书塞进你的本地书架；上传云端那种事，想都别想。🐋

HOMURA 是一个**本地优先**的阅读器：漫画、轻小说、PDF 和图集导入后即可阅读，解析、分页与渲染全部在本机完成，书籍内容不会上传。桌面端使用 Tauri 2 打包，同一套前端也提供 Android 构建。

- 当前版本：**2.2.7**
- 技术栈：Vue 3 + Pinia + Vite 6 + Tauri 2 + TypeScript
- 仓库：[Leon-Ning-san/HomuraReader](https://github.com/Leon-Ning-san/HomuraReader)
- 下载：[GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases)

## 特性速览

- **多格式书架**：EPUB / KEPUB、CBZ / ZIP 漫画压缩包、PDF、MOBI、TXT、Markdown 与图片文件夹。
- **一级书库与收藏**：新建 / 改名 / 删除书库，多选移入、跨库搬移，收藏页平铺展示全部收藏。
- **两种阅读方式**：小说自动分页（含竖排）与纵向滚动，漫画单页 / 双页 / 首页单排 / 上下条漫。
- **本地进度记忆**：按书保存页码、方向、单双页、字号、字体、行距、页边距与条漫尺寸，重开自动续读。
- **导入与更新**：导入可取消、失败可重试、同名提示；应用内检查、下载并安装新版本。
- **Material Design 3**：10 套主题色、白昼 / 护眼 / 夜间三种表面，桌面与窄屏分别适配。
- **离线书库**：元数据、封面、原文件与进度全在本机，不上传也不云同步。

## 支持格式

| 格式 | 扩展名 | 能力 |
| --- | --- | --- |
| EPUB / KEPUB | `.epub`、`.kepub.epub` | 读取 spine 与章节正文，图片型自动按漫画阅读 |
| CBZ / ZIP | `.cbz`、`.zip` | 图片按文件名自然序成页，原生按需解页，回退 JSZip |
| PDF | `.pdf` | 按页懒加载渲染，保留原版式，不支持重排 |
| MOBI | `.mobi`、`.prc`、`.azw` | 解析 PalmDOC，提取正文、封面与内嵌图片，不支持 DRM / AZW3 |
| 纯文本 / Markdown | `.txt`、`.md` | 多编码兼容，按章节标题切分，GFM 安全渲染 |
| 图片文件夹 | `.jpg`、`.png`、`.webp` 等 | 按子文件夹分组，每组视为一本漫画 |

## 下载安装

到 [GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases) 下载对应安装包：

| 平台 | 发布产物 |
| --- | --- |
| macOS | `.dmg`，Universal（Apple Silicon / Intel），最低 10.15 |
| Windows | `.msi` 或 NSIS `-setup.exe` |
| Linux | `.deb` 与 `.rpm` |
| Android | `.apk`，arm64-v8a / armeabi-v7a，release keystore 签名 |

> **macOS**：安装包暂未签名与公证，首次打开可能需右键「打开」，或执行 `xattr -cr /Applications/HOMURA.app`。
>
> **Android**：需允许「安装未知来源应用」。debug 与 release 签名不能互相覆盖升级，切换前请先卸载旧版。

## 快速开始

需要 Node.js 22+、Rust stable ≥ 1.77.2 及对应平台的 [Tauri 2 构建依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run dev        # tauri dev，自动执行 Vite 前置
npm run build      # tauri build，先构建前端再打包安装包
```

提交前建议运行 `npm test`（264 条单元测试）、`npm run typecheck`、`npm run build:vite`。

## 项目现状与限制

- 版本 `2.2.7`，桌面（macOS / Windows / Linux）与 Android（arm64 / armv7）均可构建；核心阅读链路完整可用。
- 标签与书签功能尚未实现；不支持 DRM、AZW3 / KF8、加密 PDF，PDF 不可重排。
- 有 264 条单元测试与类型检查，但没有 E2E、没有 ESLint，关键流程仍需手动回归。
- macOS 安装包尚未签名，首次启动需手动放行。
- 本项目以 **MIT License** 授权，条款见 [`LICENSE`](LICENSE)。

## 更多文档

- 功能细则（导入书架、阅读器、本地存储与隐私、项目结构、常用命令、开发发布等）：[`docs/features.md`](docs/features.md)
- 开发与代码约束：[`AGENTS.md`](AGENTS.md)
- Bug 与建议：[Issues](https://github.com/Leon-Ning-san/HomuraReader/issues)

## Star 趋势

<a href="https://star-history.com/#Leon-Ning-san/HomuraReader&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=dark">
    <img alt="HOMURA Star 趋势图" src="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=light" width="800">
  </picture>
</a>

不想让本鱼饿肚子的话，顺手点个 Star 吧 🐋

---

*README 按 v2.2.7 整理；详细说明见 [`docs/features.md`](docs/features.md)。功能状态以代码为准；本鱼写完先去吃小鱼干了。* 🐋
