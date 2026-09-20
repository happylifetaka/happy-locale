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

## P1-c: 画像・プロジェクトの採用処理の抽出

`useEditorImageAdoption`へ画像の反映、最初の下書き画像の読込操作、アセット元画像、DPI読取を抽出。`useProjectAdoption`へ新規フォルダ開始・保存済み文書の採用・読込後の候補と保存署名の同期を抽出した。判定と更新の順序は維持し、loader/session/navigation/runtimeの所有関係は変更していない。

- 新規8件で、新規と既存文書の初期化、実画像寸法・カードIDでの履歴初期化、旧一時状態の解除、候補復元、下書き画像とサムネイル、アセット元画像の独立、既設定DPIの維持を確認。
- 関連10ファイル58件成功。その後に全体102ファイル689件成功。P0のOCR候補と保存文書のsnapshotは変更せず一致。
- 型検査・全体Lint・`git diff --check`成功。
- Chromiumのカード画面7件＋翻訳レビュー1件、計8件成功。
- `NUXT_APP_BASE_URL=/happy-locale-public/`の`build:static`成功。静的出力62ファイルの検査成功。
- 実フォルダ選択・実フォント・私有画像の手動検証は未実施。OCR検出アルゴリズムや保存形式は変更していない。

P3で追加監査する既存の非同期境界: DPI読取後の文書同一性、最初の画像のサムネイル作成待ち中の対象変更、新規フォルダ開始後の`nextTick`。今回の抽出では元の条件を維持しており、これらを新たに安全性確認済みとは扱わない。

## P1-d: Context公開型の明示化

`cardEditingContracts.ts`へ編集・Workspace・描画資源・OCR・翻訳の公開型を分離した。実装の`ReturnType`や除外式`Omit`をContextから外し、子に必要なAPIを列挙。Inspectorへ渡す原文アイコン確認は`open`だけに限定する。共有インスタンス、provide/injectのキー、画面のprops/eventsは変更していない。

- 公開型へ保存・履歴初期化・資源解放・候補検出が漏れないことを型テスト2件で固定。型検査でもこのテストを検査する。
- 既存Workspace・画面接続と合わせて6ファイル42件成功。型検査・対象Lint・`git diff --check`成功。
- 型の変更のみであり、E2E・静的生成・実機手動確認はこの単位では再実行していない。直前のP1-cの実行結果と区別する。

## P2-a: 1画像の検出サービスを共通化

`services/ocr/detect-regions.ts`へ全画像の前処理→英語sparse-text OCR→見出し回復・画素補正→候補生成を集約した。単体・一括は画像取得、画面進捗、結果の保存・レビューを担当する。既定倍率2・候補余白6と補正順は維持。内部指定倍率は前処理と同じ1〜4に揃え、座標復元との不一致を防ぐ。

- サービスはStoreに依存せず、画像・Providerを借りるだけで解放しない。各await後に対象有効性を確認し、古い進捗・結果・失敗を捨てる。
- 一括中止と対象破棄を区別する。中止要求では追加見出しOCRを止め、現在カードの全体OCR結果は確認用に残す。次カードは開始せず、借りたbitmapは呼出元のfinallyで閉じる。Workerを即時中断する機能は追加していない。
- 新規単体11件と画面接続1件で処理順・設定・倍率・stale各段階・資源所有・単体/一括の全候補一致を確認。関連6ファイル35件成功。
- 全体検査は倍率境界ケース2件を追加する前に105ファイル701件成功。その後、上記の関連35件を再実行。P0 snapshotは変更なし。
- 型検査・対象Lint・`git diff --check`成功。Chromiumの実ローカルOCR1件＋カード画面7件、計8件成功。合成文字3領域を認識し、Canvas/bitmap入力の全候補が一致、外部HTTPリクエストなし。
- `NUXT_APP_BASE_URL=/happy-locale-public/`の`build:static`成功、静的出力62ファイルの検査成功（既定倍率の経路）。
- 私有37画像の再解析・目視確認、保存候補型と候補生成の内部段階分割、残るルール分離は未実施。

