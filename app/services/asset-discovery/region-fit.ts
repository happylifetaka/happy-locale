import type { IconOccurrence } from '~/types/asset-discovery'
import type { RegionDraft, TextRegion } from '~/types/editor'
import { intersectionArea, validBounds } from './geometry'
import { rebaseRegionBounds } from './region-comparison'
import { containsBounds, sameBounds } from './review'

/** 元画像px。小さなアイコンを大幅に巻き込まないよう短辺の20%でも制限する。 */
export const ICON_REGION_FIT = Object.freeze({ maximumPixels: 8, maximumIconRatio: 0.2 })

/** 元の枠を基準に判定し、連続した拡張で許容範囲を広げない。 */
export function minimalIconExpansion(region: RegionDraft, icons: readonly RegionDraft[]): RegionDraft | null {
  if (!validBounds(region) || icons.some(icon => !validBounds(icon)))
    return null
  let left = region.x
  let top = region.y
  let right = region.x + region.width
  let bottom = region.y + region.height
  for (const icon of icons) {
    if (containsBounds(region, icon))
      continue
    const limit = Math.min(ICON_REGION_FIT.maximumPixels, Math.min(icon.width, icon.height) * ICON_REGION_FIT.maximumIconRatio)
    if (intersectionArea(region, icon) <= 0 || Math.max(region.x - icon.x, region.y - icon.y, icon.x + icon.width - region.x - region.width, icon.y + icon.height - region.y - region.height) > limit)
      return null
    left = Math.min(left, icon.x)
    top = Math.min(top, icon.y)
    right = Math.max(right, icon.x + icon.width)
    bottom = Math.max(bottom, icon.y + icon.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 一意な対応だけを最小拡張する。他の枠との衝突は両案を止め、順序に依存させない。 */
export function fitIconRegions(regions: readonly TextRegion[], icons: readonly IconOccurrence[], imageSize: { width: number, height: number }) {
  const reasons = new Map<string, string>()
  const extensions = new Map<string, IconOccurrence[]>()
  for (const icon of icons) {
    const touching = regions.filter(region => intersectionArea(region, icon.bounds) > 0)
    if (touching.length !== 1) {
      reasons.set(icon.id, touching.length ? '複数の領域に重なっています' : '対応する領域がありません')
      continue
    }
    if (containsBounds(touching[0]!, icon.bounds))
      continue
    const owner = touching[0]!
    if (!minimalIconExpansion(owner, [icon.bounds])) {
      reasons.set(icon.id, 'はみ出しが自動補正の範囲を超えています')
      continue
    }
    extensions.set(owner.id, [...extensions.get(owner.id) ?? [], icon])
  }
  const fitted = regions.map((region) => {
    const items = extensions.get(region.id)
    if (!items)
      return region
    const bounds = minimalIconExpansion(region, items.map(item => item.bounds))!
    try {
      return { ...region, ...rebaseRegionBounds(region, bounds, imageSize.width, imageSize.height) }
    }
    catch (error) {
      items.forEach(item => reasons.set(item.id, error instanceof Error ? error.message : String(error)))
      return region
    }
  })
  const conflicts = new Set<string>()
  for (const [index, region] of fitted.entries()) {
    if (sameBounds(region, regions[index]!))
      continue
    if (fitted.some(other => other.id !== region.id && intersectionArea(region, other) > 0))
      conflicts.add(region.id)
    // 他の拡張が取り消されても、元の枠へ重なる案を残さない。
    if (regions.some(other => other.id !== region.id && intersectionArea(region, other) > 0))
      conflicts.add(region.id)
  }
  return {
    regions: fitted.map((region, index) => {
      if (!conflicts.has(region.id))
        return region
      extensions.get(region.id)?.forEach(item => reasons.set(item.id, '拡張すると別の領域と重なります'))
      return regions[index]!
    }),
    reasons,
  }
}
