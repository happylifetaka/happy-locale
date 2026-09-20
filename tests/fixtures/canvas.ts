import type { TextRegion } from '../../app/types/editor'

/** Public synthetic geometry, independent of private cards and OCR profiles. */
export function canvasRegion(): TextRegion {
  return {
    id: 'region',
    regionId: 'region_1',
    displayName: 'Synthetic region',
    x: 40,
    y: 100,
    width: 240,
    height: 100,
    originalText: 'Original text',
    translatedText: 'Synthetic translation',
    translationStatus: 'draft',
    textStyles: [],
    inlineAssetStyles: [],
    backgroundMode: 'manual',
    autoMaskPreset: 'auto',
    autoMaskSensitivity: 60,
    removeColorOutliers: true,
    backgroundColor: '#ffffff',
    manualMaskStrokes: [{ brushSize: 28, points: [{ x: 10, y: 43 }, { x: 220, y: 43 }] }],
    exclusionAreas: [{ id: 'area', x: 170, y: 60, width: 25, height: 20 }],
    textColor: '#000000',
    textStrokeColor: '#ffffff',
    textStrokeWidth: 0,
    fontSize: 16,
    autoFitFontSize: true,
    fontId: null,
    textAlign: 'left',
    verticalAlign: 'middle',
  }
}
