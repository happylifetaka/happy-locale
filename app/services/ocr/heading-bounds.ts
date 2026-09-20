import type { OCRTextBlock } from '~/types/ocr'

/** 帯の中央から文字の高さを測り、彩色された両端の装飾を除く。 */
export function headingLetterBounds(data: Uint8ClampedArray, width: number, height: number): { left: number, right: number, top: number, bottom: number } | null {
  if (width < 20 || height < 8 || data.length !== width * height * 4)
    return null
  const left = Math.floor(width * 0.25)
  const right = Math.ceil(width * 0.75)
  const isInk = (x: number, y: number) => {
    const i = (y * width + x) * 4
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    return r * 0.299 + g * 0.587 + b * 0.114 < 110 && Math.max(r, g, b) - Math.min(r, g, b) <= 60
  }
  const bands: { top: number, bottom: number }[] = []
  for (let y = 0; y < height; y++) {
    let ink = 0
    let light = 0
    for (let x = left; x < right; x++) {
      if (isInk(x, y))
        ink++
      const i = (y * width + x) * 4
      if (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114 >= 150)
        light++
    }
    if (ink < (right - left) * 0.12 || ink > (right - left) * 0.75 || light < (right - left) * 0.25)
      continue
    const previous = bands.at(-1)
    if (previous && y - previous.bottom <= 1)
      previous.bottom = y + 1
    else bands.push({ top: y, bottom: y + 1 })
  }
  const substantial = bands.filter(b => b.bottom - b.top >= height * 0.3)
  if (substantial.length !== 1)
    return null
  const band = substantial[0]!
  if (band.top > height * 0.55 || band.bottom < height * 0.45)
    return null
  const h = band.bottom - band.top
  const groups: { left: number, right: number }[] = []
  for (let x = 0; x < width; x++) {
    let ink = 0
    let light = 0
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114 >= 150)
        light++
    }
    for (let y = band.top; y < band.bottom; y++) {
      if (isInk(x, y))
        ink++
    }
    if (ink < Math.max(2, h * 0.15) || light < h * 0.2)
      continue
    const previous = groups.at(-1)
    if (previous && x - previous.right <= h * 0.65)
      previous.right = x + 1
    else groups.push({ left: x, right: x + 1 })
  }
  const main = groups.find(g => g.left < width / 2 && g.right > width / 2 && g.right - g.left >= width * 0.25)
  if (!main || groups.some(g => g !== main && g.right - g.left >= h * 0.8))
    return null
  return { left: Math.max(0, main.left - 1), right: Math.min(width, main.right + 1), top: Math.max(0, band.top - 1), bottom: Math.min(height, band.bottom + 1) }
}

/** 明るい帯の黒文字について、文字行と離れた上下の罫線だけを除く。曖昧なら元の枠を使う。 */
export function headingInkRows(data: Uint8ClampedArray, width: number, height: number): { top: number, bottom: number } | null {
  if (width < 10 || height < 8 || data.length !== width * height * 4)
    return null
  const luminance = Array.from({ length: width * height }, (_, index) =>
    data[index * 4]! * 0.299 + data[index * 4 + 1]! * 0.587 + data[index * 4 + 2]! * 0.114)
  const sorted = [...luminance].sort((a, b) => a - b)
  const dark = sorted[Math.floor(sorted.length * 0.2)]!
  const light = sorted[Math.floor(sorted.length * 0.8)]!
  if (light < 140 || light - dark < 60)
    return null
  const threshold = dark + (light - dark) * 0.35
  const runs: { top: number, bottom: number }[] = []
  for (let y = 0; y < height; y++) {
    let ink = 0
    for (let x = 0; x < width; x++) {
      if (luminance[y * width + x]! < threshold)
        ink++
    }
    if (ink < width * 0.1 || ink > width * 0.8)
      continue
    const previous = runs.at(-1)
    if (previous?.bottom === y)
      previous.bottom = y + 1
    else runs.push({ top: y, bottom: y + 1 })
  }
  const bands = runs.filter(run => run.bottom - run.top >= height * 0.4)
  if (bands.length !== 1)
    return null
  const band = bands[0]!
  if (band.top > height * 0.5 || band.bottom < height * 0.5
    || band.bottom - band.top > height * 0.9) {
    return null
  }
  return { top: Math.max(0, band.top - 1), bottom: Math.min(height, band.bottom + 1) }
}

/** 文字行内の暗い低彩度の画素を使い、端に孤立した小さい飾りを文字列から分離する。 */
export function headingInkColumns(data: Uint8ClampedArray, width: number, height: number, rows: { top: number, bottom: number }): { left: number, right: number } | null {
  if (data.length !== width * height * 4 || rows.top < 0 || rows.bottom > height || rows.bottom <= rows.top)
    return null
  const lineHeight = rows.bottom - rows.top
  const groups: { left: number, right: number }[] = []
  for (let x = 0; x < width; x++) {
    let ink = 0
    for (let y = rows.top; y < rows.bottom; y++) {
      const offset = (y * width + x) * 4
      const r = data[offset]!
      const g = data[offset + 1]!
      const b = data[offset + 2]!
      if (r * 0.299 + g * 0.587 + b * 0.114 < 110 && Math.max(r, g, b) - Math.min(r, g, b) <= 60)
        ink++
    }
    if (ink < Math.max(2, lineHeight * 0.15))
      continue
    const previous = groups.at(-1)
    if (previous && x - previous.right <= lineHeight * 0.6)
      previous.right = x + 1
    else groups.push({ left: x, right: x + 1 })
  }
  const main = groups.find(group => group.right - group.left >= width * 0.65)
  if (!main || main.left > width / 2 || main.right < width / 2
    || groups.some(group => group !== main && group.right - group.left >= lineHeight * 0.8)) {
    return null
  }
  return { left: Math.max(0, main.left - 1), right: Math.min(width, main.right + 1) }
}

/** 装飾を外せた見出しのみ、原画像の小さい切り抜きを使って文字の枠を補正する。 */
export function refineHeadingImageBounds(image: CanvasImageSource, bounds: OCRTextBlock, scale: number): OCRTextBlock {
  if (typeof document === 'undefined')
    return bounds
  const width = Math.ceil(bounds.width / scale)
  const height = Math.ceil(bounds.height / scale)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 10 || height < 8 || width > 2048 || height > 256)
    return bounds
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return bounds
  try {
    context.drawImage(image, bounds.x / scale, bounds.y / scale, bounds.width / scale, bounds.height / scale, 0, 0, width, height)
    const data = context.getImageData(0, 0, width, height).data
    const letters = headingLetterBounds(data, width, height)
    if (letters) {
      return {
        ...bounds,
        x: bounds.x + letters.left * bounds.width / width,
        y: bounds.y + letters.top * bounds.height / height,
        width: (letters.right - letters.left) * bounds.width / width,
        height: (letters.bottom - letters.top) * bounds.height / height,
      }
    }
    const rows = headingInkRows(data, width, height)
    if (!rows)
      return bounds
    const ratio = bounds.height / height
    const columns = headingInkColumns(data, width, height, rows)
    return {
      ...bounds,
      y: bounds.y + rows.top * ratio,
      height: (rows.bottom - rows.top) * ratio,
      ...(columns ? { x: bounds.x + columns.left * bounds.width / width, width: (columns.right - columns.left) * bounds.width / width } : {}),
    }
  }
  catch {
    // 読めないCanvasや非対応環境でも単語座標の候補は残す。
    return bounds
  }
}
