import type { AutoMaskPreset, BackgroundMode, ExclusionArea, InlineAssetStyleRange, MaskStroke, SourceIcon, TextAlign, TextRegion, TextStyleRange, TranslationStatus, VerticalAlign } from '~/types/editor'
import { normalizeRegionRole } from '~/utils/region-role'
import { statusForTranslation } from '~/utils/translation-status'
import { boolean, isRecord, number, string } from './values'

/** 保存形式で許可する背景処理方式。 */
const backgroundModes: BackgroundMode[] = ['auto', 'manual', 'solid', 'none']

/** 保存形式で許可する自動マスクの文字色条件。 */
const autoMaskPresets: AutoMaskPreset[] = ['auto', 'light', 'dark']

/** 保存形式で許可する横揃えの指定。 */
const textAligns: TextAlign[] = ['left', 'center', 'right']

/** 保存形式で許可する縦揃えの指定。 */
const verticalAligns: VerticalAlign[] = ['top', 'middle', 'bottom']

/** 保存形式で許可する翻訳の進捗状態。 */
const translationStatuses: TranslationStatus[] = [
  'untranslated',
  'draft',
  'reviewed',
]

/** 保存済みのブラシ軌跡を検証して描画用データへ揃える。 */
function normalizeStroke(value: unknown): MaskStroke | null {
  if (!isRecord(value) || !Array.isArray(value.points))
    return null
  return {
    brushSize: Math.max(1, number(value.brushSize, 20)),
    points: value.points
      .filter(isRecord)
      .map(point => ({ x: number(point.x), y: number(point.y) })),
    ...(value.mode === 'erase' ? { mode: 'erase' as const } : {}),
  }
}

/** 保存済みの保護領域の形式を揃える。 */
export function normalizeExclusion(value: unknown): ExclusionArea | null {
  if (!isRecord(value) || typeof value.id !== 'string')
    return null
  return {
    id: value.id,
    x: number(value.x),
    y: number(value.y),
    width: Math.max(0, number(value.width)),
    height: Math.max(0, number(value.height)),
  }
}

/** 部分書式の文字範囲と色・フォント指定を正規化する。 */
function normalizeTextStyle(value: unknown): TextStyleRange | null {
  if (!isRecord(value))
    return null
  const start = Math.max(0, Math.floor(number(value.start)))
  const end = Math.max(start, Math.floor(number(value.end)))
  if (end <= start)
    return null
  return {
    start,
    end,
    ...(typeof value.textColor === 'string'
      ? { textColor: value.textColor }
      : {}),
    ...(typeof value.fontId === 'string' || value.fontId === null
      ? { fontId: value.fontId as string | null }
      : {}),
  }
}

/** アイコンの個別設定と文字範囲を正規化する。 */
function normalizeInlineAssetStyle(
  value: unknown,
): InlineAssetStyleRange | null {
  if (!isRecord(value) || typeof value.assetId !== 'string')
    return null
  const start = Math.max(0, Math.floor(number(value.start)))
  const end = Math.max(start, Math.floor(number(value.end)))
  if (end <= start)
    return null
  return {
    start,
    end,
    assetId: value.assetId,
    ...(typeof value.scale === 'number'
      ? { scale: Math.max(0.1, value.scale) }
      : {}),
    ...(typeof value.baselineOffset === 'number'
      ? { baselineOffset: value.baselineOffset }
      : {}),
    ...(typeof value.inlinePadding === 'number'
      ? { inlinePadding: Math.max(0, value.inlinePadding) }
      : {}),
  }
}

