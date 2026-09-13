# HappyLocale Design Doc: Piniaによるプロジェクト状態管理の提案

最終更新: 2026-09-03
ステータス: 段階移行中（projectStoreとRuntime Cacheを採用）

> [!NOTE]
> Piniaと`projectStore`、Runtime Cacheの`useProjectRuntime`は採用済みです。表示中カードの編集状態は`useCardEditor`がカード別Undo履歴を維持し、変更のたびにStore actionへ同期します。現在の構成は[`docs/architecture.md`](architecture.md)を参照してください。

## 概要

複数カード対応で扱う状態を、次の3種類へ分離する方針を記録します。

1. **永続プロジェクト状態**: `project.json`へ保存できるデータ
2. **編集セッション状態**: 選択中の領域や編集ツールなど、保存しない一時的なUI状態
3. **ランタイムリソース**: 画像、Blob、FontFace、フォルダハンドルなど、JSON化できないブラウザ固有オブジェクト

Piniaを導入する場合は、まず永続プロジェクト状態だけをStoreへ移します。画像バイナリやブラウザ固有オブジェクトはPiniaへ格納しません。この分離により、保存形式を状態管理の基準にしつつ、コンポーネント間のprops・emitの増加を抑えます。

## 背景

永続プロジェクト文書と共有メタデータは`projectStore`が所有します。`useCardEditor`は表示中カードのカード別Undo履歴を維持し、編集・Undo・Redoの結果をカードID付きでStoreへ同期します。ブラウザ固有のランタイムリソースは`useProjectRuntime`へ分離済みです。

- 編集中の`CardProject`
- アセットとフォントのメタデータ
- 選択状態、編集モード、ズームなどのUI状態

現在はカード一覧、カード切り替え、遅延ロードまで`CardEditor.vue`を調整役として実装しています。`FolderProjectDocument`、表示中カードの最新編集結果、アセット・フォント参照、OCR辞書、用語集は`projectStore`へ移行し、画像、Blob、FontFace、フォルダハンドルの所有と解放は`useProjectRuntime`へ集約しました。`useCardEditor`には現在値を永続化せず、カード別履歴と選択状態を編集セッションとして保持します。

## 目的

- `project.json`とアプリ内の永続状態を同じデータモデルにする
- 複数画面・コンポーネントからカード、領域、アセット、フォント参照を安全に更新する
- 表示中のカード画像だけを読み込める構造にする
- Undo / Redoをカード単位で分離する
- JSON化できない値をプロジェクト保存や履歴へ混入させない
- 現行機能を一括で書き換えず、段階的に移行する

## 対象外

- Piniaによる画像バイナリの管理
- Pinia DevtoolsをアプリのUndo / Redoとして利用すること
- プロジェクトデータのサーバー保存や同期
- IndexedDBへのフォルダハンドル永続化
- 複数ユーザー間の共同編集
- 必要性を確認する前の全面的な状態管理移行

## 状態の分類

### 1. 永続プロジェクト状態

JSONとして安全に複製でき、`project.json`へ保存するデータです。移行する場合はPiniaの`projectStore`が管理します。

```ts
interface FolderProjectDocument {
  version: 2
  name: string
  activeCardId: string
  cards: FolderProjectCard[]
  assets: ImageAsset[]
  fonts: FontReference[]
  ocrDictionary: OCRDictionaryEntry[]
  glossary: GlossaryEntry[]
  printSettings: PrintLayoutSettings
}
```

含めるもの:

- プロジェクト名と形式バージョン
- カードID、表示名、画像の相対パスと寸法
- 翻訳領域、保護領域、手動マスクの座標
- 原文、訳文、背景処理、文字描画設定
- アセット名、画像の相対パス、倍率、ベースライン位置
- フォントID、表示名、family名、元ファイル名
- OCRユーザー辞書の置換前文字列と置換後文字列
- 保存時に開いていたカードID
- カードごとの印刷範囲・元画像DPIと、A4面付け設定

原則として、`structuredClone()`と`JSON.stringify()`の両方に成功する値だけを格納します。

### 2. 編集セッション状態

画面を操作するための一時的な状態です。初期移行では既存のComposableまたは画面コンポーネントに残します。

- 選択中の領域・保護領域・アセット
- カード編集／アセット編集の表示モード
- ズーム倍率
- ドラッグ中の矩形やブラシストローク
- アコーディオンの開閉状態
- 診断ログ
- ファイル選択ダイアログの処理状態

複数の離れた画面から同じ状態を操作する必要が生じた場合だけ、将来`editorSessionStore`へ移します。ただし、このStoreもJSON互換の値に限定します。

### 3. ランタイムリソース

ブラウザの実行中だけ有効で、保存・履歴・Piniaの対象にしない値です。

