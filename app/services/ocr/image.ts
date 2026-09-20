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

/** 除外範囲を周囲の代表輝度で隠す。暗い背景に白い矩形を作らず、隣接文字の画素は変更しない。 */
export function maskOCRAreas(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  areas: readonly RegionDraft[],
  content: RegionDraft,
  radius = 3,
) {
  if (!areas.length)
    return
  const source = new Uint8ClampedArray(data)
  const inside = (x: number, y: number, rect: RegionDraft) => x >= rect.x && y >= rect.y
    && x < rect.x + rect.width && y < rect.y + rect.height
  for (const area of areas) {
    const samples: number[] = []
    const left = Math.max(0, Math.floor(area.x))
    const top = Math.max(0, Math.floor(area.y))
    const right = Math.min(width, Math.ceil(area.x + area.width))
    const bottom = Math.min(height, Math.ceil(area.y + area.height))
    for (let y = Math.max(0, top - radius); y < Math.min(height, bottom + radius); y++) {
      for (let x = Math.max(0, left - radius); x < Math.min(width, right + radius); x++) {
        if (!inside(x, y, content) || areas.some(rect => inside(x, y, rect)))
          continue
        const offset = (y * width + x) * 4
        samples.push(Math.round(source[offset]! * 0.299 + source[offset + 1]! * 0.587 + source[offset + 2]! * 0.114))
      }
    }
    samples.sort((a, b) => a - b)
    const background = samples[Math.floor(samples.length / 2)] ?? 255
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * width + x) * 4
        data[offset] = background
        data[offset + 1] = background
        data[offset + 2] = background
        data[offset + 3] = 255
      }
    }
  }
}

/** 領域を拡大し余白を追加してOCR用画像にする。除外領域は周囲の背景輝度で隠す。 */
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
  try {
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

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    maskOCRAreas(imageData.data, canvas.width, canvas.height, (options.exclusions ?? []).map(area => ({
      x: padding + area.x * scale,
      y: padding + area.y * scale,
      width: area.width * scale,
      height: area.height * scale,
    })), { x: padding, y: padding, width: sourceWidth * scale, height: sourceHeight * scale }, Math.ceil(scale * 2))
    contrastStretch(imageData.data)
    context.putImageData(imageData, 0, 0)
    // PNG化が終わるまでは画素を保持し、その後は一括OCRでも積み残さない。
    return await canvasToBlob(canvas)
  }
  finally {
    canvas.width = 1
    canvas.height = 1
  }
}