/** 任意項目の初期値と数値の範囲を揃え、描画側で扱える領域データにする。 */
export function normalizeRegion(value: unknown, index: number): TextRegion | null {
  if (!isRecord(value) || typeof value.id !== 'string')
    return null
  const backgroundMode = backgroundModes.includes(
    value.backgroundMode as BackgroundMode,
  )
    ? (value.backgroundMode as BackgroundMode)
    : 'auto'
  const textAlign = textAligns.includes(value.textAlign as TextAlign)
    ? (value.textAlign as TextAlign)
    : 'left'
  const verticalAlign = verticalAligns.includes(
    value.verticalAlign as VerticalAlign,
  )
    ? (value.verticalAlign as VerticalAlign)
    : 'middle'
  const autoMaskPreset = autoMaskPresets.includes(
    value.autoMaskPreset as AutoMaskPreset,
  )
    ? (value.autoMaskPreset as AutoMaskPreset)
    : 'auto'
  const translatedText = string(value.translatedText)
  const translationStatus = translationStatuses.includes(
    value.translationStatus as TranslationStatus,
  )
    ? (value.translationStatus as TranslationStatus)
    : statusForTranslation(translatedText)

  return {
    id: value.id,
    regionId: string(value.regionId, `region_${index + 1}`),
    displayName: string(value.displayName, `領域 ${index + 1}`),
    ...(normalizeRegionRole(value.role) ? { role: normalizeRegionRole(value.role) } : {}),
    ...(value.sourceIcons !== undefined ? { sourceIcons: normalizeSourceIcons(value.sourceIcons) } : {}),
    ...(value.ruby === true ? { ruby: true } : {}),
    ...(value.rubyFontSize !== undefined ? { rubyFontSize: Math.max(1, number(value.rubyFontSize, 16)) } : {}),
    ...(value.rubyGap !== undefined ? { rubyGap: number(value.rubyGap, 0) } : {}),
    ...(['single-line', 'sparse-text', 'text-block'].includes(value.ocrLayout as string)
      ? { ocrLayout: value.ocrLayout as TextRegion['ocrLayout'] }
      : {}),
    x: number(value.x),
    y: number(value.y),
    width: Math.max(0, number(value.width)),
    height: Math.max(0, number(value.height)),
    originalText: string(value.originalText),
    ...(typeof value.lastOcrText === 'string' ? { lastOcrText: string(value.lastOcrText) } : {}),
    translatedText,
    translationStatus,
    textStyles: Array.isArray(value.textStyles)
      ? value.textStyles
          .map(normalizeTextStyle)
          .filter((style): style is TextStyleRange => style !== null)
      : [],
    inlineAssetStyles: Array.isArray(value.inlineAssetStyles)
      ? value.inlineAssetStyles
          .map(normalizeInlineAssetStyle)
          .filter((style): style is InlineAssetStyleRange => style !== null)
      : [],
    backgroundMode,
    autoMaskPreset,
    autoMaskSensitivity: number(value.autoMaskSensitivity, 60),
    removeColorOutliers: boolean(value.removeColorOutliers, true),
    backgroundColor: string(value.backgroundColor, '#ffffff'),
    manualMaskStrokes: Array.isArray(value.manualMaskStrokes)
      ? value.manualMaskStrokes
          .map(normalizeStroke)
          .filter((stroke): stroke is MaskStroke => stroke !== null)
      : [],
    exclusionAreas: Array.isArray(value.exclusionAreas)
      ? value.exclusionAreas
          .map(normalizeExclusion)
          .filter((area): area is ExclusionArea => area !== null)
      : [],
    textColor: string(value.textColor, '#ffffff'),
    textStrokeColor: string(value.textStrokeColor, '#111111'),
    textStrokeWidth: Math.max(0, number(value.textStrokeWidth, 2)),
    fontSize: Math.max(1, number(value.fontSize, 16)),
    autoFitFontSize: boolean(value.autoFitFontSize, true),
    fontId: typeof value.fontId === 'string' ? value.fontId : null,
    textAlign,
    verticalAlign,
  }
}

/** 原文アイコンの参照と範囲を有効な配列へ揃える。 */
function normalizeSourceIcons(value: unknown): SourceIcon[] {
  if (!Array.isArray(value))
    throw new Error('元画像のアイコン設定が不正です。')
  const ids = new Set<string>()
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.assetId !== 'string' || !item.assetId
      || !['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
      || Number(item.width) <= 0 || Number(item.height) <= 0) {
      throw new Error('元画像のアイコンのID・アイコン・範囲を確認してください。')
    }
    ids.add(item.id)
    return { id: item.id, assetId: item.assetId, x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height) }
  })
}