- `HTMLImageElement`
- `ImageBitmap`
- `Blob` / `File`
- Object URL
- `FontFace`
- `CanvasRenderingContext2D`
- `FileSystemDirectoryHandle`

これらは`useProjectRuntime()`のような専用Composableまたはサービスで管理します。

```ts
interface ProjectRuntime {
  directory: ShallowRef<FileSystemDirectoryHandle | null>
  cardImages: ShallowRef<Map<string, HTMLImageElement>>
  assetImages: ShallowRef<Map<string, CanvasImageSource>>
  pendingAssetWrites: ShallowRef<Map<string, Blob>>
  loadedFonts: ShallowRef<Map<string, FontFace>>
}
```

Vueの深いリアクティブ変換は不要なため、`shallowRef`と`Map`を使います。StoreのIDとRuntime Cacheのキーを対応させ、オブジェクトそのものを永続状態から参照しません。

既存アセットは読み込み時に`ImageBitmap`へデコードし、元の`File`を保存時の書き込み元として再利用しません。`pendingAssetWrites`には新規作成したPNGだけを保持し、保存成功後に空にします。同じローカルファイルを読み書きの両方に使うと、上書き後の古い`File`参照によって次回保存のWritableStreamが失敗するためです。

## 提案アーキテクチャ

```text
project.json / images / assets
              |
              v
       project format service
       parse / normalize / serialize
              |
              v
        Pinia projectStore
    JSON互換の正規データを保持
       |                 |
       v                 v
 editor composables   save service
       |
       v
 useProjectRuntime
 画像・Blob・FontFace・DirectoryHandle
       |
       v
   Canvas renderer
```

### `projectStore`

`FolderProjectDocument`を正規データとして保持します。

想定する責務:

- 新規プロジェクトの作成
- 読み込んだドキュメントの置換
- カードの追加・削除・並べ替え・選択
- 領域の追加・更新・削除
- アセットとフォント参照の更新
- 現在のカードや領域を取得するgetter
- 保存対象となるスナップショットの生成

コンポーネントから配列を直接変更せず、ドメイン操作を表すactionを経由します。

```ts
const project = useProjectStore()

project.updateRegion(cardId, regionId, {
  translatedText: 'カードを2枚引く。',
})
```

Storeには画像ロード、Canvas描画、ファイルダイアログ、Object URLの生成を実装しません。

### `useProjectRuntime`

永続データのIDと、ブラウザで利用する実体を対応づけます。

想定する責務:

- カード画像とアセット画像の遅延ロード
- 読み込み中Promiseの重複排除
- Object URLの作成と`URL.revokeObjectURL()`
- FontFaceの登録と未読込フォントの検出
- 現在のプロジェクトフォルダハンドルの保持
- カード切り替え時やプロジェクト終了時の解放

Runtime Cacheにデータがないことは異常ではありません。必要な画像を相対パスから再読込できる設計にします。

### 既存サービスとの境界

- `services/project/format.ts`: 信頼できないJSONの検証、既定値補完、バージョン移行
- `services/project/folder.ts`: File System Access APIによるファイル入出力
- `projectStore`: 検証済みドメイン状態と同期的な更新
- `useProjectRuntime`: ブラウザリソースのロード・解放
- Canvas utils: 渡された画像と設定から描画し、Storeやファイルシステムを直接参照しない

## データの所有権

同じデータを`CardEditor.vue`とPiniaの両方に持たせません。移行後は次を唯一の正として扱います。

| データ | 所有者 |
| --- | --- |
| カード・領域・アセット・フォント参照 | `projectStore` |
| 画像・Blob・FontFace | `useProjectRuntime` |
| Undo / Redoスナップショット | `useCardHistory` |
| ポインター操作中の一時値 | 操作対象コンポーネント |
| 読み書き中の状態・エラー | 呼び出し元Composable |

## データの所有範囲と参照整合性

データの保存場所だけでなく、変更時にどの範囲を同期する必要があるかを設計上の不変条件として扱います。新しい編集機能を追加するときは、次の表を基準に更新対象とテスト範囲を決めます。

