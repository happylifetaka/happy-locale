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
- 性能基準計測はまだ未実施。P0全体は未完了であり、構造変更にはまだ着手しない。

性能計測は同一のブラウザ・端末・合成データ・表示倍率で行い、初回とウォーム状態を分ける。初期表示、カード切替、ドラッグ、保存差分、OCR補正の時間と、反復操作後のObject URL・画像資源・Worker・メモリを記録する。自動化結果と実フォルダ・実フォントの確認は区別する。私有素材を使う追加結果は`docs/local/`へ置く。
