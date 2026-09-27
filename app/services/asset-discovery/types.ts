import type { RegionDraft } from '~/types/editor'

export type { MeasuredOCRText } from '~/types/ocr'

export interface DiscoveredIcon {
  bounds: RegionDraft
  reason: 'colored-component' | 'contrast-component'
  /** 探索元の実測行。候補／領域IDとの恒久的な対応を意味しない。 */
  lineIndex: number
}

export interface IconDiscoveryResult {
  icons: DiscoveredIcon[]
  searchedAreas: RegionDraft[]
  /** 上限に達した結果を「候補なし／探索完了」と区別する。 */
  truncated: boolean
  examinedPixels: number
}

export interface IconDiscoverySettings {
  maximumCandidates: number
  maximumSearchedPixels: number
  minimumColorDifference: number
  minimumContrast: number
}

/** 調整可能な一般条件。ゲーム固有の語句・位置・画像は持たない。 */
export const DEFAULT_ICON_DISCOVERY_SETTINGS: Readonly<IconDiscoverySettings> = Object.freeze({
  maximumCandidates: 100,
  maximumSearchedPixels: 2_000_000,
  minimumColorDifference: 60,
  minimumContrast: 48,
})
