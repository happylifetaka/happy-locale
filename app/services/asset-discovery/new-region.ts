import type { TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'

/** 未確定の検出枠から作業コピーを作る。保存は利用者のプレビュー確認後。 */
export function regionFromCandidate(candidate: RegionCandidate, index: number): TextRegion {
  const id = crypto.randomUUID()
  return {
    id,
    regionId: `region_${id}`,
    displayName: `領域 ${index + 1}`,
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    originalText: candidate.text,
    translatedText: '',
    translationStatus: 'untranslated',
    textStyles: [],
    inlineAssetStyles: [],
    backgroundMode: 'auto',
    autoMaskPreset: 'auto',
    autoMaskSensitivity: 60,
    removeColorOutliers: true,
    backgroundColor: '#ffffff',
    manualMaskStrokes: [],
    exclusionAreas: [],
    textColor: '#ffffff',
    textStrokeColor: '#111111',
    textStrokeWidth: 2,
    fontSize: Math.max(12, Math.min(28, Math.round(candidate.height * 0.3))),
    autoFitFontSize: true,
    fontId: null,
    textAlign: 'left',
    verticalAlign: 'middle',
  }
}
