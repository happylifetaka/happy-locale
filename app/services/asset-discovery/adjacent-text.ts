import type { RegionDraft } from '~/types/editor'

/** ほぼ枠外にある本文字形を巻き込む端だけを詰める。検出の核は切り捨てない。 */
export function avoidAdjacentText(bounds: RegionDraft, seed: RegionDraft, glyphs: readonly RegionDraft[]): RegionDraft {
  let left = bounds.x
  let right = bounds.x + bounds.width
  for (const glyph of glyphs) {
    if (glyph.y >= bounds.y + bounds.height || glyph.y + glyph.height <= bounds.y)
      continue
    const glyphRight = glyph.x + glyph.width
    const center = glyph.x + glyph.width / 2
    if (center < bounds.x && glyphRight >= left && glyphRight < seed.x)
      left = Math.max(left, Math.min(seed.x, glyphRight + 1))
    if (center > bounds.x + bounds.width && glyph.x <= right && glyph.x > seed.x + seed.width)
      right = Math.min(right, Math.max(seed.x + seed.width, glyph.x - 1))
  }
  return { x: left, y: bounds.y, width: right - left, height: bounds.height }
}
