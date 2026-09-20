import type { OCRTextBlock } from '~/types/ocr'
import { DEFAULT_REGION_DETECTION_SETTINGS } from './detection-settings'

export interface PixelRegion { x: number, y: number, width: number, height: number, area: number }

/** 4近傍の連結成分。入力画像を変更しない。 */
export function pixelComponents(mask: Uint8Array, width: number, height: number): PixelRegion[] {
  if (mask.length !== width * height)
    return []
  const seen = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const regions: PixelRegion[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start])
      continue
    let head = 0
    let tail = 1
    queue[0] = start
    seen[start] = 1
    let left = width
    let right = 0
    let top = height
    let bottom = 0
    while (head < tail) {
      const p = queue[head++]!
      const x = p % width
      const y = Math.floor(p / width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      for (const n of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1
          queue[tail++] = n
        }
      }
    }
    if (tail >= 3)
      regions.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1, area: tail })
  }
  return regions
}

export function findLightLabels(data: Uint8ClampedArray, width: number, height: number, settings = DEFAULT_REGION_DETECTION_SETTINGS.lightLabels): PixelRegion[] {
  if (!settings.enabled || data.length !== width * height * 4)
    return []
  const mask = new Uint8Array(width * height)
  for (let p = 0; p < mask.length; p++) {
    const r = data[p * 4]!
    const g = data[p * 4 + 1]!
    const b = data[p * 4 + 2]!
    if (r * 0.299 + g * 0.587 + b * 0.114 > settings.minimumLuminance && Math.max(r, g, b) - Math.min(r, g, b) < settings.maximumSaturation)
      mask[p] = 1
  }
  return pixelComponents(mask, width, height).filter(c => c.width >= width * settings.minimumWidthRatio
    && c.height >= height * settings.minimumHeightRatio && c.height <= height * settings.maximumHeightRatio
    && c.width / c.height >= settings.minimumAspectRatio && c.width / c.height <= settings.maximumAspectRatio
    && c.area / (c.width * c.height) >= settings.minimumFillRatio).sort((a, b) => a.y - b.y)
}

