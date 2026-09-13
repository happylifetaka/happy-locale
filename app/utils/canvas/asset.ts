import type { MaskStroke } from '~/types/editor'

export interface AssetTransparencyOptions {
  threshold: number
  feather: number
  backgroundColor?: string | null
}

/** 元画像の透明度を基準にブラシを適用し、透過部分の追加と元の透明度への復元を扱う。 */
export function applyAssetTransparencyStrokes(
  source: Uint8ClampedArray,
  transparent: Uint8ClampedArray,
  width: number,
  height: number,
  strokes: readonly MaskStroke[],
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(transparent)
  if (
    width <= 0
    || height <= 0
    || source.length < width * height * 4
    || output.length < width * height * 4
  ) {
    return output
  }

  const stamp = (
    centerX: number,
    centerY: number,
    radius: number,
    restore: boolean,
  ) => {
    const firstX = Math.max(0, Math.floor(centerX - radius))
    const lastX = Math.min(width - 1, Math.ceil(centerX + radius))
    const firstY = Math.max(0, Math.floor(centerY - radius))
    const lastY = Math.min(height - 1, Math.ceil(centerY + radius))
    const squaredRadius = radius * radius
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        const deltaX = x + 0.5 - centerX
        const deltaY = y + 0.5 - centerY
        if (deltaX * deltaX + deltaY * deltaY > squaredRadius)
          continue
        const alphaOffset = (y * width + x) * 4 + 3
        output[alphaOffset] = restore ? source[alphaOffset]! : 0
      }
    }
  }

  for (const stroke of strokes) {
    const radius = Math.max(0.5, stroke.brushSize / 2)
    const restore = stroke.mode === 'erase'
    for (let index = 0; index < stroke.points.length; index += 1) {
      const point = stroke.points[index]!
      const previous = stroke.points[index - 1] ?? point
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)))
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps
        stamp(
          previous.x + (point.x - previous.x) * progress,
          previous.y + (point.y - previous.y) * progress,
          radius,
          restore,
        )
      }
    }
  }
  return output
}

interface Rgb { r: number, g: number, b: number }

/** 16進数の色指定をRGB成分へ変換する。 */
function parseHexColor(value: string | null | undefined): Rgb | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value ?? '')
  if (!match)
    return null
  return {
    r: Number.parseInt(match[1]!, 16),
    g: Number.parseInt(match[2]!, 16),
    b: Number.parseInt(match[3]!, 16),
  }
}

/** 値を指定された上下限の範囲へ収める。 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** RGB成分の差から二色の距離を計算する。 */
function colorDistance(red: number, green: number, blue: number, color: Rgb) {
  return Math.hypot(red - color.r, green - color.g, blue - color.b)
}

/** 画像外周の画素から透過対象の背景色を推定する。 */
function estimateBorderColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Rgb {
  const buckets = new Map<
    string,
    { count: number, r: number, g: number, b: number }
  >()
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4
    if (pixels[offset + 3] === 0)
      return
    const r = pixels[offset]!
    const g = pixels[offset + 1]!
    const b = pixels[offset + 2]!
    const key = `${r >> 4},${g >> 4},${b >> 4}`
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }

  for (let x = 0; x < width; x += 1) {
    add(x, 0)
    if (height > 1)
      add(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y)
    if (width > 1)
      add(width - 1, y)
  }

  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0]
  if (!dominant)
    return { r: 0, g: 0, b: 0 }
  return {
    r: dominant.r / dominant.count,
    g: dominant.g / dominant.count,
    b: dominant.b / dominant.count,
  }
}

/** 外周からつながる背景色だけを透過し、アイコン内部の同色部分まで消えるのを防ぐ。 */
export function removeConnectedBackground(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: AssetTransparencyOptions,
): Uint8ClampedArray {
  if (width <= 0 || height <= 0 || source.length < width * height * 4) {
    return new Uint8ClampedArray(source)
  }

  const output = new Uint8ClampedArray(source)
  const background
    = parseHexColor(options.backgroundColor)
      ?? estimateBorderColor(source, width, height)
  const threshold = clamp(options.threshold, 0, 255)
  const feather = clamp(options.feather, 0, 100)
  const maximumDistance = threshold + feather
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (index: number) => {
    if (visited[index])
      return
    const offset = index * 4
    if (
      colorDistance(
        source[offset]!,
        source[offset + 1]!,
        source[offset + 2]!,
        background,
      ) > maximumDistance
    ) {
      return
    }
    visited[index] = 1
    queue[tail++] = index
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (head < tail) {
    const index = queue[head++]!
    const x = index % width
    const y = Math.floor(index / width)
    const offset = index * 4
    const distance = colorDistance(
      source[offset]!,
      source[offset + 1]!,
      source[offset + 2]!,
      background,
    )
    const opacity
      = feather === 0 ? 0 : clamp((distance - threshold) / feather, 0, 1)
    output[offset + 3] = Math.round(source[offset + 3]! * opacity)

    if (x > 0)
      enqueue(index - 1)
    if (x + 1 < width)
      enqueue(index + 1)
    if (y > 0)
      enqueue(index - width)
    if (y + 1 < height)
      enqueue(index + width)
  }

  return output
}

/** 画像を切り出し、背景透過が有効なら透過処理と手動ブラシも適用する。プレビューと登録画像で共用する。 */
export function renderAssetCrop(
  image: CanvasImageSource,
  bounds: { x: number, y: number, width: number, height: number },
  removeBackground: boolean,
  options: AssetTransparencyOptions,
  manualStrokes: readonly MaskStroke[] = [],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.width))
  canvas.height = Math.max(1, Math.round(bounds.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return canvas
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  if (!removeBackground)
    return canvas
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const source = new Uint8ClampedArray(imageData.data)
  imageData.data.set(
    applyAssetTransparencyStrokes(
      source,
      removeConnectedBackground(
        source,
        canvas.width,
        canvas.height,
        options,
      ),
      canvas.width,
      canvas.height,
      manualStrokes,
    ),
  )
  context.putImageData(imageData, 0, 0)
  return canvas
}
