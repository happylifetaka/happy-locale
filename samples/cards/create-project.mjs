import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'

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
  const titleY = sample.id === '03' ? 500 : 99
  const base = { translationStatus: 'untranslated', translatedText: '', textStyles: [], inlineAssetStyles: [], backgroundMode: 'auto', autoMaskPreset: 'dark', autoMaskSensitivity: 60, removeColorOutliers: true, backgroundColor: '#fffdf4', manualMaskStrokes: [], exclusionAreas: [], textColor: '#193640', textStrokeColor: '#ffffff', textStrokeWidth: 0, fontSize: 26, autoFitFontSize: true, fontId: null, textAlign: 'left', verticalAlign: 'top' }
  const region = (index, name, text, bounds, extra = {}) => ({ ...base, id: `${id}-${index}`, regionId: `${id}-${index}`, displayName: name, originalText: text, ...bounds, ...extra, ocrLayout: index < 3 ? 'single-line' : 'text-block' })
  const icons = []
  sample.lines.forEach((line, index) => {
    let cursor = 57
    const size = /^[A-Z /]+$/.test(line) ? 22 : 23
    for (const part of line.split(/(\{sun\}|\{drop\})/)) {
      if (part.startsWith('{')) {
        const name = part.slice(1, -1)
        icons.push({ id: `${id}-icon-${icons.length}`, assetId: `sample-${name}`, x: cursor - 48, y: 645 + index * 45 - 26 - 619, width: 32, height: 36 })
        cursor += 34
      }
      else cursor += part.length * size * 0.6
    }
  })
  hints[id] = [
    region(0, 'カード名', sample.name, { x: 48, y: titleY - 34, width: 648, height: 40 }),
    region(1, '種別', sample.type, { x: 48, y: titleY + 22, width: 648, height: 26 }),
    region(2, '補足', sample.detail, { x: 48, y: titleY + 52, width: 648, height: 20 }, { fontSize: 12 }),
    region(3, '効果', sample.lines.join('\n').replace(/\{(sun|drop)\}/g, '[icon:$1]'), { x: 48, y: 619, width: 628, height: 256 }, { autoMaskPreset: sample.id === '05' ? 'light' : 'dark', autoMaskSensitivity: 85, backgroundColor: sample.id === '05' ? '#244b51' : '#fffdf4', textColor: sample.id === '05' ? '#ffffff' : '#193640', sourceIcons: icons, exclusionAreas: Number(sample.id) % 2 === 0 ? [{ id: `${id}-badge`, x: 564, y: 237, width: 64, height: 19 }] : [] }),
  ]
}
for (const asset of assets) {
  const effect = hints['sample-01'][3]
  const icon = effect.sourceIcons.find(icon => icon.assetId === asset.id)
  asset.sourceRect = { x: effect.x + icon.x, y: effect.y + icon.y, width: icon.width, height: icon.height }
}
const project = { version: 2, name: 'サンプル（デモ）', demoPreset: 'sample-v1', activeCardId: cards[0].id, cards, assets, fonts: [], ocrDictionary: [], glossary: [], printSettings: { columns: 3, marginMm: 9, gapMm: 1, cutMarks: true } }
await writeFile(new URL('project.json', root), JSON.stringify(project, null, 2) + '\n')
await writeFile(new URL('demo-regions.json', import.meta.url), JSON.stringify(hints, null, 2) + '\n')
console.log('Created sample project and region hints (5 cards, 2 assets, no initial regions).')
