import type { TextRegion } from '~/types/editor'

/** 未指定時は領域高さの半分と通常フォントサイズの小さい方をルビの上限にする。 */
export function rubyFontSize(region: TextRegion) {
  return region.rubyFontSize ?? Math.max(1, Math.min(region.fontSize, Math.round(region.height * 0.5)))
}

/** Keep the OCR bounds intact: recognition, icons and background masks still refer to the source. */
export function rubyDisplayRegion(region: TextRegion): TextRegion {
  if (!region.ruby)
    return region
  const fontSize = rubyFontSize(region)
  // 原文の画素位置は推定せず、領域上端を基準にする。負の間隔は領域内への重なりを許す。
  const gap = region.rubyGap ?? 0
  const height = Math.min(Math.max(0, region.y - gap), Math.ceil(fontSize * 1.25) + region.textStrokeWidth * 2)
  return {
    ...region,
    y: Math.max(0, region.y - gap - height),
    height,
    fontSize,
    // 本文の自動調整設定を保持したまま、ルビの描画時だけ一行に収まるよう縮小する。
    autoFitFontSize: true,
    backgroundMode: 'none',
    exclusionAreas: [],
    verticalAlign: 'bottom',
  }
}
