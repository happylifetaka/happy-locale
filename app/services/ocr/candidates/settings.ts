/** 内部ポリシーの選択と調整値。外部JSONの仕様・任意コードのプラグインではない。 */
export interface CandidateDetectionSettings {
  readonly minimumConfidence: number
  readonly minimumLatinLetters: number
  readonly maximumNonAlphanumericRatio: number
  readonly minimumHeightRatio: number
  /** この値を超えた候補を初期選択する。不明信頼度の扱いは既存どおり選択。 */
  readonly initialSelectionConfidence: number
  readonly headingDecorations: 'uppercase-latin' | 'none'
  readonly labelClassification: 'uppercase-latin' | 'none'
  readonly lineGrouping: 'layout' | 'rows-only' | 'none'
  readonly maximumRowGapRatio: number
  readonly maximumLineGapRatio: number
  readonly maximumAlignedLineGapRatio: number
  readonly maximumAlignedLargeLineGapRatio: number
  readonly refinedPadding: number
  readonly separatePadding: boolean
  readonly maximumPaddingGap: number
}

export const DEFAULT_CANDIDATE_DETECTION_SETTINGS: CandidateDetectionSettings = Object.freeze({
  minimumConfidence: 0,
  minimumLatinLetters: 3,
  maximumNonAlphanumericRatio: 0.5,
  minimumHeightRatio: 0.01,
  initialSelectionConfidence: 40,
  headingDecorations: 'uppercase-latin',
  labelClassification: 'uppercase-latin',
  lineGrouping: 'layout',
  maximumRowGapRatio: 1.5,
  maximumLineGapRatio: 0.8,
  maximumAlignedLineGapRatio: 1.5,
  maximumAlignedLargeLineGapRatio: 1.1,
  refinedPadding: 2,
  separatePadding: true,
  maximumPaddingGap: 1,
})

/** 呼出しごとに解決し、共有既定値や他の検出へ変更を漏らさない。 */
export function candidateDetectionSettings(overrides?: Partial<CandidateDetectionSettings>): CandidateDetectionSettings {
  return overrides ? { ...DEFAULT_CANDIDATE_DETECTION_SETTINGS, ...overrides } : DEFAULT_CANDIDATE_DETECTION_SETTINGS
}
