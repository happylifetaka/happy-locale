# リファクタリングの回帰基準

開始日: 2026-09-20。対象: [ロードマップP0](../proposals/refactoring-roadmap.md)。実装の基点は`d0146b9`。

## 操作と既存テストの対応

| 保護する契約 | 主なテスト（リポジトリルートからのパス） | 限界・追加確認 |
| --- | --- | --- |
| 保存失敗後も編集・未保存画像・削除予定を保持 | `tests/components/CardEditor.persistence.test.ts` | 実フォルダでの権限拒否・容量不足は別確認 |
| 保存中の新しい編集を古い保存結果で上書きしない | 同上のsaved snapshotテスト | I/Oはモック |
| 初回保存でカードIDとUndoを維持 | 同上のfirst saveテスト | 実フォルダ操作は別確認 |
| カード切替で履歴が混ざらない、画像読込失敗時に保持 | `tests/components/CardEditor.navigation.test.ts`、`CardEditor.persistence.test.ts` | 連続操作の実ブラウザ計測は未実施 |
| OCR中の破棄・画像変更後に結果を適用しない | `tests/components/CardEditor.region-candidates.test.ts`、`CardEditor.candidate-persistence.test.ts`、`tests/services/ocr-region-image.test.ts` | 実Workerの中断性能は別問題 |
| 候補の調整・チェック・分割・保存・復元 | `tests/components/CardEditor.candidate-persistence.test.ts`、`CardEditor.region-candidates.test.ts` | OCR ProviderとCanvas画像準備はモック |
| 単体・一括検出の低信頼度候補と見出しを保存 | `tests/components/CardEditor.candidate-persistence.test.ts`のbatchパラメータ化テスト | 同一画素処理全体の一致試験はP2で追加 |
| 画像・アセット・フォントの解放 | `tests/composables/useProjectRuntime.test.ts`、`tests/components/CardEditor.navigation.test.ts` | 実メモリ推移・Worker終了は追加計測 |
| 旧形式移行・未知版拒否・参照整合性 | `tests/services/project-format.test.ts`、`project-resources.test.ts` | 全実プロジェクトの網羅を意味しない |
| 印刷配置・画像出力 | `tests/services/print-layout.test.ts`、`tests/components/CardEditor.export.test.ts`、`tests/utils/render.test.ts` | フォント・Canvasの見た目と出力は実ブラウザ確認が必要 |
| 倍率・ブラシ・Undo・画面切替 | `tests/e2e/card-editor.spec.ts` | ブラウザ自動操作。利用者の手動確認とは区別 |

## 新しい固定fixture

`tests/fixtures/refactoring-baseline.ts`は公開可能な合成データ。私有カードから文字列や座標を転記していない。

`tests/services/refactoring-baseline.test.ts`と隣接する`__snapshots__/`で次を固定する。

- 倍率2のOCR座標から原画像座標への変換。
- 名前、装飾除去された大文字見出し、2行本文、未選択ノイズの順序・外接枠・行内訳・信頼度・チェック状態。
- 信頼度0の除外、元OCR入力を変更しないこと。
- version 3の候補付き保存JSON、その読込後の内容一致と正規化済みJSON。

元データと読込後ではプロパティの順序が変わる現行仕様があるため、保存文字列は両方を固定する。正規化済み出力を再読込した場合は文字列も安定することを確認する。

これはOCRエンジン・Canvas画素解析のエンドツーエンド精度を固定するfixtureではない。画素解析は既存の合成ラスターテストと、今後のブラウザ基準計測で補完する。

通常確認:

```bash
mise exec -- pnpm exec vitest run tests/services/refactoring-baseline.test.ts
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm exec playwright test tests/e2e/card-editor.spec.ts --workers=1
```

構造整理時にsnapshotを一括更新して通してはいけない。差分は枠・文字列・信頼度・順序・保存契約ごとに確認し、意図した機能変更の場合のみ別コミットで更新する。

## 実施済みと残作業

- 変更前の全単体・コンポーネントテスト: 95ファイル667件成功（今回実行）。
- 合成fixtureの追加テスト: 2件成功。生成したsnapshotは内容を確認済み。
- アプリ・テストの型検査、追加TypeScriptのESLint、差分チェック成功。
- `tests/e2e/card-editor.spec.ts`: Chromiumで7件成功。最初の起動はsandboxのポート制約で失敗したが、権限付き再実行ではサーバー起動・全7件とも成功。
- P0の合成データ・同梱サンプルを使う自動回帰基準と性能基準を取得済み。実フォルダ・実フォント・長時間利用の品質保証は残るが、構造整理を比較する基準としてP1へ進める。

性能計測は同一のブラウザ・端末・合成データ・表示倍率で行い、初回とウォーム状態を分ける。初期表示、カード切替、ドラッグ、保存差分、OCR補正の時間と、反復操作後のObject URL・画像資源・Worker・メモリを記録する。自動化結果と実フォルダ・実フォントの確認は区別する。私有素材を使う追加結果は`docs/local/`へ置く。

## 性能基準（構造変更前）

