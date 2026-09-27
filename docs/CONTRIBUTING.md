# HappyLocaleへのコントリビューション

HappyLocaleへのIssueやPull Requestを歓迎します。ただし個人開発のため、提案の採用時期や対応を保証するものではありません。

## 始める前に

- 不具合、改善案、実装方針の相談は、既存Issueを確認してからIssueを作成してください。
- 小さな不具合修正を除き、実装前に方針を相談すると重複作業を避けられます。
- 脆弱性は公開Issueへ書かず、[`SECURITY.md`](SECURITY.md)に従って報告してください。
- 公開・再配布できることを確認できないカード画像、PDF、フォント、翻訳文をIssueやPull Requestへ添付しないでください。私的使用が認められる素材でも、公開できるとは限りません。

## 開発環境

推奨環境はmiseです。

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

miseを使わない場合は、`package.json`と`mise.toml`で指定しているNode.jsとpnpmを用意してください。詳しくは[`README.md`](../README.md)を参照してください。

## 変更方針

- 既存のlocal-first方針を維持する
- 画像、PDF、フォント、プロジェクトデータを暗黙に外部送信しない
- 外部通信を追加・変更する場合は、送信内容、送信先、保存先をUIと文書へ明記する
- `project.json`の互換性と保存失敗時の参照整合性を優先する
- 未実装機能を実装済みとして文書化しない
- 大規模な依存追加や状態管理変更は、代替案と移行方法を先に相談する
- Prettierは追加せず、既存のESLint設定を整形基準にする

設計の背景は[`docs/architecture.md`](architecture.md)、将来計画は[`ROADMAP.md`](ROADMAP.md)を参照してください。

## テスト

ローカルでは変更箇所に関係するテストを実行し、型検査・Lintなどは変更範囲に応じて選んでください。毎回の全検査や本番ビルドは必須ではありません。検証コマンドは次のとおりです。

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm build:static
git diff --check
```

push・PR時のCIでは`test`、`typecheck`、`lint`、`build:static`を実行します。ローカルでの確認に加えてCIの結果も確認してください。ローカルコミットだけではCIは起動しません。

開発中は`mise exec -- pnpm dev`で動作を確認します。開発時のコンパイルと本番ビルドは同一ではないため、Nuxt設定・依存関係・SSR・静的生成・配信リソースなどに影響する変更やCI失敗の調査では、必要に応じて`mise exec -- pnpm build`または`mise exec -- pnpm build:static`をローカルでも実行してください。サブパス配置の確認方法は[`deployment.md`](deployment.md)を参照してください。

E2Eの成功だけで全動作を確認済みとは扱いません。変更内容に応じて`mise exec -- pnpm test:e2e`で関連するE2Eを実行し、Canvasの見た目、フォント、画像出力の品質、File System Access APIなどは[`MANUAL_TESTS.md`](MANUAL_TESTS.md)も参照して随時実機確認してください。確認したブラウザ・結果と未確認の範囲をPull Requestへ記載してください。

文書だけの変更は内容・ローカルリンク・`git diff --check`の確認を基本とし、ローカルでのアプリ全テストは不要です。

不具合修正には、可能な範囲で失敗を再現するテストを先に追加してください。検証を弱めたり、エラーを握りつぶしたりしてテストを通さないでください。

## Pull Request

Pull Requestには次を簡潔に記載してください。

- 解決する問題
- 変更した動作と変更していない動作
- 自動テストと手動確認の結果
- プライバシー、保存形式、ブラウザ互換性への影響
- 残っている制約

現在、安定版リリースや互換性保証期間は定義していません。アプリのリリース番号と`project.json`の形式バージョンは別の概念として扱います。保存形式を変更する場合は、未知バージョンの拒否と既存形式からの移行を同じ変更で用意してください。
