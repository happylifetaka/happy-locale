export type PixelSource = Pick<CanvasRenderingContext2D, 'getImageData'>

type RGB = [number, number, number]
export type AutomaticMaskPreset = 'auto' | 'light' | 'dark'

export interface RegionBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskStroke {
  brushSize: number
  points: { x: number, y: number }[]
  mode?: 'paint' | 'erase'
}

/** Builds a translucent color overlay for inspecting a generated mask. */
export function createMaskPreview(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  color: RGB = [239, 68, 68],
  maximumAlpha = 170,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  const pixelCount = Math.min(mask.length, width * height)
  for (let index = 0; index < pixelCount; index += 1) {
    const dataIndex = index * 4
    data[dataIndex] = color[0]
    data[dataIndex + 1] = color[1]
    data[dataIndex + 2] = color[2]
    data[dataIndex + 3] = Math.round((mask[index]! / 255) * maximumAlpha)
  }
  return new ImageData(data, width, height)
}

/** 昇順の中央要素を返す。偶数個なら中央の大きい方、空なら255。 */
function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 255
}

/** 色成分を二桁の16進数へ変換する。 */
function toHex(value: number) {
  return Math.round(value).toString(16).padStart(2, '0')
}

/** 値を指定された上下限の範囲へ収める。 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** 16進数の色指定をRGB成分へ変換する。 */
function parseHexColor(color: string): RGB {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color)
  return match
    ? [
        Number.parseInt(match[1]!, 16),
        Number.parseInt(match[2]!, 16),
        Number.parseInt(match[3]!, 16),
      ]
    : [255, 255, 255]
}

/** 画像端を考慮して指定位置のRGBを取得する。 */
function pixelAt(
  source: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
): RGB {
  const px = clamp(Math.round(x), 0, canvasWidth - 1)
  const py = clamp(Math.round(y), 0, canvasHeight - 1)
  const index = (py * source.width + px) * 4
  return [
    source.data[index] ?? 255,
    source.data[index + 1] ?? 255,
    source.data[index + 2] ?? 255,
  ]
}

/** RGB成分から明るさを計算する。 */
function luminance(color: RGB) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722
}

/** 周辺画素との差から文字らしい輝度・色の変化を測る。 */
function measureLocalContrasts(
  source: ImageData,
  x: number,
  y: number,
  center: RGB,
) {
  const centerLuminance = luminance(center)
  const neighbors: RGB[] = []
  for (const distance of [2, 4]) {
    for (const [offsetX, offsetY] of [
      [-distance, 0],
      [distance, 0],
      [0, -distance],
      [0, distance],
      [-distance, -distance],
      [distance, -distance],
      [-distance, distance],
      [distance, distance],
    ] as const) {
      neighbors.push(
        pixelAt(source, source.width, source.height, x + offsetX, y + offsetY),
      )
    }
  }
  const neighborColor = medianColor(neighbors, center)
  const neighborLuminance = luminance(neighborColor)
  return {
    luminance: Math.abs(centerLuminance - neighborLuminance),
    direction: centerLuminance - neighborLuminance,
    color: colorDistance(center, neighborColor),
  }
}

/** 明暗の変化が指定した文字色プリセットに合うか判定する。 */
function matchesAutomaticMaskPreset(
  direction: number,
  preset: AutomaticMaskPreset,
) {
  return preset === 'auto'
    || (preset === 'light' && direction > 0)
    || (preset === 'dark' && direction < 0)
}

/** 色成分ごとの中央値から代表色を求める。 */
function medianColor(colors: RGB[], fallback: RGB): RGB {
  if (colors.length === 0)
    return fallback
  return [
    median(colors.map(color => color[0])),
    median(colors.map(color => color[1])),
    median(colors.map(color => color[2])),
  ]
}

/** RGB成分の差から二色の距離を計算する。 */
function colorDistance(first: RGB, second: RGB) {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  )
}

/** 明るさだけでなく色成分の構成差を測る。 */
function colorCompositionDistance(first: RGB, second: RGB) {
  const firstTotal = first[0] + first[1] + first[2]
  const secondTotal = second[0] + second[1] + second[2]
  if (firstTotal < 24 || secondTotal < 24)
    return 0
  return (
    Math.hypot(
      first[0] / firstTotal - second[0] / secondTotal,
      first[1] / firstTotal - second[1] / secondTotal,
      first[2] / firstTotal - second[2] / secondTotal,
    ) * 255
  )
}

