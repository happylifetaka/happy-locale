import { describe, expect, it, vi } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import {
  compositeBackground,
  createAutomaticTextMask,
  createBlendedBackground,
  createManualMask,
  createMaskPreview,
  createRegionRemovalMask,
  estimateBackgroundColor,
  protectMaskAreas,
} from '~/utils/canvas/background'
import { renderRegion } from '~/utils/canvas/render'

class TestImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

describe('source icon removal', () => {
  it.each(['auto', 'manual'] as const)('removes a missed icon during %s rendering and preserves an overlapping protection', (backgroundMode) => {
    const width = 60
    const data = new Uint8ClampedArray(width * width * 4).fill(255)
    for (let y = 25; y < 35; y++) {
      for (let x = 25; x < 35; x++) {
        const index = (y * width + x) * 4
        data[index] = data[index + 1] = data[index + 2] = 0
      }
    }
    const source = new ImageData(data, width, width)
    const editor = useCardEditor()
    editor.loadImageProject('ordinary-card.png', width, width)
    editor.addRegion({ x: 10, y: 10, width: 40, height: 40 }, '#ffffff')
    const region = editor.project.value.regions[0]!
    const putImageData = vi.fn()
    const context = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      measureText: () => ({ width: 0 }),
      putImageData,
    } as unknown as CanvasRenderingContext2D
    // The light preset misses the black icon; manual mode has no brush strokes.
    const settings = { ...region, backgroundMode, autoMaskPreset: 'light' as const }
    renderRegion(context, settings, source)
    const pixel = (20 * 40 + 20) * 4
    expect((putImageData.mock.calls[0]![0] as ImageData).data[pixel]).toBe(0)

    renderRegion(context, {
      ...settings,
      sourceIcons: [{ id: 'icon', assetId: 'drop', x: 15, y: 15, width: 10, height: 10 }],
      exclusionAreas: [{ id: 'protected', x: 22, y: 22, width: 3, height: 3 }],
    }, source)
    const output = putImageData.mock.calls[1]![0] as ImageData
    expect(output.data[pixel]).toBeGreaterThanOrEqual(253)
    expect(output.data[(23 * 40 + 23) * 4]).toBe(0)
    expect(putImageData.mock.calls[1]!.slice(1)).toEqual([10, 10])
  })

  it('fully removes an icon missed by detection without changing the surrounding mask', () => {
    const mask = new Uint8ClampedArray(24)
    mask[0] = 128
    const result = createRegionRemovalMask(mask, 6, 4, [
      { x: 2.2, y: 1.2, width: 1.5, height: 1.5 },
    ])
    expect([...result]).toEqual([
      128,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      255,
      255,
      0,
      0,
      0,
      0,
      255,
      255,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ])
    expect(mask[8]).toBe(0)
  })

  it('preserves protected areas even when they overlap a source icon', () => {
    const result = createRegionRemovalMask(new Uint8ClampedArray(24), 6, 4, [{ x: 1, y: 1, width: 4, height: 2 }], [{ x: 3, y: 0, width: 2, height: 4 }])
    expect(result[7]).toBe(255)
    expect(result[9]).toBe(0)
    expect(result[16]).toBe(0)
  })

  it('clips source icons to the patch and ignores invalid rectangles', () => {
    const result = createRegionRemovalMask(new Uint8ClampedArray(12), 4, 3, [
      { x: -2, y: -1, width: 3, height: 2 },
      { x: 3, y: 2, width: 10, height: 10 },
      { x: 1, y: 1, width: -1, height: 2 },
      { x: Number.NaN, y: 0, width: 4, height: 3 },
    ])
    expect([...result]).toEqual([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255])
  })
})

