<div align="center">
  <img src="https://github.com/user-attachments/assets/818e7aba-f12a-49e1-8640-8852cb852b8b" width="180" alt="HOMURA" />
  <h1>HOMURA</h1>
  <p><b>ローカルファーストの漫画・ライトノベルリーダー</b></p>
  <p>
    <a href="README.md">简体中文</a> ·
    <a href="README.en.md">English</a> ·
    <a href="README.ja.md">日本語</a>
  </p>
  <p>
    <a href="https://github.com/Leon-Ning-san/HomuraReader/releases/latest">
      <img alt="最新リリース" src="https://img.shields.io/github/v/release/Leon-Ning-san/HomuraReader">
    </a>
    <a href="LICENSE">
      <img alt="ライセンス" src="https://img.shields.io/github/license/Leon-Ning-san/HomuraReader">
    </a>
    <a href="https://github.com/Leon-Ning-san/HomuraReader/releases">
      <img alt="対応プラットフォーム" src="https://img.shields.io/badge/platform-Android%20%7C%20Windows%20%7C%20macOS%20%7C%20Linux-555">
    </a>
  </p>
  <p>
    <a href="https://github.com/Leon-Ning-san/HomuraReader/stargazers">
      <sub>STAR にゃ STAR にゃ！！！🐱🐱🐱</sub>
    </a>
  </p>
  <p>
    <em>Stories are found things, like fossils in the ground.</em><br>
    <sub>物語は地面に埋もれた化石のようなもの。</sub><br>
    <sub>— Stephen William Hawking</sub>
  </p>
  <img src="https://github.com/user-attachments/assets/049e7a11-e0af-4a94-a77e-8f8c72cb50e7" width="160" alt="HOMURA アニメーション" />
</div>

> この魚は本をローカル本棚に残します。読書の進捗を端末間で共有するかは、あなた次第。🐋

## プロジェクトについて

HOMURA は**ローカルファースト**のリーダーです。漫画、ライトノベル、PDF、画像ギャラリーをインポートすればすぐに読めます。解析・ページ分割・描画はすべて端末上で完結し、書籍の内容がアップロードされることはありません。デスクトップ版は Tauri 2 でパッケージされ、同じフロントエンドが Android ビルドも提供します。

