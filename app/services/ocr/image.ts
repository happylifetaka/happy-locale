import type { ExclusionArea, RegionDraft } from '~/types/editor'

export interface PrepareOCRImageOptions {
  scale?: number
  padding?: number
  exclusions?: readonly ExclusionArea[]
}

/** OCR用CanvasをPNG画像へ変換する。 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else reject(new Error('OCR用画像を作成できませんでした。'))
    }, 'image/png')
  })
}

/** 輝度分布の両端2%を切り詰めてコントラストを広げ、小さい文字を認識しやすくする。 */
function contrastStretch(data: Uint8ClampedArray) {
  const histogram = new Uint32Array(256)
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(
      data[index]! * 0.299
      + data[index + 1]! * 0.587
      + data[index + 2]! * 0.114,
    )
    histogram[luminance]! += 1
  }

  const pixels = data.length / 4
  const lowerTarget = pixels * 0.02
  const upperTarget = pixels * 0.98
  let accumulated = 0
  let lower = 0
  let upper = 255
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value]!
    if (accumulated >= lowerTarget) {
      lower = value
      break
    }
  }
  accumulated = 0
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value]!
    if (accumulated >= upperTarget) {
      upper = value
      break
    }
  }
  const range = Math.max(1, upper - lower)
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(
      data[index]! * 0.299
      + data[index + 1]! * 0.587
      + data[index + 2]! * 0.114,
    )
    const stretched = Math.max(
      0,
      Math.min(255, Math.round(((luminance - lower) * 255) / range)),
    )
    data[index] = stretched
    data[index + 1] = stretched
    data[index + 2] = stretched
  }
}

/** 領域を拡大し余白を追加してOCR用画像にする。除外領域は認識前に白で隠す。 */
export async function prepareRegionForOCR(
  image: CanvasImageSource,
  region: RegionDraft,
  options: PrepareOCRImageOptions = {},
): Promise<Blob> {
  const scale = Math.max(1, Math.min(4, options.scale ?? 3))
  const padding = Math.max(0, options.padding ?? 12)
  const sourceWidth = Math.max(1, Math.round(region.width))
  const sourceHeight = Math.max(1, Math.round(region.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(sourceWidth * scale + padding * 2)
  canvas.height = Math.ceil(sourceHeight * scale + padding * 2)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    throw new Error('OCR用Canvasを初期化できませんでした。')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    region.x,
    region.y,
    sourceWidth,
    sourceHeight,
    padding,
    padding,
    sourceWidth * scale,
    sourceHeight * scale,
  )

  for (const area of options.exclusions ?? []) {
    context.fillRect(
      padding + area.x * scale,
      padding + area.y * scale,
      area.width * scale,
      area.height * scale,
    )
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  contrastStretch(imageData.data)
  context.putImageData(imageData, 0, 0)
  return canvasToBlob(canvas)
}
