import type { HeadingPixelSettings } from './heading-settings'
import type { OCRProvider, OCRResult, OCRTextBlock } from './types'
import { DEFAULT_REGION_DETECTION_SETTINGS } from './detection-settings'
import { refineHeadingImageBounds } from './heading-bounds'
import { prepareRegionForOCR } from './image'
import { createTextPixelRefiner, findLightLabels } from './pixel-regions'

export async function enhanceRegionDetection(
  image: CanvasImageSource,
  width: number,
  height: number,
  scale: number,
  original: OCRResult,
  provider: OCRProvider,
  isCurrent: () => boolean,
  onError: (error: unknown) => void,
  settings = DEFAULT_REGION_DETECTION_SETTINGS,
) {
  const analysis = analyzeRegionImage(image, width, height, scale, original.words ?? [], settings)
  let result: OCRResult & { labelBlocks?: OCRTextBlock[] } = original
  if (analysis && isCurrent()) {
    try {
      result = await recoverImageLabels(image, original, analysis.labels, provider, scale, isCurrent, settings.lightLabels, settings.headingPixels)
    }
    catch (error) {
      if (isCurrent())
        onError(error)
    }
  }
  const refined = result === original ? analysis : analyzeRegionImage(image, width, height, scale, result.words ?? [], settings)
  return { result, labelBounds: result.labelBlocks, refineTextBounds: refined?.refineTextBounds }
}

export function analyzeRegionImage(image: CanvasImageSource, width: number, height: number, scale: number, words: readonly OCRTextBlock[], settings = DEFAULT_REGION_DETECTION_SETTINGS) {
  if ((!settings.textPixels.enabled && !settings.lightLabels.enabled) || typeof document === 'undefined' || width <= 0 || height <= 0)
    return null
  const ratio = Math.min(1, 1200 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * ratio)
  canvas.height = Math.ceil(height * ratio)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return null
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    return {
      refineTextBounds: settings.textPixels.enabled ? createTextPixelRefiner(data, canvas.width, canvas.height, scale / ratio, words, settings.textPixels) : undefined,
      labels: findLightLabels(data, canvas.width, canvas.height, settings.lightLabels).map(c => ({
        x: Math.max(0, c.x / ratio - 2),
        y: Math.max(0, c.y / ratio - 2),
        width: Math.min(width - Math.max(0, c.x / ratio - 2), c.width / ratio + 4),
        height: Math.min(height - Math.max(0, c.y / ratio - 2), c.height / ratio + 4),
      })),
    }
  }
  catch {
    return null
  }
}

/** 画像上の明るい帯だけを再OCR。画像・文字列は同じローカルProviderから外へ出さない。 */
export async function recoverImageLabels(
  image: CanvasImageSource,
  result: OCRResult,
  labels: readonly { x: number, y: number, width: number, height: number }[],
  provider: OCRProvider,
  scale: number,
  isCurrent: () => boolean,
  settings = DEFAULT_REGION_DETECTION_SETTINGS.lightLabels,
  headingSettings?: Partial<HeadingPixelSettings>,
): Promise<OCRResult & { labelBlocks?: OCRTextBlock[] }> {
  if (!settings.enabled)
    return result
  let blocks = [...result.blocks]
  let words = [...(result.words ?? [])]
  const labelBlocks: OCRTextBlock[] = []
  const firstText = blocks.filter(b => b.confidence !== null && b.confidence >= 65 && b.text.replace(/[^a-z]/giu, '').length >= 8)
    .reduce((y, b) => Math.min(y, b.y / scale), Infinity)
  // 上限を設け、イラストの明るい箇所を際限なく再認識しない。
  for (const label of labels.filter(l => l.y >= firstText).slice(0, settings.maximumRequests)) {
    if (!isCurrent())
      return result
    const crop = refineHeadingImageBounds(image, { ...label, text: '', confidence: null }, 1, headingSettings)
    const blob = await prepareRegionForOCR(image, crop, { scale, padding: 8 })
    if (!isCurrent())
      return result
    const recognized = await provider.recognize(blob, { language: 'eng', layout: 'single-line' })
    if (!isCurrent())
      return result
    const source = recognized.words?.length ? recognized.words : recognized.blocks
    const core = source.filter(w => /^[A-Z]{2,}(?: [A-Z]{2,}){0,3}$/u.test(w.text.trim()))
    const text = core.map(w => w.text.trim()).join(' ')
    const confidence = core.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / core.length
    if (!/^[A-Z]{3,}(?: [A-Z]{2,}){0,3}$/u.test(text) || confidence < settings.minimumConfidence
      || source.some(w => !core.includes(w) && /[a-z]/iu.test(w.text) && (w.confidence ?? 0) > 30)) {
      continue
    }
    const mapped = core.map(w => ({ ...w, x: w.x + crop.x * scale - 8, y: w.y + crop.y * scale - 8 }))
    const x = Math.min(...mapped.map(w => w.x))
    const y = Math.min(...mapped.map(w => w.y))
    const right = Math.max(...mapped.map(w => w.x + w.width))
    const bottom = Math.max(...mapped.map(w => w.y + w.height))
    const replacement: OCRTextBlock = { text, x, y, width: right - x, height: bottom - y, confidence }
    const removed = blocks.filter((b) => {
      const cy = b.y + b.height / 2
      const letters = b.text.replace(/[^a-z]/giu, '')
      const uppercase = letters.length >= 3 && (letters.replace(/[^A-Z]/gu, '').length / letters.length >= 0.6 || b.text.includes(text))
      return uppercase && cy >= label.y * scale && cy <= (label.y + label.height) * scale
        && b.x < right && b.x + b.width > x
    })
    // 読み取った見出しを二重に残さない。本文は枠が帯にかかっていても消さない。
    blocks = blocks.filter(b => !removed.includes(b))
    words = words.filter(w => !removed.some(b => w.x + w.width / 2 >= b.x && w.x + w.width / 2 <= b.x + b.width
      && w.y + w.height / 2 >= b.y && w.y + w.height / 2 <= b.y + b.height))
    blocks.push(replacement)
    labelBlocks.push(replacement)
    words.push(...mapped)
  }
  return { ...result, blocks, words, labelBlocks }
}
