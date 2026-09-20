/** OCR Providerと候補保存で共有するJSON互換の文字・矩形データ。エンジンや画素資源は含めない。 */
export interface OCRTextBlock {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number | null
}

/** 手動調整前の実測値。元画像座標へ変換して実行中だけ保持し、保存候補とは区別する。 */
export interface MeasuredOCRText {
  coordinates: 'image'
  lines: OCRTextBlock[]
  words: OCRTextBlock[]
}

/** project.jsonで保持する未確定候補。Providerの実行オプション・結果全体とは独立する。 */
export interface RegionCandidate extends OCRTextBlock {
  id: string
  sampleRegionId?: string
  selected: boolean
  lines: OCRTextBlock[]
}
