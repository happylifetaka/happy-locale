# アイコン抽出の数値評価手順

開発用の検証手順。アプリの承認・アセット登録とは別で、プロジェクトを書き換えない。私有画像、正解ラベル、結果はGit除外済みの`docs/local/`に置く。

## 正解ラベル

調整用と評価用を分け、**評価用は予測結果を見る前に**元画像からラベルを作る。本文アイコンの矩形と意味グループを元画像座標で記録する。意味が異なる色違いは別グループ、未確認の意味は`null`とする。隣接文字・数字・句読点・装飾など、含めたくない範囲も`forbiddenAreas`に記録する。禁止範囲の未記載を自動で補う処理はない。

`labels.json`の形式例。ハッシュは元画像ファイルの実際のSHA-256へ置き換える。矩形・数値は合成例であり、特定ゲームの正解や共通の合格基準ではない。

```json
{
  "version": 1,
  "criteria": { "minimumIoU": 0.3, "minimumCoverage": 0.9, "maximumAreaRatio": 1.8 },
  "references": [{
    "cardId": "synthetic-card",
    "imageDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "width": 100,
    "height": 100,
    "split": "evaluation",
    "labelStatus": "provisional",
    "icons": [{
      "id": "truth-1",
      "bounds": { "x": 10, "y": 10, "width": 20, "height": 20 },
      "semanticGroup": "symbol-a"
    }],
    "forbiddenAreas": []
  }]
}
```

- `split`: `tuning`または`evaluation`。調整へ使った画像を評価用に戻さない。
- `labelStatus`: 実装者の仮ラベルは`provisional`。利用者が確認したものだけ`user-confirmed`にする。
- アイコンなしの画像も`icons: []`で明示し、見逃しを集計から落とさない。
- `criteria`は評価集合を見る前に固定する。IoUは一対一対応の最小値、coverageは正解枠の包含率、area ratioは候補面積／正解面積の上限。

## 実行

ローカル開発サーバーで対象を限定してprobeを実行する。番号は画像パスの昇順、出力先は未使用のフォルダにする。

```bash
mise exec -- node scripts/probe-asset-discovery.mjs \
  --project /path/to/project.json \
  --indices 1,2 \
  --output docs/local/new-probe

mise exec -- node scripts/evaluate-asset-discovery.mjs \
  --labels docs/local/labels.json \
  --report docs/local/new-probe/report.json \
  --groups docs/local/new-probe/groups.json \
  --output docs/local/new-evaluation
```

probeはブラウザへ渡した画像バイト列のSHA-256を`report.json`へ記録する。ハッシュのない過去のレポートには後付けせず再実行する。ラベルとレポートの画像集合・ハッシュ・寸法が一致しない場合は評価を中止する。

評価処理は`result.json`と`review.md`を新規出力する。既存フォルダへの上書き、`docs/local/`外への出力は拒否する。画像を開いたり外部通信したりする処理はない。上限は1,000画像、各画像100正解・100候補、合計各2,000件、禁止枠は合計20,000件、入力JSONは各20 MiB。

## 指標の読み方

照合は意味グループや目視結果を使わず、対応数最大→合計IoU最大の順で一対一に割り当てる。重なりが曖昧な場合も幾何的規則で決まるため、詳細の対応を目視確認する。数値だけでは意味上の正しさを証明しない。

| 集計 | 意味 |
| --- | --- |
| 回収率 | 一対一対応できた正解数／全正解数。部分検出でも対応基準を満たすことがある |
| 余分候補率 | 対応できない候補数／全候補数。重複・小さい部分検出・未対応を詳細で区別 |
| 枠条件合格 | 包含率・面積比・禁止範囲との非重複をすべて満たす数 |
| 目視込み使用可能 | 枠条件に加え、その画像・矩形について目視の`pass`記録がある数 |
| 同一意味の回収組 | 同じ意味の正解ペアを同じグループへ回収した数。未検出の正解も分母に含む |
| 誤統合組／未確認組 | 異なる意味をまとめたペア／意味不明・未対応の候補を含むペア |

調整用・評価用は検出指標とグループ指標を別々に表示する。区分をまたぐペアは全体集計だけに含む。対象ゼロの率は`null`／「対象なし」とし、100%成功にはしない。上限打ち切りも記録する。すべて単独グループなら誤統合はゼロでも、同一意味をまとめられたことにはならない。

## 切り抜きの目視確認

任意の`reviews.json`を`--reviews`へ渡して再評価できる。候補ID、`imageDigest`、`bounds`は詳細の`candidateId`・画像ハッシュ・`candidateBounds`に対応させる。元画像や枠が変わった古い確認は拒否する。

```json
[{
  "candidateId": "01:1",
  "imageDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bounds": { "x": 10, "y": 10, "width": 20, "height": 20 },
  "verdict": "pass",
  "reviewer": "implementer"
}]
```

`verdict`は`pass`または`fail`、`reviewer`は`implementer`または`user`。実装者の結果を利用者確認へ書き換えない。確認がないものは使用可能数に加算せず、目視待ちとして報告する。仮ラベルの数値は独立精度評価や計画の利用者確認ゲート通過を意味しない。
