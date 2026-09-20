import { afterEach, describe, expect, it, vi } from 'vitest'
import { headingInkColumns, headingInkRows, headingLetterBounds, refineHeadingImageBounds } from '~/services/ocr/heading-bounds'
import { DEFAULT_HEADING_PIXEL_SETTINGS } from '~/services/ocr/heading-settings'

afterEach(() => vi.unstubAllGlobals())

function pixels(width: number, height: number, ink: (x: number, y: number) => boolean, background = 230) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const value = ink(x, y) ? 30 : background
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return data
}

describe('headingLetterBounds', () => {
  it('can disable the centered-dark policy before allocating browser resources', () => {
    const data = pixels(200, 40, (x, y) => y >= 10 && y < 30 && x >= 60 && x < 140 && x % 10 < 5)
    const disabled = { policy: 'none' as const }
    expect(headingLetterBounds(data, 200, 40, disabled)).toBeNull()
    expect(headingInkRows(data, 200, 40, disabled)).toBeNull()
    expect(headingInkColumns(data, 200, 40, { top: 9, bottom: 31 }, disabled)).toBeNull()
    const create = vi.fn()
    vi.stubGlobal('document', { createElement: create })
    const block = { text: 'CASTLE', x: 0, y: 0, width: 200, height: 40, confidence: 90 }
    expect(refineHeadingImageBounds({} as CanvasImageSource, block, 1, disabled)).toBe(block)
    expect(create).not.toHaveBeenCalled()
  })

  it('allows per-call ink/background thresholds without weakening shape checks or changing defaults', () => {
    const ink = (x: number, y: number) => y >= 10 && y < 30 && x >= 60 && x < 140 && x % 10 < 5
    const data = pixels(200, 40, ink)
    expect(headingLetterBounds(data, 200, 40, { maximumInkLuminance: 20 })).toBeNull()
    expect(headingLetterBounds(data, 200, 40, { minimumBackgroundLuminance: 240 })).toBeNull()
    expect(headingLetterBounds(pixels(200, 40, ink, 130), 200, 40)).toBeNull()
    expect(headingLetterBounds(pixels(200, 40, ink, 130), 200, 40, { minimumBackgroundLuminance: 120 })).not.toBeNull()
    expect(headingLetterBounds(data, 200, 40)).toEqual({ left: 59, right: 136, top: 9, bottom: 31 })
    expect(DEFAULT_HEADING_PIXEL_SETTINGS.maximumInkLuminance).toBe(110)
  })

  it('finds central lettering when a decorative strip is much wider than the text', () => {
    const data = pixels(200, 40, (x, y) => y >= 10 && y < 30 && x >= 60 && x < 140 && x % 10 < 5)
    expect(headingLetterBounds(data, 200, 40)).toEqual({ left: 59, right: 136, top: 9, bottom: 31 })
  })

  it('preserves multiple words, rejecting dark backgrounds and separate substantial ink', () => {
    const ink = (x: number, y: number) => y >= 8 && y < 32 && x >= 20 && x < 180 && !(x >= 90 && x < 100) && x % 10 < 5
    expect(headingLetterBounds(pixels(200, 40, ink), 200, 40)).toEqual({ left: 19, right: 176, top: 7, bottom: 33 })
    expect(headingLetterBounds(pixels(200, 40, ink, 70), 200, 40)).toBeNull()
    expect(headingLetterBounds(pixels(200, 40, () => false), 200, 40)).toBeNull()
    expect(headingLetterBounds(new Uint8ClampedArray(0), 200, 40)).toBeNull()
    const separated = pixels(200, 40, (x, y) => ink(x, y) && !(x >= 45 && x < 75))
    expect(headingLetterBounds(separated, 200, 40)).toBeNull()
  })
})

describe('headingInkRows', () => {
  it('finds central dark lettering without including separated full-width rules', () => {
    const data = pixels(100, 30, (x, y) => y === 0 || y === 29 || (y >= 6 && y < 24 && x % 10 < 5))
    expect(headingInkRows(data, 100, 30)).toEqual({ top: 5, bottom: 25 })
    expect(headingInkRows(data, 100, 30, { minimumFallbackContrast: 220 })).toBeNull()
    expect(headingInkRows(data, 100, 30, { minimumFallbackLuminance: 240 })).toBeNull()
  })

  it('does not narrow a full-height word, dark background, blank crop or low contrast', () => {
    expect(headingInkRows(pixels(100, 30, x => x % 10 < 5), 100, 30)).toBeNull()
    expect(headingInkRows(pixels(100, 30, (x, y) => y >= 6 && y < 24 && x % 10 < 5, 70), 100, 30)).toBeNull()
    expect(headingInkRows(pixels(100, 30, () => false), 100, 30)).toBeNull()
    expect(headingInkRows(new Uint8ClampedArray(10), 100, 30)).toBeNull()
  })

  it('rejects ambiguous two-row lettering', () => {
    const data = pixels(100, 30, (x, y) => ((y < 13) || (y >= 17)) && x % 10 < 5)
    expect(headingInkRows(data, 100, 30)).toBeNull()
  })
})

describe('headingInkColumns', () => {
  it('keeps interword spaces and excludes an isolated small leading ornament', () => {
    const data = pixels(140, 30, (x, y) => y >= 5 && y < 25
      && ((x >= 2 && x < 6) || (x >= 28 && x < 138 && !(x >= 65 && x < 75) && x % 8 < 5)))
    const bounds = headingInkColumns(data, 140, 30, { top: 4, bottom: 26 })
    expect(headingInkColumns(data, 140, 30, { top: 4, bottom: 26 }, { maximumInkLuminance: 20 })).toBeNull()
    expect(bounds).not.toBeNull()
    expect(bounds!.left).toBeGreaterThanOrEqual(26)
    expect(bounds!.right).toBeGreaterThan(130)
  })

  it('does not cut a substantial disconnected word from a heading', () => {
    const data = pixels(140, 30, (x, y) => y >= 5 && y < 25
      && ((x >= 2 && x < 25) || (x >= 40 && x < 138)) && x % 8 < 5)
    expect(headingInkColumns(data, 140, 30, { top: 4, bottom: 26 })).toBeNull()
    expect(headingInkColumns(new Uint8ClampedArray(0), 140, 30, { top: 4, bottom: 26 })).toBeNull()
  })
})
