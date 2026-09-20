import type { DiscoveredIcon, IconDiscoveryResult, IconDiscoverySettings, MeasuredOCRText } from './types'
import type { PixelRegion } from '~/services/ocr/pixel-regions'
import type { RegionDraft } from '~/types/editor'
import type { OCRTextBlock } from '~/types/ocr'
import { pixelComponents } from '~/services/ocr/pixel-regions'
import { clipBounds, intersectionArea, validBounds } from './geometry'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from './types'

function median(values: number[], fallback: number): number {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? fallback
}

function reliableWord(word: OCRTextBlock): boolean {
  return validBounds(word) && (word.confidence ?? 0) >= 65 && /[a-z]{2}/iu.test(word.text)
}

/** 見出し・数値だけの行は対象外。意味上の「本文」を確定する分類器ではない。 */
function bodyLine(line: OCRTextBlock): boolean {
  const letters = line.text.replace(/[^a-z]/giu, '')
  return validBounds(line) && (line.confidence ?? 0) >= 40 && letters.length >= 3
    && letters.replace(/[^a-z]/gu, '').length / letters.length >= 0.25
}

function padded(rect: RegionDraft, padding: number, width: number, height: number): RegionDraft {
  return clipBounds({ x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 }, width, height)
}

function sizedIcon(c: PixelRegion, typical: number, colored: boolean): boolean {
  return c.width >= typical * (colored ? 0.4 : 0.7) && c.height >= typical * (colored ? 0.6 : 1.25)
    && c.width <= typical * 3 && c.height <= typical * 3
    && c.width / c.height >= 0.25 && c.width / c.height <= 2.5
    && c.area >= typical * typical * 0.15
}

/** 1pxの切れ目を閉じる。文字の高さ計測には使わず、アイコンの外周補完だけに使う。 */
function closeGaps(mask: Uint8Array, width: number, height: number): Uint8Array {
  const expanded = new Uint8Array(mask.length)
  const closed = new Uint8Array(mask.length)
  for (let y = 1; y + 1 < height; y++) {
    for (let x = 1; x + 1 < width; x++) {
      const p = y * width + x
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[p + dy * width + dx])
            expanded[p] = 1
        }
      }
    }
  }
  for (let y = 1; y + 1 < height; y++) {
    for (let x = 1; x + 1 < width; x++) {
      const p = y * width + x
      let filled = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++)
          filled &&= Boolean(expanded[p + dy * width + dx])
      }
      closed[p] = filled ? 1 : 0
    }
  }
  return closed
}