## P2-b: 候補生成の段階分割と保存候補型の独立

公開関数`createRegionCandidates`・`splitRegionCandidate`・`cloneRegionCandidates`と既存import先を維持し、内部をnormalize/filter/headings/grouping/geometryへ分割した。行の補正・フィルタ→横結合→縦結合→枠生成・余白分離の順序と数値は維持。補正済み行の参照をWeakSetで引き継ぎ、狭い余白の判定も維持する。

保存用`RegionCandidate`・`OCRTextBlock`は`types/ocr.ts`へ移し、編集文書・Store・候補UI・保存検証はProviderの型定義を経由せず参照する。Provider側の互換exportは残し、保存version・JSONのフィールドは変更しない。

- 新規5件で、正規化・低信頼度選択・補正済み行の同一性・見出しをまたぐ結合の禁止・余白のみの重なり解消・互換型を確認。関連6ファイル93件成功。
- 直前コミットの関数本体とTypeScript ASTの整形出力を照合し、分割対象14関数の本体一致を確認。窓口の接続部分はP0 snapshotと段階テストで確認。
- 全体106ファイル708件、型検査、対象Lint、`git diff --check`成功。P0 snapshotは変更なし。
- 段階分割後のChromium実OCR E2E1件成功。Canvasとbitmapの候補が一致し、合成見出し・本文の3領域を検出。外部HTTP送信なし。
- サブパス指定`build:static`成功、静的出力62ファイルの検査成功。
- 条件の設定化・内部ポリシー整理は未完了。私有37画像の再解析や手動検証は実施していない。

## P2-c: 内部設定と組込ポリシーの選択

`RegionDetectionSettings`から候補フィルター・初期チェック、装飾除去・ラベル分類・行結合、補正済み余白、中央黒文字の測定、色付きアイコン保護トリガーを指定できるようにした。設定は呼出しごとに解決し、既定値を共有して変更しない。元の直接フィルター引数も優先指定として維持する。

- 初期チェックの閾値は行結合の前後で共用。`rows-only` / `none`、装飾・大文字分類の停止、色付き成分の`always` / `none`、黒文字の色閾値を合成データで検証。
- 細かな誤読パターン・形状ガード・OCR記号座標保護は組込ポリシー内に残した。外部入力検証・JSON・UI・保存・任意コード実行は追加していない。
- 関連6ファイル42件、全体107ファイル720件成功。P0 snapshotは変更せず一致。
- 型検査・対象ESLint・`git diff --check`成功。
- Chromiumの実ローカルOCR E2E1件成功。Canvas/bitmapの候補が一致し、合成文字3領域を検出、外部HTTP送信なし。
- `NUXT_APP_BASE_URL=/happy-locale-public/`の`build:static`成功、静的出力62ファイル検査成功。
- 私有37画像の再解析・手動確認・別ゲーム精度の評価は実施していない。

## P3-a: 保存形式の移行・検証・正規化を分離

`services/project/format.ts`を既存7 exportの窓口として維持し、内部をcodec/migrations/regions/entities/integrity/paths/valuesへ分けた。version 3・JSON項目・正規化順・書出しの末尾改行は変えない。フォルダの書込処理はこの単位では変更していない。

- 抽出した34個の関数本体・定数値を変更前のTypeScript AST出力と照合し、すべて一致。
- 新規8件で公開export、0/省略/1/2の移行、未知version拒否、複雑さ検査の優先順、入力非変更、候補を通常履歴へ含めない境界、書出し時に正規化で置換しないことを確認。
- 関連4ファイル47件、全体108ファイル728件成功。既存の保存失敗・保存中編集・カード別履歴も全体実行に含む。P0 snapshotは変更なし。
- 型検査・対象ESLint・`git diff --check`成功。
- サブパス`/happy-locale-public/`の`build:static`成功、静的出力62ファイル検査成功。
- E2E・実フォルダの手動確認はこの単位では再実行していない。保存トランザクション・非同期対象確認は引き続きP3で監査する。