/** 暗い地の明るい文字と、本文中の色付きアイコンを別々に測る。 */
export function createTextPixelRefiner(data: Uint8ClampedArray, width: number, height: number, scale: number, words: readonly OCRTextBlock[], settings = DEFAULT_REGION_DETECTION_SETTINGS.textPixels): (block: OCRTextBlock) => OCRTextBlock {
  if (!settings.enabled || data.length !== width * height * 4)
    return b => b
  const bright = new Uint8Array(width * height)
  const colored = new Uint8Array(width * height)
  for (let p = 0; p < bright.length; p++) {
    const r = data[p * 4]!
    const g = data[p * 4 + 1]!
    const b = data[p * 4 + 2]!
    const saturation = Math.max(r, g, b) - Math.min(r, g, b)
    const luminance = r * 0.299 + g * 0.587 + b * 0.114
    if (luminance > settings.minimumLuminance && saturation < settings.maximumSaturation)
      bright[p] = 1
    if (luminance > settings.iconMinimumLuminance && saturation > settings.iconMinimumSaturation)
      colored[p] = 1
  }
  const brightComponents = pixelComponents(bright, width, height)
  const glyphs = brightComponents.filter(c => c.height >= 5 && c.height <= height * 0.09
    && c.width >= 2 && c.width <= c.height * 2.5 && c.area >= c.height * 1.4)
  const icons = pixelComponents(colored, width, height)
  return (block) => {
    if ((block.confidence ?? 0) < 40 || (block.text.match(/[a-z]/giu)?.length ?? 0) < 5)
      return block
    const x = block.x / scale
    const y = block.y / scale
    const w = block.width / scale
    const h = block.height / scale
    const tokens = new Set(block.text.trim().split(/\s+/u))
    const parts = words.filter(word => tokens.has(word.text.trim()) && word.confidence !== null && word.confidence >= 70 && /[a-z]{2}/iu.test(word.text)
      && word.x + word.width / 2 >= block.x && word.x + word.width / 2 <= block.x + block.width
      && word.y + word.height / 2 >= block.y && word.y + word.height / 2 <= block.y + block.height)
    const heights = parts.map(p => p.height / scale).sort((a, b) => a - b)
    const typical = heights[Math.floor(heights.length / 2)] ?? h
    const available = glyphs.filter(c => c.x + c.width / 2 >= x && c.x + c.width / 2 <= x + w
      && c.y + c.height / 2 >= y && c.y + c.height / 2 <= y + h
      && c.height >= typical * 0.25 && c.height <= typical * 1.6)
    const rows: PixelRegion[][] = []
    for (const c of available.sort((a, b) => b.height - a.height)) {
      const row = rows.find(row => Math.abs(row[0]!.y + row[0]!.height / 2 - c.y - c.height / 2) <= Math.max(row[0]!.height, c.height) * 0.4)
      if (row)
        row.push(c)
      else rows.push([c])
    }
    const anchors = parts.filter(p => p.height / scale <= typical * 1.3).map(p => (p.y + p.height / 2) / scale).sort((a, b) => a - b)
    const anchor = anchors.length >= 2 ? anchors[Math.floor(anchors.length / 2)]! : null
    const score = (row: PixelRegion[]) => row.reduce((sum, c) => sum + c.area, 0)
      / (anchor === null ? 1 : 1 + 8 * Math.abs(row[0]!.y + row[0]!.height / 2 - anchor) / typical)
    const row = rows.filter(r => r.length >= 4).sort((a, b) => score(b) - score(a))[0]
    if (!row)
      return block
    let top = Math.min(...row.map(c => c.y))
    let bottom = Math.max(...row.map(c => c.y + c.height))
    let left = Math.min(...row.map(c => c.x))
    let right = Math.max(...row.map(c => c.x + c.width))
    const lineHeight = bottom - top
    if (right - left < w * 0.5 || lineHeight < h * 0.2)
      return block
    // g/yなど基準線より下に出る字形も、同じ行に重なるものは回収する。
    for (const c of available) {
      if (c.y < bottom && c.y + c.height > top && c.y >= top - lineHeight * 0.25
        && c.y + c.height <= bottom + lineHeight * 0.5
        && c.x >= left - lineHeight && c.x <= right + lineHeight) {
        left = Math.min(left, c.x)
        right = Math.max(right, c.x + c.width)
        top = Math.min(top, c.y)
        bottom = Math.max(bottom, c.y + c.height)
      }
    }
    // 連結した字形や暗い縁取りで端の文字が画素成分から落ちても、確かな単語幅は切らない。
    for (const word of parts) {
      if (word.height / scale <= lineHeight * 1.7
        && Math.abs((word.y + word.height / 2) / scale - (top + bottom) / 2) <= lineHeight * 0.5) {
        left = Math.min(left, word.x / scale)
        right = Math.max(right, (word.x + word.width) / scale)
      }
    }
    // 記号として認識された本文内アイコンの座標を保護する。
    const letters = block.text.replace(/[^a-z]/giu, '')
    const uppercaseLabel = letters.length > 0 && letters.replace(/[^A-Z]/gu, '').length / letters.length >= 0.8
    for (const word of words) {
      const wx = word.x / scale
      const wy = word.y / scale
      const ww = word.width / scale
      const wh = word.height / scale
      if (!tokens.has(word.text.trim()) || word.text.replace(/[^a-z]/giu, '').length > 1
        || (uppercaseLabel && /^[«»•·*]+$/u.test(word.text))
        || ww / wh < 0.25 || ww > lineHeight * 2.5 || wh < lineHeight * 0.3 || wh > lineHeight * 2.5
        || wx + ww / 2 < left || wx + ww / 2 > right + lineHeight * 2
        || wy + wh <= top || wy >= bottom) {
        continue
      }
      top = Math.min(top, wy)
      bottom = Math.max(bottom, wy + wh)
      right = Math.max(right, wx + ww)
    }
    for (const c of brightComponents) {
      if (c.width <= lineHeight * 0.3 && c.height <= lineHeight * 0.35 && c.y >= top && c.y + c.height <= bottom + 2
        && c.x >= left - lineHeight * 0.4 && c.x + c.width <= right + lineHeight * 0.6) {
        left = Math.min(left, c.x)
        right = Math.max(right, c.x + c.width)
      }
    }
    // 数字・記号を含む本文では行に隣接するアイコンも保持。横長の飾り線は除く。
    if (/[0-9+*%@{}|]/u.test(block.text)) {
      for (const c of icons) {
        if (c.width < lineHeight * 0.25 || c.height < lineHeight * 0.35 || c.width > lineHeight * 2.5 || c.height > lineHeight * 2.5
          || c.area < lineHeight * lineHeight * 0.12 || c.y + c.height <= top || c.y >= bottom
          || c.x < left - lineHeight || c.x > right + lineHeight) {
          continue
        }
        left = Math.min(left, c.x)
        right = Math.max(right, c.x + c.width)
        top = Math.min(top, c.y)
        bottom = Math.max(bottom, c.y + c.height)
      }
    }
    return { ...block, x: Math.max(0, left - 2) * scale, y: Math.max(0, top - 2) * scale, width: (Math.min(width, right + 2) - Math.max(0, left - 2)) * scale, height: (Math.min(height, bottom + 2) - Math.max(0, top - 2)) * scale }
  }
}