/** 小さな探索範囲単位の純粋処理。ピクセルと実測座標は同じ解像度で渡す。 */
export function extractIconCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  measured: MeasuredOCRText,
  settings: Readonly<IconDiscoverySettings> = DEFAULT_ICON_DISCOVERY_SETTINGS,
): IconDiscoveryResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width * height > 4_000_000 || data.length !== width * height * 4
    || measured.coordinates !== 'image') {
    throw new Error('アイコン抽出の画像・実測座標が不正です。')
  }
  if (!Number.isInteger(settings.maximumCandidates) || settings.maximumCandidates < 1 || settings.maximumCandidates > 1000
    || !Number.isInteger(settings.maximumSearchedPixels) || settings.maximumSearchedPixels < 1 || settings.maximumSearchedPixels > 4_000_000
    || ![settings.minimumColorDifference, settings.minimumContrast].every(n => Number.isFinite(n) && n > 0 && n <= 255)) {
    throw new Error('アイコン抽出の上限・閾値が不正です。')
  }
  const result: IconDiscoveryResult = { icons: [], searchedAreas: [], truncated: false, examinedPixels: 0 }
  // 巨大な入力配列のフィルタ・ソートも有界にする。切り捨てを通知する。
  result.truncated = measured.lines.length > 1000 || measured.words.length > 10000
  const words = measured.words.slice(0, 10000).filter(reliableWord)
  const lines = measured.lines.slice(0, 1000)
  for (const [lineIndex, line] of lines.entries()) {
    if (!bodyLine(line))
      continue
    const parts = words.filter(word => intersectionArea(word, line) / (word.width * word.height) >= 0.5)
    if (parts.length < 2 && !(parts.length === 1 && /\d/u.test(line.text)))
      continue
    let typical = median(parts.map(word => word.height), line.height)
    if (typical < 5 || typical > height * 0.3)
      continue
    // OCR枠がアイコンを含まず行末で止まっていても、文字高に応じた近傍を探索する。
    const area = padded(line, typical * 0.8, width, height)
    if (!validBounds(area))
      continue
    const pixelCount = area.width * area.height
    if (result.examinedPixels + pixelCount > settings.maximumSearchedPixels) {
      result.truncated = true
      break
    }
    result.examinedPixels += pixelCount
    result.searchedAreas.push(area)
    const edge: number[][] = [[], [], []]
    for (let x = area.x; x < area.x + area.width; x += 3) {
      for (const y of [area.y, area.y + area.height - 1]) {
        const offset = (y * width + x) * 4
        if (data[offset + 3]! < 128)
          continue
        for (let channel = 0; channel < 3; channel++)
          edge[channel]!.push(data[offset + channel]!)
      }
    }
    const background = edge.map(channel => median(channel, 0))
    const backgroundLight = background[0]! * 0.299 + background[1]! * 0.587 + background[2]! * 0.114
    const colored = new Uint8Array(pixelCount)
    const contrast = new Uint8Array(pixelCount)
    const outer = new Uint8Array(pixelCount)
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const offset = ((y + area.y) * width + x + area.x) * 4
        if (data[offset + 3]! < 128)
          continue
        const r = data[offset]!
        const g = data[offset + 1]!
        const b = data[offset + 2]!
        const saturation = Math.max(r, g, b) - Math.min(r, g, b)
        const distance = Math.max(Math.abs(r - background[0]!), Math.abs(g - background[1]!), Math.abs(b - background[2]!))
        const light = r * 0.299 + g * 0.587 + b * 0.114
        const p = y * area.width + x
        if (saturation >= settings.minimumColorDifference && distance >= settings.minimumContrast && light > 35)
          colored[p] = 1
        if (Math.abs(light - backgroundLight) >= settings.minimumContrast)
          contrast[p] = 1
        if (distance >= settings.minimumContrast * 0.55)
          outer[p] = 1
      }
    }
    const contrastParts = pixelComponents(contrast, area.width, area.height)
    // Tesseractが全単語に行全体の高さを返す場合にも、文字の実際の画素高を使う。
    // 信頼できる単語内の字形だけで計測し、装飾や誤認識した単一記号は基準にしない。
    const glyphs = contrastParts.filter(c => c.height >= 5 && c.width >= 2 && c.width <= c.height * 1.5
      && c.height <= typical * 1.5 && c.area >= c.height
      && parts.some(word => intersectionArea({ ...c, x: c.x + area.x, y: c.y + area.y }, word) / (c.width * c.height) >= 0.8))
    if (glyphs.length >= 4) {
      const heights = glyphs.map(c => c.height).sort((a, b) => a - b)
      typical = heights[Math.floor(heights.length * 0.75)]!
    }
    if (typical < 5 || typical > height * 0.1)
      continue
    const center = glyphs.length >= 4
      ? median(glyphs.map(c => area.y + c.y + c.height / 2), line.y + line.height / 2)
      : median(parts.map(word => word.y + word.height / 2), line.y + line.height / 2)
    const outline = [
      ...pixelComponents(closeGaps(contrast.map((pixel, p) => pixel || colored[p]!), area.width, area.height), area.width, area.height),
      ...pixelComponents(closeGaps(outer, area.width, area.height), area.width, area.height),
    ]
    const protectedWords = measured.words.slice(0, 10000).filter(word => reliableWord(word)
      || (validBounds(word) && (word.confidence ?? 0) >= 35 && /[a-z]{2}/iu.test(word.text) && word.width >= typical * 1.5))
    for (const [mask, reason] of [[colored, 'colored-component'], [contrast, 'contrast-component']] as const) {
      const components = reason === 'contrast-component' ? contrastParts : pixelComponents(mask, area.width, area.height)
      for (const component of components) {
        if (!sizedIcon(component, typical, reason === 'colored-component'))
          continue
        let bounds: RegionDraft = { ...component, x: component.x + area.x, y: component.y + area.y }
        if (bounds.y + bounds.height <= center - typical * 0.4 || bounds.y >= center + typical * 0.4)
          continue
        // 色の付いた中心だけでなく、その中心を囲む明暗輪郭が孤立していれば回収する。
        const enclosing = outline.filter(c => sizedIcon(c, typical, true)
          && intersectionArea(c, component) / (component.width * component.height) >= 0.8
          && c.width * c.height <= component.width * component.height * 12)
          .sort((a, b) => b.area - a.area)[0]
        if (enclosing)
          bounds = { x: enclosing.x + area.x, y: enclosing.y + area.y, width: enclosing.width, height: enclosing.height }
        // 高信頼度の通常単語を切り抜きに含めない。単一の誤認識記号はここで除外しない。
        if (protectedWords.some(word => intersectionArea(bounds, word) / (bounds.width * bounds.height) > 0.2))
          continue
        const candidate: DiscoveredIcon = { bounds: padded(bounds, Math.max(1, typical * 0.06), width, height), reason, lineIndex }
        const duplicate = result.icons.find(icon => intersectionArea(icon.bounds, candidate.bounds)
          / Math.min(icon.bounds.width * icon.bounds.height, candidate.bounds.width * candidate.bounds.height) >= 0.3)
        if (duplicate) {
          const left = Math.min(duplicate.bounds.x, candidate.bounds.x)
          const top = Math.min(duplicate.bounds.y, candidate.bounds.y)
          const combined = {
            x: left,
            y: top,
            width: Math.max(duplicate.bounds.x + duplicate.bounds.width, candidate.bounds.x + candidate.bounds.width) - left,
            height: Math.max(duplicate.bounds.y + duplicate.bounds.height, candidate.bounds.y + candidate.bounds.height) - top,
          }
          if (combined.width <= typical * 3 && combined.height <= typical * 3
            && !protectedWords.some(word => intersectionArea(combined, word) / (combined.width * combined.height) > 0.2)) {
            duplicate.bounds = combined
            continue
          }
        }
        if (result.icons.length >= settings.maximumCandidates) {
          result.truncated = true
          return result
        }
        result.icons.push(candidate)
      }
    }
  }
  result.icons.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
  return result
}
