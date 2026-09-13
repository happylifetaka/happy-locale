import type { TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { renderRegion, verticalTextOffset } from '~/utils/canvas/render'

function renderedFontSize(autoFitFontSize: boolean, ruby = false, overrides: Partial<TextRegion> = {}, onDraw?: (y: number, fontSize: number) => void) {
  let font = ''
  let drawnFont = ''
  const context = {
    get font() {
      return font
    },
    set font(value: string) {
      font = value
    },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    measureText(text: string) {
      return { width: [...text].length * Number.parseFloat(font), actualBoundingBoxDescent: Number.parseFloat(font) * 0.8 }
    },
    fillText(_text: string, _x: number, y: number) {
      onDraw?.(y, Number.parseFloat(font))
      drawnFont = font
    },
    strokeText() {},
  } as unknown as CanvasRenderingContext2D
  const region: TextRegion = {
    id: 'region',
    regionId: 'region_1',
    displayName: '領域 1',
    ruby,
    x: 0,
    y: ruby ? 80 : 0,
    width: 45,
    height: 14,
    originalText: '',
    translatedText: 'AAAA',
    translationStatus: 'draft',
    textStyles: [],
    inlineAssetStyles: [],
    backgroundMode: ruby ? 'solid' : 'none',
    autoMaskPreset: 'auto',
    autoMaskSensitivity: 60,
    removeColorOutliers: true,
    backgroundColor: '#ffffff',
    manualMaskStrokes: [],
    exclusionAreas: [],
    textColor: '#ffffff',
    textStrokeColor: '#000000',
    textStrokeWidth: 0,
    fontSize: 20,
    autoFitFontSize,
    fontId: null,
    textAlign: 'left',
    verticalAlign: 'middle',
    ...overrides,
  }

  renderRegion(context, region)
  return Number.parseFloat(drawnFont)
}

describe('card text rendering', () => {
  it('enlarges single-line translations to fit the region height', () => {
    expect(renderedFontSize(true, false, {
      ocrLayout: 'single-line',
      width: 400,
      height: 40,
      fontSize: 12,
    })).toBe(28)
  })

  it('shrinks a long single-line translation to fit its width without wrapping', () => {
    expect(renderedFontSize(true, false, {
      ocrLayout: 'single-line',
      width: 50,
      height: 40,
      fontSize: 12,
    })).toBe(11)
  })

  it('respects a fixed font size even for single-line regions', () => {
    expect(renderedFontSize(false, false, {
      ocrLayout: 'single-line',
      width: 400,
      height: 40,
      fontSize: 12,
    })).toBe(12)
  })

  it.each([true, false])('fits ruby to a single line regardless of body auto-fit (%s)', (bodyAutoFit) => {
    expect(renderedFontSize(bodyAutoFit, true)).toBeGreaterThan(0)
    expect(renderedFontSize(bodyAutoFit, true)).toBeLessThanOrEqual(7)
    expect(renderedFontSize(bodyAutoFit, true)).toBe(renderedFontSize(true, true))
  })

  it.each([0, 2, -4])('aligns ruby ink including stroke to the requested gap %s', (gap) => {
    let bottom = 0
    renderedFontSize(true, true, {
      width: 400,
      height: 40,
      rubyFontSize: 20,
      rubyGap: gap,
      textStrokeWidth: 2,
    }, (y, size) => { bottom = y + size * 0.8 + 2 })
    expect(bottom).toBe(80 - gap)
  })

  it('positions a text block at the top, middle, or bottom', () => {
    expect(verticalTextOffset('top', 100, 25)).toBe(0)
    expect(verticalTextOffset('middle', 100, 25)).toBe(37.5)
    expect(verticalTextOffset('bottom', 100, 25)).toBe(75)
  })

  it('does not move overflowing text outside the region', () => {
    expect(verticalTextOffset('middle', 20, 30)).toBe(0)
    expect(verticalTextOffset('bottom', 20, 30)).toBe(0)
  })

  it('keeps the requested size when automatic adjustment is disabled', () => {
    expect(renderedFontSize(true)).toBeLessThan(20)
    expect(renderedFontSize(false)).toBe(20)
  })
})
