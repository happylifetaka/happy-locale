import type { TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { regionTextLayout } from '~/utils/region-text-layout'

function region(overrides: Partial<TextRegion> = {}) {
  return { originalText: 'LANTERN GROVE', width: 340, height: 40, ...overrides } as TextRegion
}

describe('region text layout', () => {
  it('infers single-line headings in existing projects', () => {
    expect(regionTextLayout(region())).toBe('single-line')
  })

  it('keeps multiline, tall and empty regions as text blocks', () => {
    expect(regionTextLayout(region({ originalText: 'LINE ONE\nLINE TWO' }))).toBe('text-block')
    expect(regionTextLayout(region({ height: 200 }))).toBe('text-block')
    expect(regionTextLayout(region({ originalText: '' }))).toBe('text-block')
  })

  it('honors each region’s saved choice over inference', () => {
    expect(regionTextLayout(region({ ocrLayout: 'text-block' }))).toBe('text-block')
    expect(regionTextLayout(region({ ocrLayout: 'single-line', height: 200 }))).toBe('single-line')
  })
})