| データ | 所有範囲 | 更新時に守ること | 典型的な不具合・テスト観点 |
| --- | --- | --- | --- |
| カード画像・翻訳領域 | カード単位 | カード切り替え前に編集中の状態をプロジェクトへ同期する | 切り替えて戻ったときに領域や訳文が消えないこと |
| アセット本体 | プロジェクト共通 | 描画用`ImageBitmap`と未保存の新規Blobを分離し、すべてのカードから同じID・名前を参照する | カードごとにアセットが複製されないこと、保存済みFileを同じパスへ再書き込みしないこと |
| インラインアセット参照 | 各カードの翻訳文 | 共有アセットの名前を変更したら、非表示・削除予定を含む全カードの`[icon:name]`を更新する | 別カードへ切り替えたり削除を復元したりしても、改名前のトークンや参照切れが残らないこと |
| OCRユーザー辞書 | プロジェクト共通 | カード切り替えでは初期化せず、保存・再読込でも共通辞書を維持する | あるカードで追加した補正が別カードでも利用できること |
| フォント参照 | プロジェクト共通 | メタデータだけを保存し、フォントファイルはランタイムでユーザーに再選択してもらう | 別カードの領域から同じフォント参照を利用でき、未読込時に案内できること |
| Undo / Redo履歴 | カード単位 | カードIDごとに履歴を分離し、別カードの操作を混在させない | Undoで別カードの領域が変更されないこと |
| カードの削除予定 | 編集セッション単位 | カード本体はプロジェクト配列へ残し、削除予定IDだけを保持する。明示保存までは永続データと画像ファイルを変更しない | 一覧の元位置でのゴースト表示、個別取消、アクティブカード削除後の隣接カード選択、最後の1枚の保護 |
| Blob・Object URL・ImageBitmap | 実行時のみ | `project.json`へ保存せず、置換・削除・プロジェクト終了時に解放する | カードを繰り返し切り替えても不要な画像実体が増え続けないこと |

### 共有データとカード内参照

共有データそのものがプロジェクトに一つだけ存在していても、その参照は各カードに分散することがあります。アセットが代表例です。

```text
FolderProjectDocument.assets（共有アセット本体）
                 |
                 +-- card A: 「[icon:coin]を得る」
                 +-- card B: 「[icon:coin]を支払う」
```

このため、共有データの識別子や名前を変更する操作は、現在表示しているカードだけで完結させません。参照を持つ全カードへ更新を適用し、複数カードを含む単体テストを追加します。

今後、表示名と参照キーを分離できるデータでは、ユーザー向けの名前変更で参照を書き換えなくてよいよう、変更されない内部IDによる参照を優先します。既存の`[icon:name]`形式を変更する場合は、プロジェクト形式の移行処理と後方互換性を同時に設計します。

## Undo / Redo

Pinia自体をUndo / Redo機構としては使いません。現在の`useHistory`と同様に、JSON互換のカード編集状態だけをスナップショット化します。

現在のComposable実装と同様に、Piniaへ移行する場合もカードIDごとに分けた履歴を維持します。

```ts
type CardHistoryRegistry = Map<string, CardHistory>

interface CardHistory {
  past: CardProject[]
  future: CardProject[]
}
```

方針:

- カード切り替えでは履歴を混ぜない
- ポインター移動中は履歴を作らず、操作完了時に1件追加する
- 画像、Blob、FontFace、選択状態は履歴へ含めない
- カード削除時は対応する履歴も破棄する
- プロジェクトを開き直した時は全履歴を初期化する
- 履歴の上限は現在と同じくカードごとに100件を初期値とする

Store actionと履歴更新の順序が分散しないよう、編集操作用Composableが「変更前を履歴へ保存してからStore actionを呼ぶ」境界を提供します。

## 読み込みフロー

1. ユーザーがプロジェクトフォルダを選択する
2. `folder.ts`が`project.json`を読む
3. `format.ts`がJSONを検証・正規化する
4. `projectStore.replaceProject()`で永続状態を置換する
5. Runtimeへフォルダハンドルを登録する
6. `activeCardId`の画像だけを読み込む
7. 使用フォントが未ロードなら再選択を案内する
8. カードを切り替えた時に、そのカード画像を遅延ロードする

途中で失敗した場合、既存Storeを半端な状態に置換しません。JSON検証と必須ファイルの確認が成功してから切り替えます。

## 保存フロー

1. 編集中のポインター操作を確定する
2. `projectStore.toDocument()`からJSON互換スナップショットを取得する
3. `serializeFolderProject()`で`project.json`を生成する
4. 新規・変更された元画像と透過済みアセットBlobを書き込む
5. 一時ファイルまたはバックアップを利用して`project.json`を更新する
6. `project.json`の更新成功後に、削除予定カードの元画像を削除する
7. 成功後に未保存状態と削除予定を解除する

Runtime CacheのオブジェクトをJSONへ混ぜず、ファイルには相対パスだけを記録します。
カード画像は参照を残したまま先に削除するとプロジェクトを開けなくなるため、必ずJSON更新後に削除します。画像削除だけが失敗した場合は未参照ファイルが残りますが、プロジェクトの参照整合性を優先します。

## メモリ管理

Pinia導入そのものはメモリ使用量を減らしません。画像実体の保持方法が主な対策です。

