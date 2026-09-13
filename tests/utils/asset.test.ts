import { describe, expect, it } from 'vitest'
import {
  applyAssetTransparencyStrokes,
  removeConnectedBackground,
} from '~/utils/canvas/asset'

function pixels(colors: ReadonlyArray<readonly [number, number, number, number]>) {
  return new Uint8ClampedArray(colors.flat())
}

describe('asset background transparency', () => {
  it('removes matching background connected to the border', () => {
    const source = pixels([
      [20, 100, 30, 255],
      [20, 100, 30, 255],
      [20, 100, 30, 255],
      [20, 100, 30, 255],
      [240, 180, 20, 255],
      [20, 100, 30, 255],
      [20, 100, 30, 255],
      [20, 100, 30, 255],
      [20, 100, 30, 255],
    ])
    const result = removeConnectedBackground(source, 3, 3, {
      threshold: 20,
      feather: 0,
    })
    expect([...result.filter((_, index) => index % 4 === 3)]).toEqual([
      0,
      0,
      0,
      0,
      255,
      0,
      0,
      0,
      0,
    ])
  })

  it('keeps a matching color enclosed by the icon', () => {
    const green = [20, 100, 30, 255] as const
    const gold = [240, 180, 20, 255] as const
    const source = pixels([
      green,
      green,
      green,
      green,
      green,
      green,
      gold,
      gold,
      gold,
      green,
      green,
      gold,
      green,
      gold,
      green,
      green,
      gold,
      gold,
      gold,
      green,
      green,
      green,
      green,
      green,
      green,
    ])
    const result = removeConnectedBackground(source, 5, 5, {
      threshold: 20,
      feather: 0,
    })
    expect(result[(2 * 5 + 2) * 4 + 3]).toBe(255)
    expect(result[3]).toBe(0)
  })

  it('feathers colors near the threshold', () => {
    const source = pixels([
      [20, 100, 30, 255],
      [50, 100, 30, 255],
      [20, 100, 30, 255],
    ])
    const result = removeConnectedBackground(source, 3, 1, {
      threshold: 10,
      feather: 40,
    })
    expect(result[7]).toBeGreaterThan(0)
    expect(result[7]).toBeLessThan(255)
  })

  it('uses a manually selected background color instead of the border majority', () => {
    const source = pixels([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [30, 30, 30, 255],
      [240, 20, 30, 255],
      [255, 255, 255, 255],
      [240, 20, 30, 255],
      [240, 20, 30, 255],
    ])
    const automatic = removeConnectedBackground(source, 3, 3, {
      threshold: 10,
      feather: 0,
    })
    const manual = removeConnectedBackground(source, 3, 3, {
      threshold: 10,
      feather: 0,
      backgroundColor: '#f0141e',
    })
    expect(automatic[3]).toBe(0)
    expect(automatic[31]).toBe(255)
    expect(manual[3]).toBe(255)
    expect(manual[31]).toBe(0)
    expect(manual[(1 * 3 + 1) * 4 + 3]).toBe(255)
  })

  it('paints transparency and restores the original alpha with manual strokes', () => {
    const source = pixels(Array.from(
      { length: 25 },
      () => [20, 100, 30, 255] as [number, number, number, number],
    ))
    const painted = applyAssetTransparencyStrokes(
      source,
      source,
      5,
      5,
      [{ brushSize: 3, points: [{ x: 2.5, y: 2.5 }], mode: 'paint' }],
    )
    expect(painted[(2 * 5 + 2) * 4 + 3]).toBe(0)
    expect(painted[3]).toBe(255)

    const restored = applyAssetTransparencyStrokes(
      source,
      painted,
      5,
      5,
      [{ brushSize: 2, points: [{ x: 2.5, y: 2.5 }], mode: 'erase' }],
    )
    expect(restored[(2 * 5 + 2) * 4 + 3]).toBe(255)
  })
})
