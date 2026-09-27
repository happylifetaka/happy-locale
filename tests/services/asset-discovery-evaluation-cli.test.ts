import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/evaluate-asset-discovery.mjs', import.meta.url))
const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'icon-evaluation-test-'))
  temporary.push(directory)
  await mkdir(path.join(directory, 'docs/local'), { recursive: true })
  const bounds = { x: 10, y: 10, width: 20, height: 20 }
  const reference = { cardId: 'synthetic', imageDigest: 'a'.repeat(64), width: 100, height: 100, split: 'tuning', labelStatus: 'provisional', icons: [{ id: 'truth', bounds, semanticGroup: 'shape' }], forbiddenAreas: [] }
  const labels = { version: 1, criteria: { minimumIoU: 0.3, minimumCoverage: 0.9, maximumAreaRatio: 1.8 }, references: [reference] }
  const reports = [{ index: 1, cardId: reference.cardId, imageDigest: reference.imageDigest, width: 100, height: 100, discovery: { icons: [{ bounds }], truncated: false } }]
  await writeFile(path.join(directory, 'labels.json'), JSON.stringify(labels))
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(reports))
  await writeFile(path.join(directory, 'groups.json'), JSON.stringify({ groups: [{ memberIds: ['01:1'] }], truncated: false }))
  const run = (output = 'docs/local/result') => execFileSync(process.execPath, [script, '--labels', 'labels.json', '--report', 'report.json', '--groups', 'groups.json', '--output', output], { cwd: directory, encoding: 'utf8', stdio: 'pipe' })
  return { directory, reports, run }
}

it('writes JSON and Markdown with unreviewed/provisional status, and refuses to overwrite evidence', async () => {
  const s = await setup()
  expect(s.run()).toContain('評価結果')
  const result = JSON.parse(await readFile(path.join(s.directory, 'docs/local/result/result.json'), 'utf8'))
  expect(result.total).toMatchObject({ recall: 1, usableCrops: 0, cropsAwaitingReview: 1, provisionalImages: 1 })
  const markdown = await readFile(path.join(s.directory, 'docs/local/result/review.md'), 'utf8')
  expect(markdown).toContain('製品の精度保証や利用者の承認ではない')
  expect(markdown).toContain('対象なし')
  expect(() => s.run()).toThrow('EEXIST')
  expect(await readFile(path.join(s.directory, 'docs/local/result/review.md'), 'utf8')).toBe(markdown)
  expect(() => s.run('public/result')).toThrow('docs/local/')
})

it('rejects old reports with no content digest and mismatched source images before creating output', async () => {
  const s = await setup()
  s.reports[0]!.imageDigest = ''
  await writeFile(path.join(s.directory, 'report.json'), JSON.stringify(s.reports))
  expect(() => s.run()).toThrow('元画像')
  await expect(readFile(path.join(s.directory, 'docs/local/result/result.json'))).rejects.toThrow('ENOENT')
  s.reports[0]!.imageDigest = 'b'.repeat(64)
  await writeFile(path.join(s.directory, 'report.json'), JSON.stringify(s.reports))
  expect(() => s.run()).toThrow('元画像')
})