- 現在のバージョン：**2.3.3**
- 技術スタック：Vue 3 + Pinia + Vite 6 + Tauri 2 + TypeScript
- リポジトリ：[Leon-Ning-san/HomuraReader](https://github.com/Leon-Ning-san/HomuraReader)
- ダウンロード：[GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases)

## 機能概要

- **マルチフォーマット本棚**：EPUB / KEPUB、CBZ / ZIP 漫画アーカイブ、PDF、MOBI、TXT、Markdown、画像フォルダ。
- **階層コレクションとお気に入り**：コレクションの作成 / 名前変更 / 削除、サブコレクション、複数選択での移動、コレクション間の移動。お気に入りページでは全お気に入りを並べて表示。
- **2 つの読み方**：小説は自動ページ分割（縦書きを含む）と縦スクロール、漫画は単ページ / 見開き / 表紙を単独表示 / ウェブトゥーン。
- **ローカル進捗記憶**：書籍ごとにページ、方向、単ページ / 見開き、文字サイズ、フォント、行間、余白、ウェブトゥーンサイズを保存し、開き直すと自動で続きから再開。
- **インポートと更新**：デスクトップ版と Android 版でファイルやフォルダーをインポートできます。キャンセル、書籍ごとの再試行、同名ファイルの確認に対応。アプリ内で新バージョンの確認・ダウンロード・インストール。
- **Material Design 3**：10 種類のテーマカラー、ライト / アイケア / ダークの 3 サーフェス、デスクトップと狭い画面に最適化。
- **オフライン本棚**：読書と保存は端末中心。元ファイル、書籍の内容、表紙はアップロードしません。
- **任意の WebDAV 同期**：既定では無効。指定したサーバーへ進捗、お気に入り、コレクションのみを同期します。メタデータの照合には各端末で同じ元ファイルをインポートし、組版設定は端末内に保持します。WebDAV のフォルダーを閲覧し、EPUB / CBZ / ZIP / PDF / TXT / Markdown を事前保存せずにオンラインで読めます。本棚に追加したリモートの本には「クラウド」ラベルが付きます。

## 対応フォーマット

| フォーマット | 拡張子 | 機能 |
| --- | --- | --- |
| EPUB / KEPUB | `.epub`、`.kepub.epub` | spine と章の本文を読み込み、画像中心の書籍は自動で漫画として表示 |
| CBZ / ZIP | `.cbz`、`.zip` | 画像をファイル名の自然順でページ化。ネイティブで必要時に展開し、JSZip にフォールバック |
| PDF | `.pdf` | ページ単位の遅延レンダリング、元のレイアウトを維持、リフロー非対応 |
| MOBI | `.mobi`、`.prc`、`.azw` | PalmDOC を解析し、本文・表紙・埋め込み画像を抽出。DRM / AZW3 非対応 |
| プレーンテキスト / Markdown | `.txt`、`.md` | 複数エンコーディング対応、見出しで章分割、安全な GFM レンダリング |
| 画像フォルダ | `.jpg`、`.png`、`.webp` など | サブフォルダごとにグループ化し、各グループを 1 冊の漫画として扱う |

## ダウンロードとインストール

[GitHub Releases](https://github.com/Leon-Ning-san/HomuraReader/releases) から対応するインストーラーをダウンロードしてください：

| プラットフォーム | 配布物 |
| --- | --- |
| macOS | `.dmg`、Universal（Apple Silicon / Intel）、最低 10.15 |
| Windows | `.msi` または NSIS `-setup.exe` |
| Linux | `.deb` と `.rpm` |
| Android | `.apk`、arm64-v8a / armeabi-v7a、release keystore 署名 |

> **macOS**：インストーラーはまだ署名・公証されていません。初回起動時に右クリック →「開く」が必要な場合があります。または `xattr -cr /Applications/HOMURA.app` を実行してください。
>
> **Android**：「提供元不明のアプリをインストール」を許可する必要があります。debug と release の署名は相互に上書きアップデートできないため、切り替える前に旧バージョンをアンインストールしてください。

## クイックスタート

Node.js 22+、Rust stable ≥ 1.77.2、および各プラットフォームの [Tauri 2 ビルド依存関係](https://v2.tauri.app/start/prerequisites/) が必要です。

```bash
npm install
npm run dev        # tauri dev、Vite の前処理を自動実行
npm run build      # tauri build、フロントエンドをビルドしてからインストーラーをパッケージ
```

コミット前に `npm test`（ユニットテスト）、`npm run typecheck`、`npm run build:vite` の実行を推奨します。

## 現状と制限

- バージョン `2.3.3`。デスクトップ（macOS / Windows / Linux）と Android（arm64 / armv7）の両方をビルド可能で、主要な読書フローは完成しています。
- タグとブックマークは未実装。DRM、AZW3 / KF8、暗号化 PDF は非対応で、PDF はリフローできません。
- WebDAV には作成済みの HTTPS フォルダー、強い ETag、条件付き書き込みが必要です。パスワードは接続情報と端末内に保存し、接続を削除すると消去します。実際の NAS と Android 端末での同期全体は未検証です。
- ユニットテストと型チェックがありますが、E2E と ESLint はなく、主要なフローは手動で確認する必要があります。
- macOS インストーラーは未署名のため、初回起動時に手動で許可する必要があります。
- **MIT License** で公開されています。条項は [`LICENSE`](LICENSE) を参照してください。

## その他のドキュメント

- 機能詳細（インポートと本棚、リーダー、ローカルストレージとプライバシー、プロジェクト構成、コマンド、開発とリリース）：[`docs/features.md`](docs/features.md)（中国語）
- WebDAV 同期の範囲、プロトコル、サーバー要件：[`references/sync-protocol.md`](references/sync-protocol.md)（中国語）
- 開発とコード規約：[`AGENTS.md`](AGENTS.md)
- バグ報告・提案：[Issues](https://github.com/Leon-Ning-san/HomuraReader/issues)

## コントリビューター

HOMURA の開発・保守に参加いただいたすべてのコントリビューター、およびデバッグや不具合修正に協力した **Google Gemini** に感謝します。

## Star 推移

<a href="https://star-history.com/#Leon-Ning-san/HomuraReader&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=dark">
    <img alt="HOMURA Star 推移" src="https://api.star-history.com/svg?repos=leon-ning-san/HomuraReader&amp;type=Date&amp;theme=light" width="800">
  </picture>
</a>

この魚を飢えさせたくなければ、Star をぽちっと 🐋

---

*README は v2.3.3 に合わせて整理しています。詳細は [`docs/features.md`](docs/features.md) を参照してください。機能の状態はコードに準拠します。この魚は小魚のおやつを食べに行きます。* 🐋