2026-09-20、ローカル端末、Playwright Chromium 153.0.8010.12、1440×1000、カード表示50%、Nuxt dev。計測コードは`tests/performance/refactoring.spec.ts`、専用設定は`playwright.performance.config.ts`。通常の単体/E2Eとは別に明示実行する。

```bash
mise exec -- pnpm exec playwright test --config playwright.performance.config.ts
```

`test-results/performance.json`内の`baseline.json`添付に各サンプルを保存する。生成物はGit除外対象。次回のPlaywright実行で上書きされ得るため、比較用に残す場合は`docs/local/`等へ退避する。

| 計測 | 初回 | 中央値 / 再読込 | 最大 | サンプル |
| --- | ---: | ---: | ---: | --- |
| デモ表示完了 | 4,077.7ms | 再読込471.9ms | — | 2回 |
| 5カード間切替 | 126.3ms | 84.7ms | 126.3ms | 20回 |
| 領域ドラッグ（10移動イベント、毎回Undo） | 355.3ms | 310.3ms | 355.3ms | 5回 |
| 保存差分JSON作成（合成100カード×10領域） | 0.5ms | 0.3ms | 1.1ms | 100回 |
| 合成600×900画像の解析＋文字枠補正＋候補生成 | 16.5ms | 5.8ms | 16.5ms | 20回 |
| 合成画像の実Tesseract全体OCR | 219.0ms | 同Worker再実行34.7ms | — | 2回 |

注意: 表示・操作時間にはPlaywright操作・期待値待ち・2フレームの待機を含む。初回表示には開発時のモジュール処理が含まれ、本番ロード速度の指標ではない。OCRモデルのブラウザキャッシュ消去はしておらず、初回OCR値を初回ダウンロード時間とみなさない。画素補正時間には局所OCRを含めない。

資源追跡はURL、メインスレッドのImageBitmap、Worker生成/解放を計測用ラッパーで監視する。デモでは元画像はHTMLImageElementで、URL数で参照の解放を確認する。GPU・Worker内の画像数を網羅した計測ではない。

| 時点 | Object URL | ImageBitmap | Worker | GC後JS heap使用量 |
| --- | ---: | ---: | ---: | ---: |
| 切替前 | 6 | 2 | 0 | 20,224,268 bytes |
| 20回切替後 | 6 | 2 | 0 | 21,382,788 bytes |
| 合成OCR等の実行後 | 7 | 2 | 0 | 22,643,056 bytes |
| SPA遷移で画面を離れた後 | 1 | 0 | 0 | 22,336,788 bytes |

既存問題: Tesseract 7の`src/worker/browser/spawnWorker.js`はWorker用Blob URLを生成し、今回の計測ではterminate後も1件残る。アプリ画像URLは解放されている。テストではWorker由来URLを区別して1件の残存を明示的に固定した。P5で対応した際はこの基準を0へ更新する。これを「全資源の解放成功」とは扱わない。JS heapにはNuxt/Viteのキャッシュや履歴等も含まれるため、単一試行の増減だけでリークとは断定しない。

## P1-a: 候補レビュー操作の抽出

`app/features/cards/useCandidateReview.ts`へ復元・退避・確定・破棄を移した。既存の判定順・メッセージ・履歴・次カードへの進行順は維持する。親画面には生成と相互参照用の遅延委譲を残し、初期化前に別のレビューインスタンスを生成しない。

- 新しい単体4件で、作業コピーの深い独立、カードID参照、選択済みだけの確定とUndo、空選択・デモ解決エラー時の保持、破棄後の進行順を確認。
- 関連5ファイル27件成功。候補保存・一括OCR・候補編集・P0 snapshotを含む。
- Chromiumでカード画面7件と翻訳レビュー1件、計8件成功。
- 型検査・対象ESLint・`git diff --check`成功。
- `NUXT_APP_BASE_URL=/happy-locale-public/`で`build:static`成功、静的出力62ファイルの検査成功。
- 実フォルダの手動操作とP1全体の残項目は未完了。OCRアルゴリズム・保存形式・プロファイルUIは変更していない。

## P1-b: 診断・通知・ショートカットの抽出

診断ログの直近50件・詳細文字列化・consoleへの出力を`useEditorDiagnostics`へ、通知を`useEditorNotifications`へ、カードのUndo/Redoキー購読を`useEditorHistoryShortcuts`へ移した。診断の型はVueコンポーネントから独立させた。

- 表示中の通知は従来通り、各通知から4秒後に同じ文言なら消える。同文言の連続通知で期限を延長する変更は行っていない。
- 通知タイマーはスコープ終了時に全解除し、終了後の遅延通知は受け付けない。キーイベントもアンマウント時に解除する。
- 新規8件でログの独立・上限・文字列化、通知期限・破棄、キー購読・入力欄・モーダルを確認。既存の親画面接続・純粋キー判定と合わせて6ファイル30件成功。
- 型検査・対象ESLint・`git diff --check`成功。Chromiumのカード画面E2E7件成功。
- 保存形式・OCR結果・公開UIは変更していない。今回は静的生成・実フォルダ手動操作は再実行していない。
