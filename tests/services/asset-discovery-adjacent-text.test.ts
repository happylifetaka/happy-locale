import { expect, it } from 'vitest'
import { avoidAdjacentText } from '~/services/asset-discovery/adjacent-text'

it('trims only the intruding edges of glyphs mostly outside the crop, symmetrically', () => {
  const bounds = { x: 100, y: 100, width: 50, height: 40 }
  const seed = { x: 110, y: 104, width: 30, height: 32 }
  const glyphs = [{ x: 90, y: 110, width: 12, height: 20 }, { x: 148, y: 110, width: 12, height: 20 }]
  const before = structuredClone({ bounds, seed, glyphs })
  expect(avoidAdjacentText(bounds, seed, glyphs)).toEqual({ x: 103, y: 100, width: 44, height: 40 })
  expect(avoidAdjacentText(bounds, seed, glyphs.toReversed())).toEqual({ x: 103, y: 100, width: 44, height: 40 })
  expect({ bounds, seed, glyphs }).toEqual(before)
})

it('keeps glyphs inside the icon, overlapping the seed, outside the row, or already separated', () => {
  const bounds = { x: 100, y: 100, width: 50, height: 40 }
  const seed = { x: 104, y: 104, width: 42, height: 32 }
  expect(avoidAdjacentText(bounds, seed, [
    { x: 102, y: 110, width: 12, height: 20 },
    { x: 88, y: 110, width: 18, height: 20 },
    { x: 144, y: 110, width: 18, height: 20 },
    { x: 90, y: 150, width: 12, height: 20 },
    { x: 80, y: 110, width: 12, height: 20 },
  ])).toEqual(bounds)
})

it('keeps a required faint outline even when trimming it would exclude a neighboring glyph', () => {
  const bounds = { x: 100, y: 100, width: 50, height: 40 }
  const faintOutline = { x: 102, y: 102, width: 46, height: 36 }
  expect(avoidAdjacentText(bounds, faintOutline, [
    { x: 90, y: 110, width: 12, height: 20 },
    { x: 148, y: 110, width: 12, height: 20 },
  ])).toEqual(bounds)
})
