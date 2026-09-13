import type { TextRegion, TranslationStatus } from '~/types/editor'

export type RegionStatusFilter = 'all' | TranslationStatus

export interface RegionSearchCard {
  id: string
  imageName: string
  regions: readonly TextRegion[]
}

export interface ProjectRegionSearchResult {
  cardId: string
  cardName: string
  region: TextRegion
}

/** 役割・翻訳状態で絞り込み、表示名・CSV用ID・原文・訳文を大文字小文字を区別せず検索する。 */
export function filterRegions(
  regions: readonly TextRegion[],
  query: string,
  status: RegionStatusFilter,
  role: string | null = null,
): TextRegion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return regions.filter((region) => {
    if (role !== null && (region.role ?? '') !== role)
      return false
    if (status !== 'all' && region.translationStatus !== status)
      return false
    if (!normalizedQuery)
      return true
    return [
      region.displayName,
      region.regionId,
      region.originalText,
      region.translatedText,
    ].some(value => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}

/** 全カードを検索し、領域と所属カードを組にして返す。 */
export function filterProjectRegions(
  cards: readonly RegionSearchCard[],
  query: string,
  status: RegionStatusFilter,
): ProjectRegionSearchResult[] {
  return cards.flatMap(card =>
    filterRegions(card.regions, query, status).map(region => ({
      cardId: card.id,
      cardName: card.imageName,
      region,
    })),
  )
}
