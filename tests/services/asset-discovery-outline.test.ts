import type { PixelRegion } from '~/services/ocr/pixel-regions'
import { expect, it } from 'vitest'
import { chooseIconOutline } from '~/services/asset-discovery/outline'

const strong: PixelRegion = { x: 10, y: 10, width: 30, height: 30, area: 700 }
it('retains a balanced faint rim instead of always choosing the stronger smaller contour', () => {
  const weak = { x: 5, y: 7, width: 38, height: 36, area: 850 }
  expect(chooseIconOutline(strong, weak, 20)).toBe(weak)
})

it.each([
  { x: 9, y: 9, width: 44, height: 32, area: 900 },
  { x: 9, y: 9, width: 32, height: 44, area: 900 },
  { x: 0, y: 9, width: 41, height: 32, area: 900 },
  { x: 9, y: 0, width: 32, height: 41, area: 900 },
])('rejects one-sided growth in every direction: %j', (weak) => {
  expect(chooseIconOutline(strong, weak, 20)).toBe(strong)
})

it('keeps fallback outlines and does not change input regions', () => {
  const weak = { x: 0, y: 0, width: 50, height: 50, area: 1500 }
  const before = structuredClone([strong, weak])
  expect(chooseIconOutline(strong, weak, 20)).toBe(weak)
  expect(chooseIconOutline(undefined, weak, 20)).toBe(weak)
  expect(chooseIconOutline(strong, undefined, 20)).toBe(strong)
  expect(chooseIconOutline(undefined, undefined, 20)).toBeUndefined()
  expect(chooseIconOutline(strong, { ...weak, area: 600 }, 20)).toBe(strong)
  expect([strong, weak]).toEqual(before)
})
