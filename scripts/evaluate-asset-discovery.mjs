import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { evaluateAssetDiscovery } from './lib/asset-discovery-evaluation.ts'

const { values } = parseArgs({ options: {
  labels: { type: 'string' },
  report: { type: 'string' },
  groups: { type: 'string' },
  reviews: { type: 'string' },
  output: { type: 'string' },
} })
if (!values.labels || !values.report || !values.groups || !values.output)
  throw new Error('Usage: --labels labels.json --report report.json --groups groups.json [--reviews reviews.json] --output docs/local/new-directory')

async function readJSON(file) {
  if ((await stat(file)).size > 20 * 1024 * 1024)
    throw new Error('評価JSONの上限は20 MiBです。')
  return JSON.parse(await readFile(file, 'utf8'))
}

const labels = await readJSON(values.labels)
const reports = await readJSON(values.report)
const proposal = await readJSON(values.groups)
const cropReviews = values.reviews ? await readJSON(values.reviews) : []
if (labels.version !== 1 || !Array.isArray(reports) || !Array.isArray(proposal.groups))
  throw new Error('評価ファイルの形式・バージョンが不正です。')
const indices = new Set()
const observations = reports.map((report) => {
  if (!Number.isInteger(report.index) || report.index < 1 || indices.has(report.index) || !Array.isArray(report.discovery?.icons))
    throw new Error('検出レポートの連番・候補が不正です。')
  indices.add(report.index)
  return {
    cardId: report.cardId,
    imageDigest: report.imageDigest,
    width: report.width,
    height: report.height,
    truncated: report.discovery.truncated,
    candidates: report.discovery.icons.map((icon, index) => ({ id: `${String(report.index).padStart(2, '0')}:${index + 1}`, bounds: icon.bounds })),
  }
})
const result = evaluateAssetDiscovery({
  criteria: labels.criteria,
  references: labels.references,
  observations,
  groups: proposal.groups.map((group, index) => ({ id: `group-${index + 1}`, memberIds: group.memberIds })),
  groupingTruncated: proposal.truncated,
  cropReviews,
})

const output = path.resolve(values.output)
const privateRoot = path.resolve('docs/local')
if (!output.startsWith(`${privateRoot}${path.sep}`))
  throw new Error('出力先はdocs/local/内の新しいフォルダにしてください。')
await mkdir(privateRoot, { recursive: true })
const rootReal = await realpath(privateRoot)
const parentReal = await realpath(path.dirname(output))
if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`))
  throw new Error('出力先の親フォルダがdocs/local/の外を参照しています。')
await mkdir(output) // Existing evidence must not be overwritten.
const percent = value => value === null ? '対象なし' : `${(value * 100).toFixed(1)}%`
const escape = text => String(text).replace(/[\r\n|<>`]/g, ' ')
const lines = [
  '# アイコン抽出の数値評価',
  '',
  '正解ラベル・目視記録に基づく検証結果。製品の精度保証や利用者の承認ではない。詳細・評価基準はresult.jsonを参照。',
  '',
  '| 集合 | 画像 | 正解 | 候補 | 回収率 | 余分候補率 | 枠条件合格 | 目視込み使用可能 | 目視待ち | 仮ラベル画像 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
]
for (const [name, summary] of [['全体', result.total], ['調整用', result.tuning], ['評価用', result.evaluation]])
  lines.push(`| ${name} | ${summary.imageCount} | ${summary.truthCount} | ${summary.candidateCount} | ${percent(summary.recall)} | ${percent(summary.extraRate)} | ${summary.geometricCropPasses} | ${summary.usableCrops} (${percent(summary.usableCropRate)}) | ${summary.cropsAwaitingReview} | ${summary.provisionalImages} |`)
lines.push('', '| グループ評価 | 同一意味の回収組／正解組 | 誤統合組 | 意味未確認・未対応を含む組 |', '| --- | --- | --- | --- |')
for (const [name, summary] of [['全体', result.grouping], ['調整用', result.tuningGrouping], ['評価用', result.evaluationGrouping]])
  lines.push(`| ${name} | ${summary.correctPairs}/${summary.expectedPairs} | ${summary.wrongPairs} | ${summary.unknownPairs} |`)
lines.push('', `抽出の上限打ち切り: ${result.total.truncatedImages}画像。グループ比較の上限打ち切り: ${result.grouping.truncated ? 'あり' : 'なし'}。`, '', '| カード | 区分 | ラベル | 正解 | 候補 | 対応 | 見逃し | 余分 |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const image of result.images)
  lines.push(`| ${escape(image.cardId)} | ${image.split} | ${image.labelStatus} | ${image.truthCount} | ${image.candidateCount} | ${image.matches.length} | ${image.missed.length} | ${image.extra.length} |`)
await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
await writeFile(path.join(output, 'review.md'), `${lines.join('\n')}\n`, { flag: 'wx' })
console.log(`評価結果: ${output} (${result.total.imageCount} images)`)
