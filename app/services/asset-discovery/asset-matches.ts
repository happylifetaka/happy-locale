import type { DiscoveryAssetCatalog } from './asset-catalog'
import type { IconOccurrence } from '~/types/asset-discovery'
import type { RegionDraft } from '~/types/editor'
import { fingerprintImage } from '~/utils/asset-matching'
import { assertImageDimensions } from '~/utils/file-limits'
import { isDiscoveryAssetCatalogCurrent } from './asset-catalog'
import { createImageDigestCache } from './digest'
import { ASSET_DISCOVERY_LIMITS } from './format'
import { validBounds } from './geometry'
import { containsBounds } from './review'
import { createDiscoveryComparator } from './similarity'

export interface DiscoveryAssetMatchRow {
  readonly occurrenceId: string
  readonly bounds: Readonly<RegionDraft>
  readonly status: 'match' | 'ambiguous' | 'no-match' | 'incomplete' | 'unavailable' | 'excluded'
  /** 類似度は正解確率ではない。表示・選択の提案であり、個別の承認とは別。 */
  readonly matches: readonly { assetId: string, assetDigest: string, similarity: number }[]
}

export interface DiscoveryAssetMatches {
  readonly cardId: string
  readonly imageDigest: string
  readonly rows: readonly DiscoveryAssetMatchRow[]
  readonly comparisons: number
  readonly truncated: boolean
  readonly failedAssetIds: readonly string[]
  readonly omittedAssetIds: readonly string[]
}

interface MatchOptions {
  card: { id: string, imageWidth: number, imageHeight: number }
  file: File
  occurrences: readonly IconOccurrence[]
  catalog: DiscoveryAssetCatalog
  /** Store・元ファイル参照・プロジェクトの世代、操作の取消を含む現在性。 */
  isCurrent: () => boolean
  maximumComparisons?: number
  minimumSimilarity?: number
  ambiguityMargin?: number
  digestCache?: ReturnType<typeof createImageDigestCache>
}

function occurrenceKey(occurrence: IconOccurrence): string {
  return JSON.stringify([occurrence.id, occurrence.cardId, occurrence.imageDigest, occurrence.imageSize.width, occurrence.imageSize.height, occurrence.bounds.x, occurrence.bounds.y, occurrence.bounds.width, occurrence.bounds.height, occurrence.decision, occurrence.assetId])
}

const sessions = new WeakMap<DiscoveryAssetMatches, { current: () => boolean, keys: ReadonlyMap<string, string> }>()