/** 境界の色が背景推定にどの程度使えるか重みを計算する。 */
function edgeReliability(edge: RGB[], reference: RGB) {
  const representative = medianColor(edge, reference)
  const normalizedDistance = colorDistance(representative, reference) / 48
  return Math.max(0.04, 1 / (1 + normalizedDistance ** 4))
}

/** 採取色と基準色の差から背景推定用の信頼度を求める。 */
function sampleReliability(color: RGB, reference: RGB) {
  const normalizedDistance = colorDistance(color, reference) / 58
  return Math.max(0.015, 1 / (1 + normalizedDistance ** 6))
}

/** 領域の上下境界付近を採取して背景色を求める。 */
function sampleVerticalEdge(
  source: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  edgeY: number,
  direction: -1 | 1,
  sampleDepth: number,
  smoothingRadius: number,
  fallback: RGB,
) {
  const colors: RGB[] = []
  for (
    let offsetX = -smoothingRadius;
    offsetX <= smoothingRadius;
    offsetX += 1
  ) {
    for (let depth = 2; depth <= sampleDepth; depth += 2) {
      colors.push(
        pixelAt(
          source,
          canvasWidth,
          canvasHeight,
          x + offsetX,
          edgeY + direction * depth,
        ),
      )
    }
  }
  return medianColor(colors, fallback)
}

/** 領域の左右境界付近を採取して背景色を求める。 */
function sampleHorizontalEdge(
  source: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  edgeX: number,
  y: number,
  direction: -1 | 1,
  sampleDepth: number,
  smoothingRadius: number,
  fallback: RGB,
) {
  const colors: RGB[] = []
  for (
    let offsetY = -smoothingRadius;
    offsetY <= smoothingRadius;
    offsetY += 1
  ) {
    for (let depth = 2; depth <= sampleDepth; depth += 2) {
      colors.push(
        pixelAt(
          source,
          canvasWidth,
          canvasHeight,
          edgeX + direction * depth,
          y + offsetY,
        ),
      )
    }
  }
  return medianColor(colors, fallback)
}

/** 背景補修へ加える座標依存の小さな揺らぎを生成する。 */
function noiseAt(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return (value - Math.floor(value) - 0.5) * 2
}

/**
 * Builds a lightweight inpainted patch from all four outer edges.
 * Color changes are interpolated across the region and subtle deterministic
 * texture is added so the result does not look like a flat color rectangle.
 */
