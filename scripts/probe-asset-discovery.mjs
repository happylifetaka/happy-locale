import { Buffer } from 'node:buffer'
// Development-only, opt-in private-image probe. Never served or bundled with the app.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'

const { values } = parseArgs({ options: {
  project: { type: 'string' },
  output: { type: 'string' },
  indices: { type: 'string' },
  url: { type: 'string', default: 'http://127.0.0.1:3000' },
} })
if (!values.project || !values.output)
  throw new Error('Usage: --project /path/project.json --output docs/local/new-directory [--indices 1,2,3]')
const base = new URL(values.url)
if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:')
  throw new Error('Only an explicit loopback development server is supported.')
const output = path.resolve(values.output)
const privateRoot = path.resolve('docs/local')
if (!output.startsWith(`${privateRoot}${path.sep}`))
  throw new Error('Output must be a new directory below docs/local/.')
const projectPath = path.resolve(values.project)
const project = JSON.parse(await readFile(projectPath, 'utf8'))
const requested = values.indices?.split(',').map(Number)
if (requested?.some(n => !Number.isInteger(n) || n < 1))
  throw new Error('Indices must be positive integers.')
const cards = project.cards.toSorted((a, b) => a.imagePath.localeCompare(b.imagePath))
if (requested?.some(n => n > cards.length))
  throw new Error('Index is outside the project.')
await mkdir(output) // Do not overwrite previous evidence.
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const reports = []
const fingerprints = []
let navigationRetries = 0
async function evaluateStable(task, argument) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await page.evaluate(task, argument)
    }
    catch (error) {
      // Vite's first import can trigger dependency optimization and a full reload.
      // Only retry a confirmed destroyed context, before writing any result for this card.
      if (attempt || !String(error).includes('Execution context was destroyed'))
        throw error
      navigationRetries++
      console.warn('Development page reloaded; retrying the interrupted read-only card analysis once.')
      await page.waitForLoadState('load')
      await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).waitFor()
    }
  }
}
try {
  // No private image may be transmitted to any external address, including by a dev page.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.origin === base.origin ? route.continue() : route.abort()
  })
  await page.goto(new URL('/cards', base).href)
  await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).waitFor()
  for (const [offset, card] of cards.entries()) {
    const index = offset + 1
    if (requested && !requested.includes(index))
      continue
    const source = path.resolve(path.dirname(projectPath), card.imagePath)
    if (!source.startsWith(`${path.dirname(projectPath)}${path.sep}`))
      throw new Error('Card path escapes its project.')
    const encoded = (await readFile(source)).toString('base64')
    const result = await evaluateStable(async ({ encoded }) => {
      const load = p => import(/* @vite-ignore */ `/_nuxt/${p}`)
      const { detectRegions } = await load('services/ocr/detect-regions.ts')
      const { discoverImageIcons } = await load('services/asset-discovery/image.ts')
      const { fingerprintImage } = await load('utils/asset-matching.ts')
      const { TesseractOCRProvider } = await load('services/ocr/tesseract.ts')
      const provider = new TesseractOCRProvider('/')
      const image = new Image()
      image.src = `data:image/png;base64,${encoded}`
      await image.decode()
      const started = performance.now()
      try {
        const detection = await detectRegions({ image, imageWidth: image.width, imageHeight: image.height, provider, isCurrent: () => true, includeMeasurements: true })
        const ocrMs = performance.now() - started
        const extractionStarted = performance.now()
        const discovery = discoverImageIcons(image, image.width, image.height, detection.measurements)
        const extractionMs = performance.now() - extractionStarted
        const samples = discovery.icons.map((icon) => {
          const f = fingerprintImage(image, icon.bounds)
          return f ? { pixels: [...f.pixels], aspect: f.aspect } : null
        })
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        ctx.lineWidth = 2
        ctx.font = 'bold 18px sans-serif'
        discovery.icons.forEach((icon, index) => {
          const b = icon.bounds
          ctx.strokeStyle = '#ff3fff'
          ctx.strokeRect(b.x, b.y, b.width, b.height)
          ctx.fillStyle = '#101020'
          ctx.fillRect(b.x, Math.max(0, b.y - 22), 35, 22)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(`${index + 1}`, b.x + 3, Math.max(18, b.y - 4))
        })
        return { discovery, measurements: detection.measurements, candidates: detection.candidates, samples, image: canvas.toDataURL('image/png').split(',')[1], width: image.width, height: image.height, ocrMs, extractionMs }
      }
      finally {
        await provider.dispose()
      }
    }, { encoded })
    const { image, samples, ...report } = result
    const name = `${String(index).padStart(2, '0')}-${path.basename(card.imagePath, path.extname(card.imagePath))}`
    await writeFile(path.join(output, `${name}.png`), Buffer.from(image, 'base64'), { flag: 'wx' })
    reports.push({ index, cardId: card.id, imagePath: card.imagePath, file: `${name}.png`, navigationRetries, ...report })
    fingerprints.push(...samples.map((fingerprint, i) => ({ id: `${String(index).padStart(2, '0')}:${i + 1}`, fingerprint })))
    // Save partial progress too; OCR of a later card must not lose completed evidence.
    await writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2))
    console.log(`${name}: ${report.discovery.icons.length} icons, ${Math.round(report.extractionMs)} ms extraction${report.discovery.truncated ? ' (truncated)' : ''}`)
  }
  const proposal = await page.evaluate(async (samples) => {
    const { proposeIconGroups } = await import(/* @vite-ignore */ '/_nuxt/services/asset-discovery/group.ts')
    return proposeIconGroups(samples.map(s => ({ ...s, fingerprint: s.fingerprint ? { ...s.fingerprint, pixels: new Float32Array(s.fingerprint.pixels) } : null })))
  }, fingerprints)
  const groups = proposal.groups
  await writeFile(path.join(output, 'groups.json'), JSON.stringify(proposal, null, 2), { flag: 'wx' })
  const table = ['# アイコン候補の試作レビュー', '', '番号は画像パスの昇順。検出結果は未承認。元プロジェクトは変更していない。', '', '| 画像 | 候補 | グループ | 判定・修正 |', '| --- | --- | --- | --- |']
  for (const report of reports) {
    for (const [i] of report.discovery.icons.entries()) {
      const id = `${String(report.index).padStart(2, '0')}:${i + 1}`
      table.push(`| [${report.index}](${report.file}) | ${i + 1} | ${groups.findIndex(g => g.memberIds.includes(id)) + 1} | 未確認 |`)
    }
  }
  await writeFile(path.join(output, 'review.md'), `${table.join('\n')}\n`, { flag: 'wx' })
}
finally {
  await browser.close()
}
