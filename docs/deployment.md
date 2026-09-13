# 静的サイトのビルドと配置

公開先に依存しない静的ファイルを生成し、`.output/public` に出力します。ビルドコマンドはアップロードやGitHubリポジトリの公開を行いません。

## ビルドする

Node.jsとpnpmを `mise.toml` のバージョンで準備します。

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build:static
```

`build:static` は次の2段階で実行します。

1. `generate:public`: Translation Endpointを無効にして静的サイトを生成
2. `verify:static`: 生成物の公開禁止ファイル、代表的な秘密情報パターン、Translation Endpointの無効化を検査

デモの候補取得は同梱データを使用します。外部Translation Endpointの無効化とは別に利用できます。

## 配置するURLを指定する

ドメイン直下に配置する場合は、既定の `/` を使います。サブディレクトリに配置する場合は、ビルド時に `NUXT_APP_BASE_URL` を指定してください。

```bash
NUXT_APP_BASE_URL=/happy-locale/ mise exec -- pnpm build:static
```

例えば `https://example.com/happy-locale/` に配置する場合の指定です。配置先が変わったときは、そのURLに合わせて再ビルドしてください。[Nuxtの配置設定](https://nuxt.com/docs/4.x/getting-started/deployment)を参照してください。

## 生成物の検査範囲

`scripts/verify-static-output.mjs` は `.output/public` 配下を検査します。

- `.env`、秘密鍵、利用者の `project.json` などの混入を拒否
- `sample-project/project.json` だけは、`public/sample-project/project.json` と内容が完全一致する場合に許可
- デモも含め、テキストファイルに代表的な秘密情報パターンがないか確認
- トップページの生成済み設定で、外部Translation Endpointが無効になっていることを確認

検査対象は静的生成物です。Git履歴、依存関係の脆弱性、素材の公開条件、実ブラウザでの動作を保証する検査ではありません。公開用サンプル自体の変更はコードレビューで確認してください。

公開先固有のファイル数・容量制限やアップロード手順は、各サービスの設定・運用で確認します。共通の検査では特定サービスの上限や `/` 固定のURLを要求しません。

## 配置する

検査済みの `.output/public` の内容を静的ホスティングへ配置します。`build:static` 自体はアップロードを行いません。

### GitHub Pages

公開先は https://happylifetaka.github.io/happy-locale/ です。

リポジトリの Settings → Pages → Build and deployment で、Sourceを「GitHub Actions」に設定します。
`.github/workflows/ci.yml` がテスト・型検査・Lint・静的生成物の検査を行い、すべて成功した場合だけ公開します。

- `main` へのpushで自動更新
- Actions画面から手動実行も可能
- Pull Requestでは検査のみ実行し、公開しない
- 公開パスはリポジトリ名から設定（このリポジトリでは `/happy-locale/`）
- 公開用の権限はデプロイジョブに限定し、外部サービスのトークンは使用しない

詳細は[GitHub PagesのカスタムWorkflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)を参照してください。