export function createBlendedBackground(
  source: ImageData,
  canvasWidth: number,
  canvasHeight: number,
  bounds: RegionBounds,
  fallbackColor: string,
): ImageData {
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const startX = Math.round(bounds.x)
  const startY = Math.round(bounds.y)
  const data = new Uint8ClampedArray(width * height * 4)
  const fallback = parseHexColor(fallbackColor)
  const sampleDepth = Math.max(
    4,
    Math.min(14, Math.round(Math.min(width, height) * 0.12)),
  )
  const smoothingRadius = Math.max(
    2,
    Math.min(8, Math.round(Math.min(width, height) * 0.06)),
  )

  const top = Array.from({ length: width }, (_, x) =>
    sampleVerticalEdge(
      source,
      canvasWidth,
      canvasHeight,
      startX + x,
      startY,
      -1,
      sampleDepth,
      smoothingRadius,
      fallback,
    ))
  const bottom = Array.from({ length: width }, (_, x) =>
    sampleVerticalEdge(
      source,
      canvasWidth,
      canvasHeight,
      startX + x,
      startY + height - 1,
      1,
      sampleDepth,
      smoothingRadius,
      fallback,
    ))
  const left = Array.from({ length: height }, (_, y) =>
    sampleHorizontalEdge(
      source,
      canvasWidth,
      canvasHeight,
      startX,
      startY + y,
      -1,
      sampleDepth,
      smoothingRadius,
      fallback,
    ))
  const right = Array.from({ length: height }, (_, y) =>
    sampleHorizontalEdge(
      source,
      canvasWidth,
      canvasHeight,
      startX + width - 1,
      startY + y,
      1,
      sampleDepth,
      smoothingRadius,
      fallback,
    ))

  const edgeColors = [...top, ...bottom, ...left, ...right]
  const referenceColor = medianColor(edgeColors, fallback)
  const topReliability = edgeReliability(top, referenceColor)
  const bottomReliability = edgeReliability(bottom, referenceColor)
  const leftReliability = edgeReliability(left, referenceColor)
  const rightReliability = edgeReliability(right, referenceColor)
  const brightness = edgeColors.map(
    color => (color[0] + color[1] + color[2]) / 3,
  )
  const mean
    = brightness.reduce((sum, value) => sum + value, 0) / brightness.length
  const deviation = Math.sqrt(
    brightness.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / brightness.length,
  )
  const textureAmount = Math.min(10, Math.max(1.5, deviation * 0.22))

  for (let y = 0; y < height; y += 1) {
    const verticalRatio = height === 1 ? 0.5 : y / (height - 1)
    for (let x = 0; x < width; x += 1) {
      const horizontalRatio = width === 1 ? 0.5 : x / (width - 1)
      const index = (y * width + x) * 4
      const topColor = top[x] ?? referenceColor
      const bottomColor = bottom[x] ?? referenceColor
      const leftColor = left[y] ?? referenceColor
      const rightColor = right[y] ?? referenceColor
      const weights = [
        (1 - verticalRatio)
        * topReliability
        * sampleReliability(topColor, referenceColor),
        verticalRatio
        * bottomReliability
        * sampleReliability(bottomColor, referenceColor),
        (1 - horizontalRatio)
        * leftReliability
        * sampleReliability(leftColor, referenceColor),
        horizontalRatio
        * rightReliability
        * sampleReliability(rightColor, referenceColor),
      ]
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
      const noise = noiseAt(startX + x, startY + y) * textureAmount
      for (let channel = 0; channel < 3; channel += 1) {
        const reconstructed
          = (topColor[channel]! * weights[0]!
            + bottomColor[channel]! * weights[1]!
            + leftColor[channel]! * weights[2]!
            + rightColor[channel]! * weights[3]!)
          / weightTotal
        data[index + channel] = clamp(reconstructed + noise, 0, 255)
      }
      data[index + 3] = 255
    }
  }

  return new ImageData(data, width, height)
}

/** マスクの境界をぼかして元画像との接続を滑らかにする。 */
function blurMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  const output = new Uint8ClampedArray(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let count = 0
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = x + offsetX
          const sampleY = y + offsetY
          if (
            sampleX < 0
            || sampleX >= width
            || sampleY < 0
            || sampleY >= height
          ) {
            continue
          }
          sum += mask[sampleY * width + sampleX] ?? 0
          count += 1
        }
      }
      output[y * width + x] = sum / count
    }
  }
  return output
}