describe('estimateBackgroundColor', () => {
  it('creates a translucent preview whose alpha follows the mask', () => {
    const preview = createMaskPreview(
      new Uint8ClampedArray([0, 128, 255]),
      3,
      1,
    )

    expect([...preview.data]).toEqual([
      239,
      68,
      68,
      0,
      239,
      68,
      68,
      85,
      239,
      68,
      68,
      170,
    ])
  })

  it('uses the median surrounding color and ignores the selected center', () => {
    const width = 5
    const height = 5
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = 20
      data[index * 4 + 1] = 40
      data[index * 4 + 2] = 60
      data[index * 4 + 3] = 255
    }
    const center = (2 * width + 2) * 4
    data[center] = 250
    data[center + 1] = 250
    data[center + 2] = 250

    const context = {
      getImageData: () => ({ data, width, height }) as ImageData,
    }
    expect(estimateBackgroundColor(context, 2, 2, 1, 1, 5, 5, 2)).toBe(
      '#14283c',
    )
  })

  it('interpolates the surrounding colors instead of producing a flat patch', () => {
    const width = 12
    const height = 8
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        data[index] = x * 18
        data[index + 1] = 60 + x * 6
        data[index + 2] = 30
        data[index + 3] = 255
      }
    }
    const source = new ImageData(data, width, height)
    const patch = createBlendedBackground(
      source,
      width,
      height,
      { x: 3, y: 2, width: 6, height: 4 },
      '#445533',
    )

    expect(patch.width).toBe(6)
    expect(patch.height).toBe(4)
    expect(patch.data[0]).toBeLessThan(patch.data[(patch.width - 1) * 4]!)
    expect(
      new Set(patch.data.filter((_, index) => index % 4 === 0)).size,
    ).toBeGreaterThan(2)
  })

  it('reduces contamination from an outlier-colored outer edge', () => {
    const width = 20
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        const color = y >= 15 ? [170, 170, 170] : [30, 90, 35]
        data.set([...color, 255], index)
      }
    }
    const source = new ImageData(data, width, height)
    const patch = createBlendedBackground(
      source,
      width,
      height,
      { x: 4, y: 4, width: 12, height: 10 },
      '#1e5a23',
    )
    const bottomCenter = ((patch.height - 1) * patch.width + 6) * 4

    expect(patch.data[bottomCenter]).toBeLessThan(65)
    expect(patch.data[bottomCenter + 1]).toBeGreaterThan(
      patch.data[bottomCenter]!,
    )
  })

  it('rejects a localized white sample among majority green edge colors', () => {
    const width = 24
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      data.set([30, 90, 35, 255], index * 4)
    }
    for (let y = 0; y < 4; y += 1) {
      for (let x = 10; x <= 14; x += 1) {
        data.set([245, 245, 245, 255], (y * width + x) * 4)
      }
    }
    const source = new ImageData(data, width, height)
    const patch = createBlendedBackground(
      source,
      width,
      height,
      { x: 4, y: 4, width: 16, height: 12 },
      '#1e5a23',
    )
    const topCenter = 8 * 4

    expect(patch.data[topCenter]).toBeLessThan(65)
    expect(patch.data[topCenter + 1]).toBeGreaterThan(patch.data[topCenter]!)
  })

  it('creates a feathered manual brush mask', () => {
    const mask = createManualMask(20, 10, [
      {
        brushSize: 4,
        points: [
          { x: 3, y: 5 },
          { x: 16, y: 5 },
        ],
      },
    ])
    expect(mask[5 * 20 + 10]).toBeGreaterThan(200)
    expect(mask[0]).toBe(0)
  })

  it('erases previously painted parts of a manual mask', () => {
    const mask = createManualMask(20, 10, [
      {
        brushSize: 6,
        points: [
          { x: 3, y: 5 },
          { x: 16, y: 5 },
        ],
      },
      {
        brushSize: 8,
        mode: 'erase',
        points: [{ x: 10, y: 5 }],
      },
    ])

    expect(mask[5 * 20 + 4]).toBeGreaterThan(200)
    expect(mask[5 * 20 + 10]).toBeLessThan(40)
    expect(mask[5 * 20 + 16]).toBeGreaterThan(200)
  })

  it('composites the generated background only inside a manual mask', () => {
    const width = 20
    const height = 10
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([240, 240, 240, 255], index * 4)
      patchData.set([20, 80, 30, 255], index * 4)
    }
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createManualMask(width, height, [
      {
        brushSize: 4,
        points: [
          { x: 8, y: 5 },
          { x: 12, y: 5 },
        ],
      },
    ])
    const composited = compositeBackground(
      source,
      patch,
      { x: 0, y: 0, width, height },
      mask,
    )
    const center = (5 * width + 10) * 4

    expect(composited.data[center]).toBeLessThan(80)
    expect(composited.data[0]).toBe(240)
  })

  it('clears protected areas without mutating the original mask', () => {
    const mask = new Uint8ClampedArray(24).fill(255)
    const protectedMask = protectMaskAreas(mask, 6, 4, [
      { x: 2, y: 1, width: 2, height: 2 },
    ])

    expect(protectedMask[1 * 6 + 2]).toBe(0)
    expect(protectedMask[2 * 6 + 3]).toBe(0)
    expect(protectedMask[0]).toBe(255)
    expect(mask[1 * 6 + 2]).toBe(255)
  })

  it('automatically masks a high-contrast text-like pixel', () => {
    const width = 9
    const height = 9
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData[index * 4] = 30
      sourceData[index * 4 + 1] = 70
      sourceData[index * 4 + 2] = 35
      sourceData[index * 4 + 3] = 255
      patchData[index * 4] = 30
      patchData[index * 4 + 1] = 70
      patchData[index * 4 + 2] = 35
      patchData[index * 4 + 3] = 255
    }
    const center = (4 * width + 4) * 4
    sourceData[center] = 255
    sourceData[center + 1] = 255
    sourceData[center + 2] = 255
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createAutomaticTextMask(source, patch, {
      x: 0,
      y: 0,
      width,
      height,
    })
    const composited = compositeBackground(
      source,
      patch,
      { x: 0, y: 0, width, height },
      mask,
    )

    expect(mask[4 * width + 4]).toBeGreaterThan(200)
    expect(composited.data[center]).toBeLessThan(100)
    expect(composited.data[0]).toBe(30)
  })

  it('filters automatic mask candidates by light or dark text preset', () => {
    const width = 15
    const height = 15
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([120, 120, 120, 255], index * 4)
      patchData.set([120, 120, 120, 255], index * 4)
    }
    const lightPoint = 4 * width + 4
    const darkPoint = 10 * width + 10
    sourceData.set([245, 245, 245, 255], lightPoint * 4)
    sourceData.set([15, 15, 15, 255], darkPoint * 4)
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)

    const light = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      true,
      'light',
    )
    const dark = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      true,
      'dark',
    )

    expect(light[lightPoint]).toBeGreaterThan(200)
    expect(light[darkPoint]).toBe(0)
    expect(dark[lightPoint]).toBe(0)
    expect(dark[darkPoint]).toBeGreaterThan(200)
  })

  it('detects a dark antialiased edge with a lower dark-pixel threshold', () => {
    const width = 9
    const height = 9
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([120, 120, 120, 255], index * 4)
      patchData.set([120, 120, 120, 255], index * 4)
    }
    const darkEdgeIndex = (4 * width + 4) * 4
    sourceData.set([102, 102, 102, 255], darkEdgeIndex)
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
    )

    expect(mask[4 * width + 4]).toBeGreaterThan(200)
  })

  it('does not mask a smooth area that only differs from the estimated patch', () => {
    const width = 15
    const height = 15
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([105, 105, 105, 255], index * 4)
      patchData.set([30, 75, 35, 255], index * 4)
    }
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      50,
    )

    expect(mask[7 * width + 7]).toBe(0)
  })

  it('detects an isolated color outlier with similar luminance', () => {
    const width = 11
    const height = 11
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([30, 90, 35, 255], index * 4)
      patchData.set([30, 90, 35, 255], index * 4)
    }
    const center = (5 * width + 5) * 4
    sourceData.set([180, 45, 35, 255], center)
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
    )

    expect(mask[5 * width + 5]).toBeGreaterThan(200)
  })

  it('can disable isolated color outlier removal', () => {
    const width = 11
    const height = 11
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([30, 90, 35, 255], index * 4)
      patchData.set([30, 90, 35, 255], index * 4)
    }
    const center = (5 * width + 5) * 4
    sourceData.set([180, 45, 35, 255], center)
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const mask = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      false,
    )

    expect(mask[5 * width + 5]).toBe(0)
  })

  it('makes the option decisive when a color outlier also has contrast', () => {
    const width = 11
    const height = 11
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([30, 90, 35, 255], index * 4)
      patchData.set([30, 90, 35, 255], index * 4)
    }
    const center = (5 * width + 5) * 4
    sourceData.set([210, 60, 30, 255], center)
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const enabled = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      true,
    )
    const disabled = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      false,
    )

    expect(enabled[5 * width + 5]).toBeGreaterThan(200)
    expect(disabled[5 * width + 5]).toBe(0)
  })

  it('detects the center of a small color cluster using the dominant color', () => {
    const width = 21
    const height = 21
    const sourceData = new Uint8ClampedArray(width * height * 4)
    const patchData = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      sourceData.set([30, 90, 35, 255], index * 4)
      patchData.set([30, 90, 35, 255], index * 4)
    }
    for (let y = 8; y <= 12; y += 1) {
      for (let x = 8; x <= 12; x += 1) {
        sourceData.set([180, 45, 35, 255], (y * width + x) * 4)
      }
    }
    const source = new ImageData(sourceData, width, height)
    const patch = new ImageData(patchData, width, height)
    const enabled = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      true,
    )
    const disabled = createAutomaticTextMask(
      source,
      patch,
      { x: 0, y: 0, width, height },
      60,
      false,
    )

    expect(enabled[10 * width + 10]).toBeGreaterThan(200)
    expect(disabled[10 * width + 10]).toBe(0)
  })
})
