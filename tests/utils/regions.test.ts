import type { TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { transformRegionContents } from '~/utils/regions'

function region(): TextRegion {
  return {
    id: 'region',
    regionId: 'region_1',
    displayName: '効果',
    x: 20,
    y: 30,
    width: 100,
    height: 60,
    originalText: '',
    translatedText: '',
    translationStatus: 'untranslated',
    textStyles: [],
    inlineAssetStyles: [],
    backgroundMode: 'auto',
    autoMaskPreset: 'auto',
    autoMaskSensitivity: 60,
    removeColorOutliers: true,
    backgroundColor: '#ffffff',
    manualMaskStrokes: [{ brushSize: 10, points: [{ x: 70, y: 40 }] }],
    exclusionAreas: [{ id: 'area', x: 70, y: 35, width: 25, height: 20 }],
    textColor: '#ffffff',
    textStrokeColor: '#000000',
    textStrokeWidth: 2,
    fontSize: 16,
    autoFitFontSize: true,
    fontId: null,
    textAlign: 'left',
    verticalAlign: 'middle',
  }
}

describe('transformRegionContents', () => {
  it('keeps child coordinates unchanged when moving a region', () => {
    const transformed = transformRegionContents(region(), {
      x: 40,
      y: 50,
      width: 100,
      height: 60,
    })

    expect(transformed.exclusionAreas[0]).toMatchObject({ x: 70, y: 35 })
    expect(transformed.manualMaskStrokes[0]?.points[0]).toEqual({
      x: 70,
      y: 40,
    })
  })

  it('preserves absolute child positions and clamps them when resizing', () => {
    const transformed = transformRegionContents(region(), {
      x: 40,
      y: 40,
      width: 60,
      height: 40,
    })

    expect(transformed.exclusionAreas[0]).toMatchObject({
      x: 35,
      y: 20,
      width: 25,
      height: 20,
    })
    expect(transformed.manualMaskStrokes[0]?.points[0]).toEqual({
      x: 50,
      y: 30,
    })
  })
})