/** 検出したマスクを周囲へ広げて文字の縁も消去対象にする。 */
function dilateMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  const output = new Uint8ClampedArray(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (
        let offsetY = -radius;
        offsetY <= radius && value === 0;
        offsetY += 1
      ) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = x + offsetX
          const sampleY = y + offsetY
          if (
            sampleX >= 0
            && sampleX < width
            && sampleY >= 0
            && sampleY < height
            && (mask[sampleY * width + sampleX] ?? 0) > 0
          ) {
            value = 255
            break
          }
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

/** Detects high-contrast foreground pixels, then expands and feathers the mask. */
export function createAutomaticTextMask(
  source: ImageData,
  patch: ImageData,
  bounds: RegionBounds,
  sensitivity = 60,
  removeColorOutliers = true,
  preset: AutomaticMaskPreset = 'auto',
) {
  const width = patch.width
  const height = patch.height
  const startX = Math.round(bounds.x)
  const startY = Math.round(bounds.y)
  const mask = new Uint8ClampedArray(width * height)
  const differences: number[] = []
  const luminanceDifferences: number[] = []
  const localContrasts: number[] = []
  const localContrastDirections: number[] = []
  const localColorContrasts: number[] = []
  const sourceColors: RGB[] = []
  const patchColors: RGB[] = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceColor = pixelAt(
        source,
        source.width,
        source.height,
        startX + x,
        startY + y,
      )
      const index = (y * width + x) * 4
      const patchColor: RGB = [
        patch.data[index] ?? 0,
        patch.data[index + 1] ?? 0,
        patch.data[index + 2] ?? 0,
      ]
      const red = sourceColor[0] - patchColor[0]
      const green = sourceColor[1] - patchColor[1]
      const blue = sourceColor[2] - patchColor[2]
      sourceColors.push(sourceColor)
      patchColors.push(patchColor)
      differences.push(Math.sqrt(red * red + green * green + blue * blue))
      luminanceDifferences.push(red * 0.2126 + green * 0.7152 + blue * 0.0722)
      const contrast = measureLocalContrasts(
        source,
        startX + x,
        startY + y,
        sourceColor,
      )
      localContrasts.push(contrast.luminance)
      localContrastDirections.push(contrast.direction)
      localColorContrasts.push(contrast.color)
    }
  }

  const sorted = differences.toSorted((a, b) => a - b)
  const typicalDifference = sorted[Math.floor(sorted.length * 0.7)] ?? 0
  const normalizedSensitivity = clamp(sensitivity, 0, 100) / 100
  const thresholdFactor = 2.15 - normalizedSensitivity * 1.05
  const threshold = Math.max(26, typicalDifference * thresholdFactor)
  const darkThreshold = Math.max(14, threshold * 0.58)
  const detailThreshold = 20 - normalizedSensitivity * 8
  const colorDetailThreshold = 52 - normalizedSensitivity * 14
  const dominantBackgroundColor = medianColor(patchColors, [255, 255, 255])
  const dominantSourceColor = medianColor(sourceColors, dominantBackgroundColor)
  const backgroundColorSpread = patchColors
    .map(color => colorCompositionDistance(color, dominantBackgroundColor))
    .toSorted((a, b) => a - b)
  const typicalColorSpread
    = backgroundColorSpread[Math.floor(backgroundColorSpread.length * 0.9)] ?? 0
  const dominantColorThreshold = Math.max(
    colorDetailThreshold,
    typicalColorSpread * 1.6,
  )
  differences.forEach((difference, index) => {
    const luminanceDifference = luminanceDifferences[index] ?? 0
    const localLuminanceContrast = localContrasts[index] ?? 0
    const localContrastDirection = localContrastDirections[index] ?? 0
    const localColorContrast = localColorContrasts[index] ?? 0
    const dominantColorContrast = colorCompositionDistance(
      sourceColors[index] ?? dominantBackgroundColor,
      dominantBackgroundColor,
    )
    const sourceMajorityContrast = colorCompositionDistance(
      sourceColors[index] ?? dominantSourceColor,
      dominantSourceColor,
    )
    const isChromaticOutlier
      = (dominantColorContrast >= dominantColorThreshold
        && sourceMajorityContrast >= colorDetailThreshold)
      || (localColorContrast >= colorDetailThreshold
        && localColorContrast >= localLuminanceContrast * 2 + 18)
    const isDarkForeground
      = luminanceDifference < -darkThreshold && difference >= darkThreshold
    const differsFromBackground = difference >= threshold || isDarkForeground
    const isLuminanceForeground
      = matchesAutomaticMaskPreset(localContrastDirection, preset)
        && !isChromaticOutlier
        && differsFromBackground
        && localLuminanceContrast >= detailThreshold
    const isColorForeground
      = matchesAutomaticMaskPreset(localContrastDirection, preset)
        && removeColorOutliers
        && isChromaticOutlier
        && difference >= colorDetailThreshold
    mask[index] = isLuminanceForeground || isColorForeground ? 255 : 0
  })

  const expansionRadius = Math.round(2 + normalizedSensitivity * 2)
  return blurMask(
    dilateMask(mask, width, height, expansionRadius),
    width,
    height,
    2,
  )
}

/** マスクへ一つの円形ブラシ跡を描く。 */
function paintCircle(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  value: 0 | 255,
) {
  const left = Math.max(0, Math.floor(centerX - radius))
  const right = Math.min(width - 1, Math.ceil(centerX + radius))
  const top = Math.max(0, Math.floor(centerY - radius))
  const bottom = Math.min(height - 1, Math.ceil(centerY + radius))
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        mask[y * width + x] = value
      }
    }
  }
}

