<div align="center">
  <img src="https://github.com/user-attachments/assets/818e7aba-f12a-49e1-8640-8852cb852b8b" width="180" alt="HOMURA" />
  <h1>HOMURA</h1>
  <p><b>A local manga & light-novel reader</b></p>
  <p><i>This fish only loads books into your local shelf — don't even think about uploading to the cloud. 🐳</i></p>
  <img src="https://github.com/user-attachments/assets/049e7a11-e0af-4a94-a77e-8f8c72cb50e7" width="160" alt="HOMURA animation" />
</div>

**English** | [简体中文](README.md)

> This fish only loads books into your local shelf — don't even think about uploading to the cloud. 🐋

HOMURA is a **local-first** reader: import manga, light novels, PDFs and image galleries and read them right away. Parsing, pagination and rendering all happen on your machine — book content is never uploaded. The desktop app is packaged with Tauri 2, and the same frontend also ships an Android build.

- Version: **2.2.7**
- Stack: Vue 3 + Pinia + Vite 6 + Tauri 2 + TypeScript
- Repository: [Leon-Ning-san/HomuraReader](https://github.com/Leon-Ning-san/HomuraReader)
- Download: [GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases)

## Features

- **Multi-format shelf**: EPUB / KEPUB, CBZ / ZIP manga archives, PDF, MOBI, TXT, Markdown and image folders.
- **Top-level libraries & favorites**: create / rename / delete libraries, multi-select move, cross-library transfer; the favorites page lays out all favorites flat.
- **Two reading modes**: paginated or scrolling novels (including vertical text); single-page / double-page / first-page-single / webtoon for manga.
- **Local progress memory**: per-book page, direction, single/double page, font size, typeface, line spacing, page margins and webtoon size — resume automatically.
- **Import & updates**: cancellable imports, per-book retry, duplicate-name prompts; in-app check, download and install of new versions.
- **Material Design 3**: 10 theme colors, three surfaces (light / eye-care / dark), adapted for desktop and narrow screens.
- **Offline library**: metadata, covers, original files and progress all stay local — no upload, no cloud sync.

## Supported Formats

| Format | Extensions | Capability |
| --- | --- | --- |
| EPUB / KEPUB | `.epub`, `.kepub.epub` | Reads the spine and chapter text; image-heavy books auto-read as manga |
| CBZ / ZIP | `.cbz`, `.zip` | Images ordered by natural filename into pages; native on-demand extraction, JSZip fallback |
| PDF | `.pdf` | Lazy per-page rendering, keeps original layout, no reflow |
| MOBI | `.mobi`, `.prc`, `.azw` | Parses PalmDOC, extracts text, cover and embedded images; no DRM / AZW3 |
| Plain text / Markdown | `.txt`, `.md` | Multi-encoding support, chapter split by headings, safe GFM rendering |
| Image folder | `.jpg`, `.png`, `.webp`, etc. | Grouped by subfolder, each group treated as one manga |

## Download & Install

Get the right installer from [GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases):

| Platform | Artifact |
| --- | --- |
| macOS | `.dmg`, Universal (Apple Silicon / Intel), min 10.15 |
| Windows | `.msi` or NSIS `-setup.exe` |
| Linux | `.deb` and `.rpm` |
| Android | `.apk`, arm64-v8a / armeabi-v7a, signed with release keystore |

> **macOS**: the installer is not yet signed or notarized. On first launch you may need to right-click → "Open", or run `xattr -cr /Applications/HOMURA.app`.
>
> **Android**: you must allow "Install unknown apps". Debug and release signatures cannot upgrade over each other — uninstall the old version before switching.

## Quick Start

Requires Node.js 22+, Rust stable ≥ 1.77.2, and the [Tauri 2 build prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run dev        # tauri dev, runs the Vite pre-step automatically
npm run build      # tauri build, builds the frontend then packages the installer
```

Before committing, run `npm test` (264 unit tests), `npm run typecheck`, and `npm run build:vite`.

## Status & Limitations

- Version `2.2.7`; both desktop (macOS / Windows / Linux) and Android (arm64 / armv7) are buildable, and the core reading flow is complete and usable.
- Tags and bookmarks are not implemented yet; DRM, AZW3 / KF8 and encrypted PDF are unsupported, and PDFs cannot reflow.
- 264 unit tests plus type checking, but no E2E and no ESLint — key flows still need manual regression.
- The macOS installer is unsigned, so first launch needs manual approval.
- Licensed under the **MIT License** — see [`LICENSE`](LICENSE).

## More Docs

- Detailed feature docs (import & shelf, reader, local storage & privacy, project structure, commands, dev & release): [`docs/features.md`](docs/features.md) (Chinese)
- Dev and code constraints: [`AGENTS.md`](AGENTS.md)
- Bugs & suggestions: [Issues](https://github.com/Leon-Ning-san/HomuraReader/issues)

## Star History

<a href="https://star-history.com/#Leon-Ning-san/HomuraReader&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=dark">
    <img alt="HOMURA Star History" src="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=light" width="800">
  </picture>
</a>

If you don't want this fish to go hungry, drop a Star 🐋

---

*README organized for v2.2.7; see [`docs/features.md`](docs/features.md) for details. Feature status follows the code — this fish is off to grab some dried fish now.* 🐋
