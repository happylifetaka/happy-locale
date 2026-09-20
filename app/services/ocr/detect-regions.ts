import type { RegionDetectionSettings } from './detection-settings'
import type { OCRProgress, OCRProvider, RegionCandidate } from './types'
import type { MeasuredOCRText } from '~/types/ocr'
import { createRegionCandidates } from './candidates'
import { DEFAULT_REGION_DETECTION_SETTINGS } from './detection-settings'
import { refineHeadingImageBounds } from './heading-bounds'
import { prepareRegionForOCR } from './image'
import { enhanceRegionDetection } from './region-image'

export interface DetectRegionsOptions {
  image: CanvasImageSource
  imageWidth: number
  imageHeight: number
  provider: OCRProvider
  settings?: RegionDetectionSettings
  scale?: number
  padding?: number
  /** 対象の差替え・破棄後は進捗も結果も適用しない。Workerの即時中断ではない。 */
  isCurrent: () => boolean
  /** 一括中止時は追加の見出しOCRを止め、取得済みの現在カードの結果は利用できる。 */
  continueLabelRecovery?: () => boolean
  onProgress?: (progress: OCRProgress) => void
  onRefinement?: () => void
  onEnhancementError?: (error: unknown) => void
  /** 実行中のアイコン抽出用。既定の出力・保存候補には実測座標を追加しない。 */
  includeMeasurements?: boolean
}

export interface RegionDetectionResult {
  candidates: RegionCandidate[]
  detectedLines: number
  measurements?: MeasuredOCRText
}

/** 1画像の前処理→OCR→画像補正→候補化。Storeを更新せず、渡された画像・Providerを解放しない。 */
export async function detectRegions({
  image,
  imageWidth,
  imageHeight,
  provider,
  settings = DEFAULT_REGION_DETECTION_SETTINGS,
  scale = 2,
  padding = 6,
  isCurrent,
  continueLabelRecovery = () => true,
  onProgress,
  onRefinement,
  onEnhancementError,
  includeMeasurements = false,
}: DetectRegionsOptions): Promise<RegionDetectionResult | null> {
  if (!isCurrent())
    return null
  // 前処理の拡大率制限と、認識座標を原画像へ戻す倍率を一致させる。
  scale = Math.max(1, Math.min(4, scale))
  try {
    const blob = await prepareRegionForOCR(image, {
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
    }, { scale, padding: 0 })
    if (!isCurrent())
      return null
    const result = await provider.recognize(blob, {
      language: 'eng',
      layout: 'sparse-text',
      onProgress: (progress) => {
        if (isCurrent())
          onProgress?.(progress)
      },
    })
    if (!isCurrent())
      return null
    const measurements: MeasuredOCRText | undefined = includeMeasurements
      ? {
          coordinates: 'image',
          lines: result.blocks.map(b => ({ ...b, x: b.x / scale, y: b.y / scale, width: b.width / scale, height: b.height / scale })),
          words: (result.words ?? []).map(b => ({ ...b, x: b.x / scale, y: b.y / scale, width: b.width / scale, height: b.height / scale })),
        }
      : undefined
    onRefinement?.()
    const enhanced = await enhanceRegionDetection(
      image,
      imageWidth,
      imageHeight,
      scale,
      result,
      provider,
      () => isCurrent() && continueLabelRecovery(),
      error => onEnhancementError?.(error),
      settings,
    )
    if (!isCurrent())
      return null
    const candidates = createRegionCandidates(enhanced.result.blocks, {
      settings: settings.candidates,
      words: enhanced.result.words,
      labelBounds: enhanced.labelBounds,
      refineTextBounds: enhanced.refineTextBounds,
      refineHeadingBounds: bounds => refineHeadingImageBounds(image, bounds, scale, settings.headingPixels),
      scale,
      imageWidth,
      imageHeight,
      padding,
    })
    return { candidates, detectedLines: result.blocks.length, ...(measurements ? { measurements } : {}) }
  }
  catch (error) {
    if (!isCurrent())
      return null
    throw error
  }
}
