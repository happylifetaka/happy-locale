import type { TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { rubyDisplayRegion } from '~/utils/ruby'

const region = { ruby: true, x: 20, y: 80, width: 200, height: 40, fontSize: 28, backgroundMode: 'solid', textStrokeWidth: 2, exclusionAreas: [{ x: 0, y: 0, width: 10, height: 10 }], originalText: 'Name', translatedText: '名前' } as TextRegion

describe('ruby display geometry', () => {
  it.each([true, false])('keeps body auto-fit (%s) unchanged when ruby is enabled and disabled', (autoFitFontSize) => {
    const source = { ...region, autoFitFontSize }
    expect(rubyDisplayRegion(source).autoFitFontSize).toBe(true)
    expect(source.autoFitFontSize).toBe(autoFitFontSize)
    const body = { ...source, ruby: false }
    expect(rubyDisplayRegion(body)).toBe(body)
    expect(rubyDisplayRegion(body).autoFitFontSize).toBe(autoFitFontSize)
  })

  it('keeps the source bounds and background settings and puts a separate text band above them', () => {
    const display = rubyDisplayRegion(region)
    expect(display.y + display.height).toBe(80)
    expect(display.fontSize).toBe(20)
    expect(display.backgroundMode).toBe('none')
    expect(display.exclusionAreas).toEqual([])
    expect(region.y).toBe(80)
    expect(region.backgroundMode).toBe('solid')
    expect(rubyDisplayRegion({ ...region, ruby: false }).y).toBe(80)
  })
  it('respects manual size and gap and does not move text into the original when there is no room', () => {
    expect(rubyDisplayRegion({ ...region, rubyFontSize: 12, rubyGap: 8 })).toMatchObject({ fontSize: 12, y: 53, height: 19 })
    expect(rubyDisplayRegion({ ...region, rubyFontSize: 12, rubyGap: -4 })).toMatchObject({ fontSize: 12, y: 65, height: 19 })
    expect(rubyDisplayRegion({ ...region, y: 1, rubyGap: 2 })).toMatchObject({ y: 0, height: 0 })
  })
})
