import type { RegionRole, TextRegion } from '~/types/editor'

/** 役割名の前後の空白を除去し、空欄や文字列以外はundefinedにする。 */
export function normalizeRegionRole(value: unknown): RegionRole | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

/** 領域で使われている役割名を一覧化する。 */
export function collectRegionRoles(regions: readonly TextRegion[]): RegionRole[] {
  return [...new Set(regions.map(region => normalizeRegionRole(region.role))
    .filter((role): role is RegionRole => role !== undefined))]
}
