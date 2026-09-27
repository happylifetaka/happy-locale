import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

// 同梱PNGの文字画素に約4pxの余白を付け、本文の登録アイコン全体も含めた範囲。
// 元画像を差し替えた場合は再計測する。順序はカード名・種別・補足・効果。
const textBounds = {
  '01': [[45, 69, 333, 35], [45, 122, 78, 23], [45, 152, 166, 21], [53, 617, 520, 126]],
  '02': [[45, 69, 336, 35], [45, 122, 123, 23], [44, 152, 180, 20], [53, 628, 506, 120]],
  '03': [[45, 470, 333, 35], [45, 523, 64, 23], [44, 554, 121, 18], [54, 626, 471, 117]],
  '04': [[45, 69, 333, 35], [45, 122, 64, 24], [45, 153, 74, 18], [53, 628, 382, 165]],
  '05': [[45, 69, 409, 40], [44, 122, 79, 23], [45, 153, 85, 18], [53, 627, 489, 121]],
}

/** 配布用のサンプルプロジェクトと領域候補を生成する。 */
async function main() {
  const root = new URL('../../public/sample-project/', import.meta.url)
  await mkdir(new URL('images/', root), { recursive: true })
  await mkdir(new URL('assets/', root), { recursive: true })
  const manifest = JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8'))
  const hints = {}
  const cards = []
  const assets = ['sun', 'drop'].map(name => ({ id: `sample-${name}`, name, sourceImageId: 'sample-01', sourceRect: { x: 0, y: 0, width: 40, height: 40 }, imagePath: `assets/${name}.png`, scale: 1, baselineOffset: 0, inlinePadding: 0.1 }))
  for (const sample of manifest) {
    const id = `sample-${sample.id}`
    await copyFile(new URL(`png/${sample.filename}`, import.meta.url), new URL(`images/${sample.filename}`, root))
    cards.push({ id, imageName: sample.filename, imagePath: `images/${sample.filename}`, imageWidth: 744, imageHeight: 1039, regions: [], printArea: { x: 0, y: 0, width: 744, height: 1039 }, sourceDpi: { x: 300, y: 300 } })
    const bounds = textBounds[sample.id].map(([x, y, width, height]) => ({ x, y, width, height }))
    const effectBounds = bounds[3]
    const base = { translationStatus: 'untranslated', translatedText: '', textStyles: [], inlineAssetStyles: [], backgroundMode: 'auto', autoMaskPreset: 'dark', autoMaskSensitivity: 60, removeColorOutliers: true, backgroundColor: '#fffdf4', manualMaskStrokes: [], exclusionAreas: [], textColor: '#193640', textStrokeColor: '#ffffff', textStrokeWidth: 0, fontSize: 26, autoFitFontSize: true, fontId: null, textAlign: 'left', verticalAlign: 'top' }
    const region = (index, name, text, bounds, extra = {}) => ({ ...base, id: `${id}-${index}`, regionId: `${id}-${index}`, displayName: name, originalText: text, ...bounds, ...extra, ocrLayout: index < 3 ? 'single-line' : 'text-block' })
    const icons = []
    sample.lines.forEach((line, index) => {
      let cursor = 57
      const size = /^[A-Z /]+$/.test(line) ? 22 : 23
      for (const part of line.split(/(\{sun\}|\{drop\})/)) {
        if (part.startsWith('{')) {
          const name = part.slice(1, -1)
          icons.push({ id: `${id}-icon-${icons.length}`, assetId: `sample-${name}`, x: cursor - effectBounds.x, y: 645 + index * 45 - 26 - effectBounds.y, width: 32, height: 36 })
          cursor += 34
        }
        else {
          cursor += part.length * size * 0.6
        }
      }
    })
    hints[id] = [
      region(0, 'カード名', sample.name, bounds[0]),
      region(1, '種別', sample.type, bounds[1]),
      region(2, '補足', sample.detail, bounds[2], { fontSize: 12 }),
      region(3, '効果', sample.lines.join('\n').replace(/\{(sun|drop)\}/g, '[icon:$1]'), effectBounds, { autoMaskPreset: sample.id === '05' ? 'light' : 'dark', autoMaskSensitivity: 85, backgroundColor: sample.id === '05' ? '#244b51' : '#fffdf4', textColor: sample.id === '05' ? '#ffffff' : '#193640', sourceIcons: icons, exclusionAreas: [] }),
    ]
  }
  for (const asset of assets) {
    const effect = hints['sample-01'][3]
    const icon = effect.sourceIcons.find(icon => icon.assetId === asset.id)
    asset.sourceRect = { x: effect.x + icon.x, y: effect.y + icon.y, width: icon.width, height: icon.height }
  }
  const project = { version: 3, name: 'サンプル（デモ）', demoPreset: 'sample-v1', activeCardId: cards[0].id, cards, assets, fonts: [], ocrDictionary: [], glossary: [], printSettings: { columns: 3, marginMm: 9, gapMm: 1, cutMarks: true } }
  await writeFile(new URL('project.json', root), `${JSON.stringify(project, null, 2)}\n`)
  await writeFile(new URL('demo-regions.json', import.meta.url), `${JSON.stringify(hints, null, 2)}\n`)
  process.stdout.write('Created sample project and region hints (5 cards, 2 assets, no initial regions).\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
