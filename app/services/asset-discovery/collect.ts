import type { IconGroupSample } from './group'
import type { IconDiscoverySettings } from './types'
import type { OCRProvider } from '~/services/ocr/types'
import type { IconOccurrence } from '~/types/asset-discovery'
import type { FolderProjectCard, RegionDraft } from '~/types/editor'
import type { MeasuredOCRText, OCRTextBlock } from '~/types/ocr'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { fingerprintImage } from '~/utils/asset-matching'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'
import { createImageDigestCache } from './digest'
import { ASSET_DISCOVERY_LIMITS } from './format'
import { clipBounds, intersectionArea, validBounds } from './geometry'
import { discoverImageIcons } from './image'
import { containsBounds } from './review'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from './types'

export type DiscoveryCard = Pick<FolderProjectCard, 'id' | 'imageWidth' | 'imageHeight' | 'regions' | 'ocrCandidates'>
export const ICON_DETECTOR_REVISION = 'components-v1'
export const ICON_OCR_LIMITS = Object.freeze({ owners: 256, areas: 32, pixels: 4_000_000, lines: 1000, words: 10000 })

export interface CardIconProposal {
  cardId: string
  imageDigest: string
  imageSize: { width: number, height: number }
  occurrences: IconOccurrence[]
  /** 比較用の派生値。保存文書には混ぜず、レビュー終了時に破棄する。 */
  samples: IconGroupSample[]
  searchedAreas: RegionDraft[]
  ocrAreas: RegionDraft[]
  limitsHit: Array<'owners' | 'ocr-areas' | 'ocr-pixels' | 'ocr-measurements' | 'extraction'>
}

/** 保存候補のlinesは使わず、枠を再OCRの範囲選択にだけ使う。 */
export function discoveryOCRAreas(card: DiscoveryCard): { areas: RegionDraft[], limitsHit: CardIconProposal['limitsHit'] } {
  assertImageDimensions(card.imageWidth, card.imageHeight)
  const owners = [...card.regions, ...(card.ocrCandidates ?? [])]
  const limitsHit: CardIconProposal['limitsHit'] = owners.length > ICON_OCR_LIMITS.owners ? ['owners'] : []
  const padding = Math.min(64, Math.max(4, Math.ceil(Math.min(card.imageWidth, card.imageHeight) * 0.02)))
  const areas: RegionDraft[] = []
  for (const owner of owners.slice(0, ICON_OCR_LIMITS.owners)) {
    if (!validBounds(owner)) {
      if (!limitsHit.includes('owners'))
        limitsHit.push('owners')
      continue
    }
    let rect = clipBounds({ x: owner.x - padding, y: owner.y - padding, width: owner.width + padding * 2, height: owner.height + padding * 2 }, card.imageWidth, card.imageHeight)
    if (!validBounds(rect)) {
      if (!limitsHit.includes('owners'))
        limitsHit.push('owners')
      continue
    }
    // 対象数を制限した上で重なるROIを結合し、同じ文章を繰り返し認識しない。
    for (let index = 0; index < areas.length;) {
      const other = areas[index]!
      if (intersectionArea(rect, other) === 0) {
        index++
        continue
      }
      const x = Math.min(rect.x, other.x)
      const y = Math.min(rect.y, other.y)
      rect = { x, y, width: Math.max(rect.x + rect.width, other.x + other.width) - x, height: Math.max(rect.y + rect.height, other.y + other.height) - y }
      areas.splice(index, 1)
      index = 0
    }
    areas.push(rect)
  }
  if (!owners.length)
    areas.push({ x: 0, y: 0, width: card.imageWidth, height: card.imageHeight })
  areas.sort((a, b) => a.y - b.y || a.x - b.x)
  if (areas.length > ICON_OCR_LIMITS.areas)
    limitsHit.push('ocr-areas')
  return { areas: areas.slice(0, ICON_OCR_LIMITS.areas), limitsHit }
}

