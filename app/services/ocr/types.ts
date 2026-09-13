export interface OCRTextBlock {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number | null
}

export interface OCRResult {
  text: string
  confidence: number | null
  blocks: OCRTextBlock[]
  words?: OCRTextBlock[]
}

export type OCRLayout = 'single-line' | 'sparse-text' | 'text-block'

export interface RegionCandidate extends OCRTextBlock {
  id: string
  sampleRegionId?: string
  selected: boolean
  lines: OCRTextBlock[]
}

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