/** 編集後の枠を原画像から再計測する。保存済み・調整前の指紋は流用しない。 */
export async function matchCardIconsToAssets({ card, file, occurrences, catalog, isCurrent, maximumComparisons = 10000, minimumSimilarity = 0.9, ambiguityMargin = 0.03, digestCache = createImageDigestCache() }: MatchOptions): Promise<DiscoveryAssetMatches | null> {
  assertImageDimensions(card.imageWidth, card.imageHeight)
  if (!Number.isInteger(maximumComparisons) || maximumComparisons < 1 || maximumComparisons > 100000
    || !Number.isFinite(minimumSimilarity) || minimumSimilarity < 0.5 || minimumSimilarity > 1
    || !Number.isFinite(ambiguityMargin) || ambiguityMargin < 0 || ambiguityMargin > 1
    || occurrences.length > ASSET_DISCOVERY_LIMITS.perCard || new Set(occurrences.map(item => item.id)).size !== occurrences.length) {
    throw new Error('アセット一致提案の条件・上限が不正です。')
  }
  const cardKey = JSON.stringify([card.id, card.imageWidth, card.imageHeight])
  const keys = new Map(occurrences.map(item => [item.id, occurrenceKey(item)]))
  let invalidated = false
  const current = () => {
    invalidated ||= !isCurrent() || !isDiscoveryAssetCatalogCurrent(catalog)
      || JSON.stringify([card.id, card.imageWidth, card.imageHeight]) !== cardKey
      || occurrences.length !== keys.size || occurrences.some(item => keys.get(item.id) !== occurrenceKey(item))
    return !invalidated
  }
  if (!current())
    return null
  for (const item of occurrences) {
    if (!item.id.trim() || item.id.length > ASSET_DISCOVERY_LIMITS.identifierLength || item.cardId !== card.id
      || item.imageSize.width !== card.imageWidth || item.imageSize.height !== card.imageHeight
      || !/^[a-f0-9]{64}$/u.test(item.imageDigest) || !validBounds(item.bounds)
      || !containsBounds({ x: 0, y: 0, width: card.imageWidth, height: card.imageHeight }, item.bounds)) {
      throw new Error('照合する候補の元画像・座標が不正です。')
    }
  }
  let bitmap: ImageBitmap | undefined
  try {
    const imageDigest = await digestCache.digest(file)
    if (!current())
      return null
    if (occurrences.some(item => item.imageDigest !== imageDigest))
      throw new Error('元画像が変わっています。候補を再抽出・確認してから照合してください。')
    bitmap = await createImageBitmap(file)
    if (!current())
      return null
    if (bitmap.width !== card.imageWidth || bitmap.height !== card.imageHeight)
      throw new Error('照合する元画像の寸法が変わっています。')
    const similarity = createDiscoveryComparator()
    const rows: DiscoveryAssetMatchRow[] = []
    let comparisons = 0
    let truncated = false
    for (const item of [...occurrences].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (!current())
        return null
      const fingerprint = item.decision === 'excluded' ? null : fingerprintImage(bitmap, item.bounds)
      const matches: { assetId: string, assetDigest: string, similarity: number }[] = []
      let incomplete = catalog.failures.length > 0 || catalog.omittedAssetIds.length > 0
      if (fingerprint) {
        for (const asset of catalog.samples) {
          if (comparisons >= maximumComparisons) {
            truncated = true
            incomplete = true
            break
          }
          comparisons++
          const score = similarity(fingerprint, asset.fingerprint)
          if (score >= minimumSimilarity)
            matches.push({ assetId: asset.assetId, assetDigest: asset.assetDigest, similarity: score })
        }
      }
      matches.sort((a, b) => b.similarity - a.similarity || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))
      const status: DiscoveryAssetMatchRow['status'] = item.decision === 'excluded'
        ? 'excluded'
        : !fingerprint
            ? 'unavailable'
            : incomplete
              ? 'incomplete'
              : !matches.length
                  ? 'no-match'
                  : matches.length > 1 && matches[0]!.similarity - matches[1]!.similarity <= ambiguityMargin ? 'ambiguous' : 'match'
      rows.push(Object.freeze({ occurrenceId: item.id, bounds: Object.freeze({ ...item.bounds }), status, matches: Object.freeze(matches.slice(0, 5).map(match => Object.freeze(match))) }))
    }
    if (!current())
      return null
    const result: DiscoveryAssetMatches = Object.freeze({ cardId: card.id, imageDigest, rows: Object.freeze(rows), comparisons, truncated, failedAssetIds: Object.freeze(catalog.failures.map(item => item.assetId)), omittedAssetIds: catalog.omittedAssetIds })
    sessions.set(result, { current, keys })
    return result
  }
  catch (error) {
    if (!current())
      return null
    throw error
  }
  finally {
    bitmap?.close()
  }
}

/** 利用者が選んだ一件を検証するだけ。通常のレビュー操作への引渡しと承認は呼出元が別々に行う。 */
export function chooseDiscoveryAssetMatch(proposal: DiscoveryAssetMatches, occurrence: IconOccurrence, assetId: string): { occurrenceId: string, assetId: string, assetDigest: string } {
  const session = sessions.get(proposal)
  const row = proposal.rows.find(item => item.occurrenceId === occurrence.id)
  const match = row?.matches.find(item => item.assetId === assetId)
  if (!session?.current() || session.keys.get(occurrence.id) !== occurrenceKey(occurrence) || !match || occurrence.decision === 'excluded')
    throw new Error('一致提案の対象が変わったか、選択したアセットがありません。再照合してください。')
  return { occurrenceId: occurrence.id, assetId: match.assetId, assetDigest: match.assetDigest }
}