/** 同じ画像のOCR直後にも使える抽出入口。既存の領域・アイコン候補を変更しない。 */
export function collectMeasuredImageIcons(
  image: CanvasImageSource,
  card: DiscoveryCard,
  imageDigest: string,
  measured: MeasuredOCRText,
  settings: Readonly<IconDiscoverySettings> = DEFAULT_ICON_DISCOVERY_SETTINGS,
): CardIconProposal {
  if (!/^[a-f0-9]{64}$/u.test(imageDigest) || measured.coordinates !== 'image' || settings.maximumCandidates > ASSET_DISCOVERY_LIMITS.perCard)
    throw new Error('アイコン候補の元画像情報・件数上限が不正です。')
  if (measured.lines.some(line => /[a-z]/iu.test(line.text)) && !measured.words.length)
    throw new Error('単語座標が取得できないためアイコン候補を安全に抽出できません。')
  const extraction = discoverImageIcons(image, card.imageWidth, card.imageHeight, measured, settings)
  const owners = [
    ...card.regions.map(region => ({ ...region, kind: 'region' as const })),
    ...(card.ocrCandidates ?? []).map(candidate => ({ ...candidate, kind: 'candidate' as const })),
  ]
  const occurrences: IconOccurrence[] = extraction.icons.map((icon) => {
    const matches = owners.filter(owner => containsBounds(owner, icon.bounds))
    return {
      id: crypto.randomUUID(),
      cardId: card.id,
      imageDigest,
      imageSize: { width: card.imageWidth, height: card.imageHeight },
      bounds: { ...icon.bounds },
      detectedBounds: { ...icon.bounds },
      origin: 'detected',
      detectorRevision: `${ICON_DETECTOR_REVISION}/c${settings.maximumCandidates}/p${settings.maximumSearchedPixels}/color${settings.minimumColorDifference}/contrast${settings.minimumContrast}`,
      detectionReason: icon.reason,
      decision: 'pending',
      assetId: null,
      approval: null,
      owner: matches.length === 1 ? { kind: matches[0]!.kind, id: matches[0]!.id } : null,
    }
  })
  return {
    cardId: card.id,
    imageDigest,
    imageSize: { width: card.imageWidth, height: card.imageHeight },
    occurrences,
    samples: occurrences.map(occurrence => ({ id: occurrence.id, fingerprint: fingerprintImage(image, occurrence.bounds) })),
    searchedAreas: extraction.searchedAreas,
    ocrAreas: [],
    limitsHit: extraction.truncated ? ['extraction'] : [],
  }
}

interface CollectCardIconsOptions {
  card: DiscoveryCard
  file: File
  provider: OCRProvider
  isCurrent: () => boolean
  settings?: Readonly<IconDiscoverySettings>
  digestCache?: ReturnType<typeof createImageDigestCache>
}

/** 保存後の再抽出用。必要なROIを新しくOCRし、一枚のBitmapを確実に解放する。 */
export async function collectCardIconCandidates({ card, file, provider, isCurrent, settings, digestCache = createImageDigestCache() }: CollectCardIconsOptions): Promise<CardIconProposal | null> {
  let bitmap: ImageBitmap | undefined
  try {
    if (!isCurrent())
      return null
    assertFileSize(file, FILE_LIMITS.imageBytes, 'アイコン抽出元画像')
    const imageDigest = await digestCache.digest(file)
    if (!isCurrent())
      return null
    bitmap = await createImageBitmap(file)
    if (!isCurrent())
      return null
    assertImageDimensions(bitmap.width, bitmap.height)
    if (bitmap.width !== card.imageWidth || bitmap.height !== card.imageHeight)
      throw new Error('元画像の寸法が変わりました。カードを開き直してから再抽出してください。')
    const { areas, limitsHit } = discoveryOCRAreas(card)
    const measured: MeasuredOCRText = { coordinates: 'image', lines: [], words: [] }
    const ocrAreas: RegionDraft[] = []
    let pixels = 0
    for (const area of areas) {
      if (!isCurrent())
        return null
      if (pixels + area.width * area.height > ICON_OCR_LIMITS.pixels) {
        if (!limitsHit.includes('ocr-pixels'))
          limitsHit.push('ocr-pixels')
        continue
      }
      pixels += area.width * area.height
      const blob = await prepareRegionForOCR(bitmap, area, { scale: 2, padding: 0 })
      if (!isCurrent())
        return null
      const recognized = await provider.recognize(blob, { language: 'eng', layout: 'sparse-text' })
      if (!isCurrent())
        return null
      if (recognized.blocks.some(line => /[a-z]/iu.test(line.text)) && !recognized.words?.length)
        throw new Error('単語座標が取得できないためアイコン候補を安全に抽出できません。')
      if (measured.lines.length + recognized.blocks.length > ICON_OCR_LIMITS.lines
        || measured.words.length + (recognized.words?.length ?? 0) > ICON_OCR_LIMITS.words) {
        limitsHit.push('ocr-measurements')
        break
      }
      const restore = (block: OCRTextBlock): OCRTextBlock => ({ ...block, x: area.x + block.x / 2, y: area.y + block.y / 2, width: block.width / 2, height: block.height / 2 })
      measured.lines.push(...recognized.blocks.map(restore))
      measured.words.push(...(recognized.words ?? []).map(restore))
      ocrAreas.push(area)
    }
    const proposal = collectMeasuredImageIcons(bitmap, card, imageDigest, measured, settings)
    return isCurrent() ? { ...proposal, ocrAreas, limitsHit: [...limitsHit, ...proposal.limitsHit] } : null
  }
  catch (error) {
    if (!isCurrent())
      return null
    throw error
  }
  finally {
    bitmap?.close()
  }
}