/** 保存された一筆ごとの軌跡から消去用のマスクを作る。 */
export function createManualMask(
  width: number,
  height: number,
  strokes: MaskStroke[],
) {
  const mask = new Uint8ClampedArray(width * height)
  for (const stroke of strokes) {
    const radius = Math.max(1, stroke.brushSize / 2)
    const value = stroke.mode === 'erase' ? 0 : 255
    stroke.points.forEach((point, index) => {
      const previous = stroke.points[index - 1] ?? point
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)))
      for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps
        paintCircle(
          mask,
          width,
          height,
          previous.x + (point.x - previous.x) * ratio,
          previous.y + (point.y - previous.y) * ratio,
          radius,
          value,
        )
      }
    })
  }
  return blurMask(mask, width, height, 2)
}

/** Source icons are explicit removal targets; protected areas take precedence. */
// 原文アイコンの範囲も消去対象に加えた後、保護領域を最優先でマスクから除く。
export function createRegionRemovalMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  sourceIcons: readonly RegionBounds[] = [],
  protectedAreas: readonly RegionBounds[] = [],
) {
  const removalMask = new Uint8ClampedArray(mask)
  for (const area of sourceIcons) {
    if (![area.x, area.y, area.width, area.height].every(Number.isFinite)
      || area.width <= 0 || area.height <= 0) {
      continue
    }
    const left = clamp(Math.floor(area.x), 0, width)
    const right = clamp(Math.ceil(area.x + area.width), 0, width)
    const top = clamp(Math.floor(area.y), 0, height)
    const bottom = clamp(Math.ceil(area.y + area.height), 0, height)
    for (let y = top; y < bottom; y += 1)
      removalMask.fill(255, y * width + left, y * width + right)
  }
  return protectMaskAreas(removalMask, width, height, protectedAreas)
}

/** 保護矩形に重なるマスクを消し、その範囲の元画像を残す。 */
export function protectMaskAreas(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  areas: readonly RegionBounds[],
) {
  const protectedMask = new Uint8ClampedArray(mask)
  for (const area of areas) {
    const left = clamp(Math.floor(area.x), 0, width)
    const right = clamp(Math.ceil(area.x + area.width), 0, width)
    const top = clamp(Math.floor(area.y), 0, height)
    const bottom = clamp(Math.ceil(area.y + area.height), 0, height)
    for (let y = top; y < bottom; y += 1) {
      protectedMask.fill(0, y * width + left, y * width + right)
    }
  }
  return protectedMask
}

/** マスクの濃さで元画像と補修背景を混ぜ、消去境界の急な色変化を抑える。 */
export function compositeBackground(
  source: ImageData,
  patch: ImageData,
  bounds: RegionBounds,
  mask: Uint8ClampedArray,
) {
  const data = new Uint8ClampedArray(patch.data.length)
  const startX = Math.round(bounds.x)
  const startY = Math.round(bounds.y)
  for (let y = 0; y < patch.height; y += 1) {
    for (let x = 0; x < patch.width; x += 1) {
      const index = (y * patch.width + x) * 4
      const original = pixelAt(
        source,
        source.width,
        source.height,
        startX + x,
        startY + y,
      )
      const alpha = (mask[y * patch.width + x] ?? 0) / 255
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel]
          = original[channel]! * (1 - alpha)
            + (patch.data[index + channel] ?? 0) * alpha
      }
      data[index + 3] = 255
    }
  }
  return new ImageData(data, patch.width, patch.height)
}

/** 選択範囲の周囲から背景の代表色を求める。 */
export function estimateBackgroundColor(
  context: PixelSource,
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number,
  borderSize = 3,
): string {
  const left = Math.max(0, Math.floor(x) - borderSize)
  const top = Math.max(0, Math.floor(y) - borderSize)
  const right = Math.min(canvasWidth, Math.ceil(x + width) + borderSize)
  const bottom = Math.min(canvasHeight, Math.ceil(y + height) + borderSize)
  const pixels = context.getImageData(left, top, right - left, bottom - top)
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []

  for (let py = 0; py < pixels.height; py += 1) {
    for (let px = 0; px < pixels.width; px += 1) {
      const inside
        = left + px >= x
          && left + px < x + width
          && top + py >= y
          && top + py < y + height
      if (inside)
        continue
      const index = (py * pixels.width + px) * 4
      if ((pixels.data[index + 3] ?? 0) < 128)
        continue
      red.push(pixels.data[index] ?? 255)
      green.push(pixels.data[index + 1] ?? 255)
      blue.push(pixels.data[index + 2] ?? 255)
    }
  }

  return `#${toHex(median(red))}${toHex(median(green))}${toHex(median(blue))}`
}
