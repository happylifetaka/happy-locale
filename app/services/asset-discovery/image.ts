import type { IconDiscoveryResult, IconDiscoverySettings, MeasuredOCRText } from './types'
import type { OCRTextBlock } from '~/types/ocr'
import { assertImageDimensions } from '~/utils/file-limits'
import { extractIconCandidates } from './extract'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from './types'

/** 呼出元の画像は所有しない。作業Canvasを縮小し、結果は常に元画像座標で返す。 */
export function discoverImageIcons(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  measured: MeasuredOCRText,
  settings: Readonly<IconDiscoverySettings> = DEFAULT_ICON_DISCOVERY_SETTINGS,
): IconDiscoveryResult {
  assertImageDimensions(imageWidth, imageHeight)
  const ratio = Math.min(1, 1400 / Math.max(imageWidth, imageHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(imageWidth * ratio))
  canvas.height = Math.max(1, Math.round(imageHeight * ratio))
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      throw new Error('アイコン抽出用のCanvasを作成できませんでした。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const sx = canvas.width / imageWidth
    const sy = canvas.height / imageHeight
    const scale = (b: OCRTextBlock): OCRTextBlock => ({ ...b, x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy })
    const result = extractIconCandidates(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { coordinates: 'image', lines: measured.lines.map(scale), words: measured.words.map(scale) }, settings)
    const restore = (b: { x: number, y: number, width: number, height: number }) => ({ x: b.x / sx, y: b.y / sy, width: b.width / sx, height: b.height / sy })
    return { ...result, icons: result.icons.map(icon => ({ ...icon, bounds: restore(icon.bounds) })), searchedAreas: result.searchedAreas.map(restore) }
  }
  finally {
    canvas.width = 1
    canvas.height = 1
  }
}
