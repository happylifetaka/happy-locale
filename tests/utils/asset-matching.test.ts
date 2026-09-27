import { expect, it } from 'vitest'
import { assetFingerprint, assetSimilarity } from '~/utils/asset-matching'

function icon(scale = 1, background = [255, 255, 255, 255], shape = 'cross') {
  const width = 12 * scale
  const pixels = new Uint8ClampedArray(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const px = Math.floor(x / scale)
      const py = Math.floor(y / scale)
      const foreground = shape === 'cross'
        ? (px >= 5 && px <= 6 && py >= 2 && py <= 9) || (py >= 5 && py <= 6 && px >= 2 && px <= 9)
        : px >= 2 && px <= 9 && py >= 2 && py <= 9
      pixels.set(foreground ? [0, 0, 0, 255] : background, (y * width + x) * 4)
    }
  }
  return assetFingerprint(pixels, width, width)!
}

it('ranks the same icon across size, background color and transparency above different shapes', () => {
  const target = icon()
  for (const candidate of [icon(3), icon(2, [150, 200, 240, 255]), icon(1, [0, 0, 0, 0])]) {
    expect(assetSimilarity(target, candidate)).toBeCloseTo(1)
    expect(assetSimilarity(target, candidate)).toBeGreaterThan(assetSimilarity(target, icon(1, undefined, 'square')))
  }
})

it('does not propose a fingerprint for an empty image or invalid buffer', () => {
  expect(assetFingerprint(new Uint8ClampedArray(16).fill(255), 2, 2)).toBeNull()
  expect(assetFingerprint(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  expect(assetFingerprint(new Uint8ClampedArray(4), 2, 2)).toBeNull()
})
