# HappyLocale 開発ガイド

## プロジェクトと参照先

HappyLocaleは、カード画像から原文を読み取り、日本語訳やアイコンを配置して画像・印刷用PDFを書き出す、ブラウザ中心の翻訳支援アプリです。

- 現在の機能・制約: [README.md](README.md)
- 責務・保存形式・通信境界: [docs/architecture.md](docs/architecture.md)
- 操作説明: [docs/user-guide.md](docs/user-guide.md)
- 手動確認: [docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md)
- 公開ビルド: [docs/deployment.md](docs/deployment.md)
- 計画・検証結果: `docs/proposals/`、`docs/verification/`

実装状況はコードと現在の検証結果で確認してください。提案書・過去の検証記録・`docs/DEVELOPMENT.md`には当時の情報が残っています。計画を実装済みとして扱わないでください。

## 開発環境とコマンド

Nuxt 4、Vue 3 Composition API、TypeScript strict、Piniaを使用します。Node.js・pnpmのバージョンは`mise.toml`と`package.json`を正とし、コマンドは原則`mise exec --`経由で実行してください。パッケージ管理はpnpm、整形は既存のESLint設定を使用します。Prettierや別のロックファイルは追加しません。

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

| 用途 | コマンド |
| --- | --- |
| 単体・コンポーネントテスト | `mise exec -- pnpm test` |
| 対象テストのみ | `mise exec -- pnpm exec vitest run tests/path/to/file.test.ts` |
| アプリ・テストの型検査 | `mise exec -- pnpm typecheck` |
| 静的解析・整形検査 | `mise exec -- pnpm lint` |
| 指定ファイルの整形修正 | `mise exec -- pnpm exec eslint path/to/file --fix` |
| 公開用静的生成と出力検査 | `mise exec -- pnpm build:static` |
| 通常のNuxtビルド | `mise exec -- pnpm build` |
| ブラウザE2E | `mise exec -- pnpm test:e2e` |

Playwrightは設定に従ってローカル開発サーバーを起動します。E2Eには対応するブラウザのインストールが必要です。

## コードの配置と状態管理

- `app/components/`: 共通UIとカード編集の部品。
- `app/features/cards/`: カード編集画面の接続・操作・コンテキスト。
- `app/features/pdf/`: PDF翻訳の実装。PDF翻訳の公開導線は現在停止中で、カードの印刷用PDF出力とは別機能です。
- `app/composables/`: 編集、保存、読込、OCR、翻訳などの操作単位の処理。
- `app/stores/`: 永続プロジェクトデータと共有する編集ツール状態。
- `app/services/`: フォルダI/O、OCR・翻訳Provider、フォント、PDFなど。
- `app/utils/`: Canvas描画、CSV照合、検証など。
- `app/types/editor.ts`: カード編集・保存データの主要な型。
- `tests/`: 単体・コンポーネント・結合・E2Eテスト。PDF機能内にも単体テストがあります。

既存の責務分割に沿って変更し、`CardEditor.vue`へ処理を集中させないでください。保存データはJSON互換に保ち、Blob、Object URL、画像、フォント、ファイルハンドルなどのブラウザ資源を永続StoreやUndoスナップショットに混ぜないでください。ブラウザAPIは機能検出し、SSR・静的生成時にアクセスしないようにします。資源解放は既存の所有者・寿命管理に合わせます。

## 維持する動作

### ローカル処理と公開版

- 画像、PDF、フォント、CSV、プロジェクト内容を暗黙に外部送信しないでください。通信を変更する場合は、送信内容・送信先とUI・文書の説明を一致させます。
- OCRのWorker・WASM・学習データは同一アプリから配信します。GitHub Pagesのサブパス配置も考慮してください。
- 公開用ビルドは外部Translation Endpointを無効化します。設定UIだけでなくリクエストの禁止も維持してください。
- Chrome内蔵翻訳は別のProviderです。初回モデル取得と端末内処理を案内し、初期化は利用者の操作から開始します。非対応時に外部サービスへ自動転送しません。
- デモ翻訳は同梱データを使います。利用者のカード画像・PDF・フォント等をテスト素材や公開コミットへ混入させないでください。

### 保存・履歴・非同期処理

- `project.json`の互換性、バックアップ、保存失敗時の参照整合性を維持してください。形式変更では既存形式からの移行と未知バージョンの拒否を扱います。
- 編集には既存の操作・Store actionを使い、Undo/Redo、未保存判定、カード切替後の内容を保ちます。UI操作と履歴のまとまりも確認してください。
- OCR・翻訳などの非同期結果はカード・領域・原文などの開始時の対象と照合し、変更済みの対象へ古い結果を適用しません。キャンセル後の遅延結果も破棄します。
- 翻訳候補は確認・適用まで既存訳を変更しません。`[icon:名前]`の保護・復元検証、数字差分、CSVのカード・領域照合を維持してください。
- Canvasの編集枠・選択表示・マスクのガイドを書き出し画像へ混入させないでください。保護領域、表示倍率、実画像座標、印刷寸法を区別します。

## 変更に応じた検証

まず変更箇所に関係する既存テストを実行します。不具合修正では、再発を検出できるテストを必要に応じて追加してください。検証を弱めたり、失敗を握りつぶしたりして通さないでください。

ローカルでは変更範囲に応じて対象テスト・型検査・Lintを選び、毎回の全検査や本番ビルドは必須にしません。push・PR時のCIで`test`、`typecheck`、`lint`、`build:static`を実行するため、その結果も確認してください。ローカルコミットだけではCIは起動しません。

開発中は`dev`で動作を確認します。ただし開発時のコンパイルと本番ビルドは同一ではないため、Nuxt設定・依存関係・SSR・静的生成・配信リソースなどに影響する変更やCI失敗の調査では、必要に応じて`build`または`build:static`をローカルでも実行してください。公開パスに関係する変更は`NUXT_APP_BASE_URL`を配置先のサブパスに設定して検証します。

E2Eの成功だけで全動作を確認済みとは扱いません。変更内容に応じて関連するE2Eを実行し、Canvasの見た目、フォント、画像出力の品質、ファイル選択・保存、ブラウザ固有APIなどは`docs/MANUAL_TESTS.md`も参照して随時実機確認してください。翻訳APIのモックテストとChrome実モデルでの確認は区別し、未確認の範囲も報告します。

文書だけの変更は、内容・ローカルリンク・`git diff --check`の確認を基本とし、アプリの全テストは不要です。生成物（`.nuxt/`、`.output/`、`dist`など）は直接編集しません。

## 文書と作業報告

- 操作や制約が変わったらREADME・利用ガイド、責務や保存形式が変わったらアーキテクチャ文書を更新してください。
- 提案書の完了チェックはコード・検証記録に基づいて更新し、実装済み、実機確認済み、公開確認済みを区別します。利用者の確認を記録するときは、その旨を明記してください。
- 変更内容、実行した検証、未確認事項を日本語で簡潔に報告してください。過去のテスト結果を今回の実行結果として扱わないでください。
- `main`へのpushはCI成功後のGitHub Pages公開につながります。コミット、push、公開反映の実施状況を区別して報告してください。
