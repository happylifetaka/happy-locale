import type { RegionCandidate } from '~/services/ocr/types'
import type { FolderProjectCard, TextRegion } from '~/types/editor'
import { transformRegionContents } from '~/utils/regions'
import hints from '../../../samples/cards/demo-regions.json'

/** サンプルの領域情報から通常フロー用のOCR候補を作る。 */
export function sampleRegionCandidates(card: FolderProjectCard): RegionCandidate[] {
  return sampleRegions(card).map(region => ({
    id: region.id,
    sampleRegionId: region.id,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    text: region.originalText,
    confidence: null,
    selected: true,
    lines: [{ x: region.x, y: region.y, width: region.width, height: region.height, text: region.originalText, confidence: null }],
  }))
}

/** Only candidates explicitly created from demo templates use their preset settings. */
// 通常OCRの候補追加フローへ、サンプルに用意した原文・領域設定を対応付ける。
export function resolveSampleCandidates(card: FolderProjectCard, candidates: readonly RegionCandidate[]): TextRegion[] | null {
  if (!candidates.some(candidate => candidate.sampleRegionId !== undefined))
    return null
  const presets = sampleRegions(card)
  return candidates.map((candidate) => {
    const preset = presets.find(region => region.id === candidate.sampleRegionId)
    if (!preset)
      throw new Error('デモ候補を表示し直してください。')
    const bounds = { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
    return { ...preset, ...bounds, ...transformRegionContents(preset, bounds) }
  })
}

/** サンプルカードに用意された領域設定を取り出す。 */
export function sampleRegions(card: FolderProjectCard): TextRegion[] {
  if (card.imageWidth !== 744 || card.imageHeight !== 1039)
    return []
  const regions = (hints as Record<string, TextRegion[]>)[card.id]
  return regions ? JSON.parse(JSON.stringify(regions)) : []
}

/** Each demo gets its own writable browser copy; the shipped project stays pristine. */
// 配布用サンプルを作業用のフォルダ実装へコピーし、デモ中の変更を配布元から分離する。
export async function createSampleProjectCopy(baseURL: string): Promise<FileSystemDirectoryHandle> {
  const base = `${baseURL.replace(/\/$/u, '')}/sample-project/`
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(`happy-locale-demo-${crypto.randomUUID()}`, { create: true })
  const projectResponse = await fetch(`${base}project.json`)
  if (!projectResponse.ok)
    throw new Error('サンプルプロジェクトを読み込めませんでした。')
  const document = await projectResponse.json()
  // Only our fixed bundled resource paths are copied, never arbitrary project URLs.
  const files = ['images/01-grove.png', 'images/02-cloud.png', 'images/03-compass.png', 'images/04-orchard.png', 'images/05-bridge.png', 'assets/sun.png', 'assets/drop.png']
  for (const path of files) {
    const response = await fetch(`${base}${path}`)
    if (!response.ok)
      throw new Error(`サンプル画像を読み込めませんでした: ${path}`)
    const [folder, name] = path.split('/') as [string, string]
    const target = await directory.getDirectoryHandle(folder, { create: true })
    const writable = await (await target.getFileHandle(name, { create: true })).createWritable()
    await writable.write(await response.blob())
    await writable.close()
  }
  const writable = await (await directory.getFileHandle('project.json', { create: true })).createWritable()
  await writable.write(JSON.stringify(document))
  await writable.close()
  return directory
}
