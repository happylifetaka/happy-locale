import { describe, expect, it } from 'vitest'
import { DEFAULT_REGION_DETECTION_SETTINGS } from '~/services/ocr/detection-settings'
import { createTextPixelRefiner, findLightLabels, pixelComponents } from '~/services/ocr/pixel-regions'

function raster(width: number, height: number, color: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      data.set([...color(x, y), 255], (y * width + x) * 4)
  }
  return data
}

describe('pixel regions', () => {
  it('does not connect across image edges or mutate input', () => {
    const mask = new Uint8Array([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0])
    const snapshot = mask.slice()
    expect(pixelComponents(mask, 3, 4)).toEqual([{ x: 0, y: 1, width: 1, height: 3, area: 3 }])
    expect(mask).toEqual(snapshot)
    expect(pixelComponents(mask, 4, 4)).toEqual([])
  })

  it('finds pale strips with lettering holes, not thin rules or large backgrounds', () => {
    const data = raster(200, 200, (x, y) => {
      const strip = x >= 40 && x < 160 && y >= 100 && y < 114
      const text = y >= 103 && y < 110 && x >= 60 && x < 140 && x % 10 < 4
      return (strip && !text) || (y === 130 && x >= 20 && x < 180) || y < 50 ? [220, 225, 215] : [30, 35, 40]
    })
    expect(findLightLabels(data, 200, 200)).toHaveLength(1)
    expect(findLightLabels(data, 200, 200, { ...DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, enabled: false })).toEqual([])
    expect(findLightLabels(data, 200, 200, { ...DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, minimumLuminance: 250 })).toEqual([])
    expect(findLightLabels(data, 200, 200)[0]).toMatchObject({ x: 40, y: 100, width: 120, height: 14 })
    expect(findLightLabels(new Uint8ClampedArray(0), 200, 200)).toEqual([])
  })

  it('tightens tall text bounds while retaining an adjacent colored icon and a period', () => {
    const data = raster(200, 240, (x, y) => {
      if (x >= 25 && x < 140 && x % 10 < 5 && y >= 50 && y < 66)
        return [235, 235, 235]
      if (x >= 150 && x < 168 && y >= 43 && y < 70)
        return [220, 35, 35]
      if (x >= 142 && x < 145 && y >= 62 && y < 65)
        return [235, 235, 235]
      return [30, 35, 40]
    })
    const block = { text: 'Choose an ally +2', x: 20, y: 30, width: 150, height: 55, confidence: 90 }
    const refine = createTextPixelRefiner(data, 200, 240, 1, [])
    expect(createTextPixelRefiner(data, 200, 240, 1, [], { ...DEFAULT_REGION_DETECTION_SETTINGS.textPixels, enabled: false })(block)).toBe(block)
    expect(createTextPixelRefiner(data, 200, 240, 1, [], { ...DEFAULT_REGION_DETECTION_SETTINGS.textPixels, minimumLuminance: 250 })(block)).toBe(block)
    expect(refine(block)).toMatchObject({ x: 28, y: 41, width: 142, height: 31, text: block.text, confidence: 90 })
    const noSignal = { ...block, text: 'Choose an ally' }
    // Without the icon the period is outside the allowed punctuation gap as well.
    const unprotected = { x: 28, y: 48, width: 109, height: 20 }
    expect(refine(noSignal)).toMatchObject(unprotected)
    const disabled = createTextPixelRefiner(data, 200, 240, 1, [], { ...DEFAULT_REGION_DETECTION_SETTINGS.textPixels, coloredIconProtection: 'none' })
    expect(disabled(block)).toMatchObject(unprotected)
    const always = createTextPixelRefiner(data, 200, 240, 1, [], { ...DEFAULT_REGION_DETECTION_SETTINGS.textPixels, coloredIconProtection: 'always' })
    expect(always(noSignal)).toMatchObject({ x: 28, y: 41, width: 142, height: 31 })
    expect(refine(noSignal)).toMatchObject(unprotected)
    expect(refine({ ...block, confidence: 20 })).toEqual({ ...block, confidence: 20 })
    expect(createTextPixelRefiner(new Uint8ClampedArray(0), 200, 120, 1, [])(block)).toBe(block)
  })

  it('keeps ambiguous and empty images unchanged', () => {
    const block = { text: 'Choose an ally', x: 10, y: 10, width: 100, height: 30, confidence: 90 }
    const refine = createTextPixelRefiner(raster(200, 120, () => [30, 30, 30]), 200, 120, 1, [])
    expect(refine(block)).toBe(block)
  })
})
