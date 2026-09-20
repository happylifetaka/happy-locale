import type { OCRTextBlock } from '~/types/ocr'

export interface RegionCandidateOptions {
  scale?: number
  imageWidth: number
  imageHeight: number
  padding?: number
  minimumConfidence?: number
  minimumLatinLetters?: number
  maximumNonAlphanumericRatio?: number
  minimumHeightRatio?: number
  words?: readonly OCRTextBlock[]
  refineHeadingBounds?: (bounds: OCRTextBlock) => OCRTextBlock
  refineTextBounds?: (bounds: OCRTextBlock) => OCRTextBlock
  labelBounds?: readonly OCRTextBlock[]
}

export interface CandidateGroup {
  lines: OCRTextBlock[]
}