## P3-b: 保存開始スナップショットと同期契約

`captureProjectSave`へ保存開始時のplain data複製・削除対象確定・書込Blob対応の控えを抽出。`useProjectPersistence`はこの固定入力を既存folder I/Oへ渡し、成功した文書だけを承認する。Blob自体は複製せず、書込中に差し替えられたものを消さない同一性照合を維持した。Store・通常履歴・候補履歴・保存承認の責務をarchitectureへ記録した。

- 新規4件で後続変更からの独立、候補の認識行・初回保存ID、Blob同一性、全カード削除防止、非有限信頼度をnullへ変換せず保存検証で拒否することを確認。
- 画面接続テストへ渡す保存文書の独立性を追加。関連6ファイル57件、全体109ファイル732件成功。画像先行・バックアップ/JSON失敗・新パス掃除・保存中編集・候補保存・カード履歴の既存テストを含む。P0 snapshot変更なし。
- 型検査・対象ESLint・`git diff --check`成功。サブパス静的生成と出力62ファイル検査成功。
- folder I/Oの書込・削除順、保存形式・UIは変更していない。実フォルダ操作・E2E・保存性能の再計測はこの単位では未実施。

## P3-c: 画像採用・DPI・サムネイルの遅延結果を破棄

P1-cで保留した非同期境界を監査し、待機中に対象が変わった場合の確認を補った。DPIは同じカードオブジェクト・フォルダ・未設定状態を再確認。下書き画像とアセット元画像は要求世代を確認し、未採用の古いURLを解放する。サムネイル登録は世代・フォルダ・呼出元の有効性を共用して確認する。

新規フォルダ／既存文書採用後の保存署名は、`nextTick`中に別の採用や画面終了があれば更新しない。サムネイル失敗時に採用済みカードのURLを解放していた経路も修正し、画像読込の成功と任意キャッシュの失敗を分けて通知する。これは構造抽出と別の不具合修正として扱う。

- 新規16件で同じIDの別文書、手動DPI、画面終了、フォルダ変更、逆順完了、サムネイル遅延/失敗、アセット元のクリア、採用世代の競合を確認。
- 関連5ファイル39件、全体110ファイル748件成功。P0 snapshotは変更なし。
- 型検査・対象ESLint・`git diff --check`成功。Chromiumカード画面E2E7件成功。
- 今回の静的生成は未実施（直前P3-bの生成成功とは区別）。実フォルダ・私有画像の手動確認も未実施。即時中断APIを追加した意味ではなく、遅れて完了した結果の採用を止める変更。

## P4-a: Canvas座標計算の共通化

座標変換・相対座標・内外判定・前面優先ヒット・ハンドル判定・矩形正規化・移動/リサイズを`features/cards/canvas/geometry.ts`へ抽出。通常領域・候補・保護領域・印刷範囲の計算を共通化した。8 CSS pxの判定許容、5画像pxの最小辺、候補のみ8方向ハンドル、確定時の丸めを維持。

- 新規23件で25〜200%の座標変換、コンテナ内への制限、8方向リサイズ、重なりの判定順、入力の非変更を確認。関連3ファイル31件、全体111ファイル771件成功。P0 snapshot変更なし。
- 新規Chromium E2E3件で50/100/150%の同じ原画像座標への作成・移動・リサイズと1操作1回のUndoを確認。既存カード画面7件と合わせて10件成功。
- 型検査・対象ESLint・`git diff --check`成功。
- サブパス`/happy-locale-public/`の静的生成と出力62ファイル検査成功。
- 描画・出力・ポインター中断の構造はこの単位では変更していない。実フォルダ・私有画像の手動確認も未実施。
