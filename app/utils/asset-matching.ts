import { removeConnectedBackground } from '~/utils/canvas/asset'

export interface AssetFingerprint {
  pixels: Float32Array
  aspect: number
}
const size = 24

/** 外周背景と透明余白を除き、寸法差を吸収した比較用画像を作る。 */
export function assetFingerprint(data: Uint8ClampedArray, width: number, height: number): AssetFingerprint | null {
  if (width < 1 || height < 1 || data.length !== width * height * 4)
    return null
  const hasTransparency = data.some((value, index) => index % 4 === 3 && value < 255)
  const pixels = hasTransparency ? data : removeConnectedBackground(data, width, height, { threshold: 48, feather: 12 })
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! < 32)
        continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left)
    return null
  const output = new Float32Array(size * size * 4)
  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  // 各セル内を複数点で採取し、拡大率による細線の取りこぼしを減らす。
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = left + Math.min(cropWidth - 1, Math.floor((x + (sx + 0.5) / 3) * cropWidth / size))
          const py = top + Math.min(cropHeight - 1, Math.floor((y + (sy + 0.5) / 3) * cropHeight / size))
          const offset = (py * width + px) * 4
          const target = (y * size + x) * 4
          const alpha = pixels[offset + 3]! / 255
          for (let channel = 0; channel < 3; channel++)
            output[target + channel]! += pixels[offset + channel]! / 255 * alpha / 9
          output[target + 3]! += alpha / 9
        }
      }
    }
  }
  return { pixels: output, aspect: cropWidth / cropHeight }
}

/** 形状・色・縦横比の類似度。正解確率ではなく、候補を並べるための相対値。 */
export function assetSimilarity(a: AssetFingerprint, b: AssetFingerprint): number {
  let intersection = 0
  let union = 0
  let colorDifference = 0
  for (let index = 0; index < a.pixels.length; index += 4) {
    intersection += Math.min(a.pixels[index + 3]!, b.pixels[index + 3]!)
    union += Math.max(a.pixels[index + 3]!, b.pixels[index + 3]!)
    for (let channel = 0; channel < 3; channel++)
      colorDifference += Math.abs(a.pixels[index + channel]! - b.pixels[index + channel]!) / 3
  }
  if (!union)
    return 0
  const aspect = Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect)
  return Math.max(0, (0.8 * intersection / union + 0.2 * (1 - colorDifference / union)) * aspect)
}

/** OCR加工前の切り抜きと、登録済みの画像を同じ手順で正規化する。 */
export function fingerprintImage(image: CanvasImageSource, bounds?: { x: number, y: number, width: number, height: number }): AssetFingerprint | null {
  const canvas = document.createElement('canvas')
  const source = image as HTMLImageElement | HTMLCanvasElement
  const rect = bounds ?? { x: 0, y: 0, width: 'naturalWidth' in source ? source.naturalWidth : source.width, height: 'naturalHeight' in source ? source.naturalHeight : source.height }
  // 大きな画像も比較用の作業領域を制限する。
  const scale = Math.min(1, 256 / Math.max(rect.width, rect.height))
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return null
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  return assetFingerprint(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
}
