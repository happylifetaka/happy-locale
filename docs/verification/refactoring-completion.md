# リファクタリング完了確認

2026-09-20。[ロードマップ](../proposals/refactoring-roadmap.md)のP0〜P5について、実装とローカル自動検証を完了した。基点は`d0146b9`。段階別の検証、失敗からの修正、計測値は[回帰基準](refactoring-baseline.md)を参照。

## 完了した範囲

| 段階 | 実装・根拠 |
| --- | --- |
| P0 | 公開可能な合成OCR候補・保存JSONを固定。操作別テスト対応表と実ブラウザ性能基準を作成。固定snapshotは以後変更なし |
| P1 | 候補レビュー・画像/文書採用・通知/診断/ショートカットを機能別に抽出。用途別Contextの公開型を明示 |
| P2 | 単体/一括の1画像OCR処理を共通化。候補生成段階・保存候補型・内部設定/ポリシーを分離。既定結果一致・stale破棄を検証 |
| P3 | 保存形式の移行/検証/書出し、保存開始スナップショットを分離。version 3と書込順を維持。保存失敗・並行変更・画像/DPI/サムネイルの遅延結果を検証 |
| P4 | Canvasの幾何計算・操作状態・オーバーレイ・本体描画を分離。倍率・Undo・中断・出力へのガイド非混入を単体と実ブラウザで確認 |
| P5 | 前後計測、Worker用Blob URL残留の解消、再描画依存とサムネイル参照競合の修正。公開Nuxtのサブパス・実OCR・OPFS保存再読込・外部送信無効化を確認 |

構造抽出と挙動を修正する不具合対応は分けてコミットした。依存バージョン、保存version、OCR検出の既定ルールは変更していない。性能面で実証した改善は残留URLの解消であり、構造分離やファイルの小型化を高速化の根拠にはしていない。

## 最終検証

- `mise exec -- pnpm test`: 114ファイル・816件成功。
- `mise exec -- pnpm typecheck`、`mise exec -- pnpm lint`、`git diff --check`: 成功。
- `mise exec -- pnpm exec playwright test --workers=1`: Chromium 20件成功。
- `NUXT_APP_BASE_URL=/happy-locale-public/ mise exec -- pnpm build:static`: 成功、出力62ファイル検査成功。
- `mise exec -- pnpm exec playwright test --config playwright.public.config.ts --repeat-each=3`: 公開版2件×3回、6件成功。
- `playwright.performance.config.ts`: P0/P4/修正後の測定と追加の保存/描画測定を実施。生データはGit除外対象`docs/local/refactoring/`へ保持。
- `29a4005`のP0 fixture・snapshotとの差分なし。私有37画像・専用設定・個別検証画像はコミット対象外。

## 未確認・今回の対象外

- OSのフォルダ選択、権限拒否、容量不足等の実機操作。OPFSの実ファイルAPI試験と、OSフォルダの手動試験は別物。
- 私有37画像の再解析・目視、OSフォント、実機タッチ/ペン、実プリンター、他ブラウザ、長時間・大量カードの限界。
- OCRプロファイルの外部JSON・設定UI・配布/同梱方針はP2bで別途判断。公開停止中PDF翻訳の内部再設計も対象外。
- CIの実行と公開環境での検証。今回はローカルコミットまでで、push・公開は行っていない。

この完了記録は、上記の手動確認や機能ロードマップ全体を完了扱いにするものではない。公開前には[手動確認](../MANUAL_TESTS.md)とCIを用いて必要な範囲を確認する。
