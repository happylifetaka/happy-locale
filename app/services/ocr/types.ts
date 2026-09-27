import type { OCRTextBlock } from '~/types/ocr'

// 既存のimport先を維持する。保存用データの正規の定義はtypes/ocrに置く。
export type { OCRTextBlock, RegionCandidate } from '~/types/ocr'

export interface OCRResult {
  text: string
  confidence: number | null
  blocks: OCRTextBlock[]
  words?: OCRTextBlock[]
}

export type OCRLayout = 'single-line' | 'sparse-text' | 'text-block'

export interface OCRProgress {
  status: string
  progress: number
}

export interface OCROptions {
  language?: 'eng'
  layout?: OCRLayout
  onProgress?: (progress: OCRProgress) => void
}

export interface OCRProvider {
  recognize: (image: Blob, options?: OCROptions) => Promise<OCRResult>
  dispose?: () => Promise<void>
}