- 原則として表示中のカード画像だけをデコードする
- 切り替え直後のカードを少数だけLRUキャッシュする方式を検討する
- アセット画像は描画時に遅延ロードし、同じIDのロードを共有する
- Object URLを置換・削除・プロジェクト終了時にrevokeする
- カード削除時に画像キャッシュとUndo履歴を同時に破棄する
- 将来、実画像を用いてカード枚数ごとの使用メモリを計測してからキャッシュ上限を決める

JSON状態にも手動マスク座標などが含まれるため、無制限には増やしません。履歴はカードごとの上限に加え、必要ならプロジェクト全体の概算サイズ上限を設けます。

## SSRとlocal-first

HappyLocaleはブラウザ内編集が中心です。サーバーレンダリング時には空の初期Storeを作り、File System Access API、FontFace、Canvas、画像デコードはクライアントでだけ実行します。

PiniaのSSRシリアライズ機能を、画像やフォントの転送には利用しません。永続化先は引き続きユーザーが明示的に選択したローカルフォルダだけとし、外部サーバーへの同期機能は追加しません。

## 段階的な移行計画

### Step 1: 導入とStoreの骨格（2026-09-03完了）

- `pinia`と`@pinia/nuxt`を追加する
- Nuxt moduleを設定する
- `projectStore`と単体テストを作る
- 現在の`FolderProjectDocument`をStoreの初期データモデルとして再利用する

### Step 2: プロジェクト読込・保存を移す（2026-09-03完了）

- 読込結果を`projectStore`へ反映する
- 保存元を`projectStore`のスナップショットへ変更する
- 既存のversion 1形式からversion 2への移行と、version 2形式の往復互換性をテストする

### Step 3: カード編集状態を移す（2026-09-03完了）

- `useCardEditor`をStore actionと履歴を調停するComposableへ変更する
- 領域・保護領域・マスク更新をStore action経由にする
- `CardEditor.vue`に残った重複状態を削除する

### Step 4: Runtime Cacheを分離する（2026-09-03完了）

- 画像、アセットBlob、FontFace、DirectoryHandleを`useProjectRuntime`へ移す
- カード切り替え時の遅延ロードと解放を実装する
- Object URLの解放をテストまたは診断ログで確認する

### Step 5: 複数カードUIを接続する

- カード一覧、追加、削除、並べ替えを実装する
- カード別履歴を維持したまま接続する
- 未保存状態とロード状態を表示する

各Stepの終了時にlint、typecheck、unit test、buildを実行し、カード編集・アセット編集・保存再読込の手動確認を行います。

## テスト方針

### Store単体テスト

- プロジェクト置換で古い状態が残らない
- カード切り替えで`activeCardId`が正しく更新される
- 領域更新で別カードを変更しない
- カード削除時のactive card選択が決定的である
- アセット名変更で全カードのトークンが更新される
- StoreのスナップショットをJSONで往復できる

### Runtime単体テスト

- 同じ画像の同時ロードが1回にまとめられる
- 置換・削除時にObject URLがrevokeされる
- 未ロードフォントを正しく列挙する
- Runtimeの初期化で前プロジェクトのキャッシュが残らない

### 結合テスト

- version 1プロジェクトを開いてversion 2で保存しても既存情報が失われない
- カードを切り替えても領域とUndo履歴が混ざらない
- アセットとカスタムフォントがプレビューと書き出しへ反映される
- 保存失敗時に現在の編集状態を失わない

## リスクと対策

### Storeと履歴が二重の正になる

履歴は過去・未来のスナップショットだけを保持し、現在値は常にStoreを正とします。編集更新の入口をComposableへ集約します。

### JSON互換でない値がStoreへ混入する

Storeの型を`FolderProjectDocument`系に限定し、Blob等を受け取るactionを作りません。開発時にはStoreスナップショットのJSON往復テストを追加します。

### 移行中に状態が二重管理される

機能単位で所有者を切り替え、同じデータを両方へ同期する期間を作りません。各Stepで旧状態を削除してから次へ進みます。

### Piniaへの依存が複雑さを増やす

Storeは永続ドメイン状態に限定し、Canvas処理やブラウザAPIを持ち込みません。単一コンポーネント内だけで完結する一時状態は従来どおりローカルに保ちます。

## 導入判断

Piniaは現在のMVPと複数カードUIを成立させるための必須依存ではありません。`FolderProjectDocument`の共有と副作用の調整が現行構成では保守しにくくなった場合に導入を検討します。

導入条件は次のとおりです。

- カード一覧と編集画面の共有状態がさらに増える
- 既存のカード別履歴をStore actionと接続する
- `CardEditor.vue`を状態の唯一の中継点にし続けることが保守上の負担になる

この条件を満たすまでは、現在のComposable構成を維持します。
