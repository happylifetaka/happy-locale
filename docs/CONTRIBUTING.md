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

Pull Requestを作る前に次を実行してください。

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm build
git diff --check
```

File System Access API、Canvas操作、フォント、画像出力に影響する変更では、[`MANUAL_TESTS.md`](MANUAL_TESTS.md)の関連項目も確認し、確認したブラウザと結果をPull Requestへ記載してください。

不具合修正には、可能な範囲で失敗を再現するテストを先に追加してください。検証を弱めたり、エラーを握りつぶしたりしてテストを通さないでください。

## Pull Request

Pull Requestには次を簡潔に記載してください。

- 解決する問題
- 変更した動作と変更していない動作
- 自動テストと手動確認の結果
- プライバシー、保存形式、ブラウザ互換性への影響
- 残っている制約

現在、安定版リリースや互換性保証期間は定義していません。アプリのリリース番号と`project.json`の形式バージョンは別の概念として扱います。保存形式を変更する場合は、未知バージョンの拒否と既存形式からの移行を同じ変更で用意してください。
