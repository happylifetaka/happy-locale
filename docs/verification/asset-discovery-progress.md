# アイコン一括抽出の実装・検証記録

2026-09-20。[計画](../proposals/batch-asset-discovery.md)に沿った進行中の記録。全体の完了・公開反映を示さない。

## P0 / P1a: 抽出・グループ化の試作

実装したもの:

- `detectRegions` の明示オプションで、手動調整・領域補正前の実測行・単語を元画像座標へ戻した独立コピーを取得する。既定出力と保存候補の形式は変えない。
- 本文らしい実測行の近傍で色・明暗成分を探索。文字画素から高さ・中心を補正し、単語、装飾線、画像上部のイラストの混入を抑制する。
- 色成分だけで切り抜きが欠ける場合は明暗の輪郭を併用する。小さな切れ目の補完・重複排除を行うが、複雑な多色アイコンの全体検出は未解決例がある。
- 作業Canvasを最大辺1,400px、探索を既定200万画素・100候補に制限。上限で打ち切った結果を明示する。
- 色差の追加ガードと全メンバー間の一致を使う保守的なグループ提案。連鎖的な統合を避け、比較上限以降は単独候補を残して打ち切りを通知する。
- 明示したローカルプロジェクトを読む開発用 `scripts/probe-asset-discovery.mjs`。結果は新規の `docs/local/` 配下だけへ出力する。元プロジェクトは変更しない。ブラウザ通信は指定したloopback origin以外を拒否する。
- [保存・承認・再検出の実装契約](../proposals/asset-discovery-contract.md)。保存version 4への移行は方針を確定しただけで、まだ実装していない。

今回確認した範囲:

- 対象単体テスト5ファイル72件成功（抽出・グループ・OCR接続・既存候補・既存出力基準・指紋）。
- アプリ・テストの型検査成功。
- 実Chromium＋ローカルTesseractの合成画像で、色付き／灰色アイコンと拡大画像の元座標復元を確認。従来の領域検出E2Eと合わせて2件成功。
- 私有の調整用4画像で新しい全体OCRから抽出まで実行し、枠付きPNG・OCR実測値・時間・グループ案をローカルに記録した。これは独立した評価用画像での精度測定ではない。
- 初回の実OCR試験で単語の高さが行全体まで広がるケースを発見し、文字画素から高さを求める修正と合成回帰テストを追加した。
- 開発サーバーの再読込によるコンテキスト破棄も発生した。コード変更を止めた再実行でE2Eを確認。開発用probeだけは、この明確な中断に限り1度再試行し、回数を成果物へ記録する。一般の認識失敗は握りつぶさない。

未完了:

- 多色・暗い輪郭の切り抜き精度と、実画像の類似グループ化。保守的すぎて同じアイコンが別グループになる例を含む。
- 利用者による代表出力の確認。確認用の場所は会話で共有し、私有の画像名・文章・正解座標をこの公開文書へ転載しない。
- 独立した評価用画像の正解付け、手動操作数・確認時間の測定、37枚全体の確認。
- 候補保存・移行、レビューUI、アセット登録への接続、仮データ再OCR、既存領域との差分確認。アプリの通常操作にはまだ新機能を接続していない。
- 今回の変更に対するCI・公開環境の検証。pushしていない。

再現方法（私有画像は利用者のローカル環境だけで指定）:

```bash
mise exec -- pnpm dev --host 127.0.0.1 --port 3000
mise exec -- node scripts/probe-asset-discovery.mjs --project /path/to/project.json --output docs/local/new-probe-directory --indices 1,2,3
mise exec -- pnpm exec vitest run tests/services/asset-discovery.test.ts tests/services/ocr-detect-regions.test.ts tests/services/refactoring-baseline.test.ts tests/services/ocr-candidates.test.ts tests/utils/asset-matching.test.ts
mise exec -- pnpm exec playwright test tests/e2e/asset-discovery.spec.ts tests/e2e/region-detection.spec.ts --workers=1
```

probeの連番は画像パスの昇順。上限・出現候補と探索矩形は `report.json`、グループと比較上限は `groups.json`、判定欄付き一覧は `review.md` に出力する。既存出力ディレクトリには上書きしない。
