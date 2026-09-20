import type { FolderProjectCard, FontReference, GlossaryEntry, ImageAsset, LayoutTemplate, OCRDictionaryEntry, PrintLayoutSettings, TextRegion } from '~/types/editor'
import { parseRegionCandidates } from '~/services/ocr/candidate-format'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import { clearTemplateText } from '~/utils/layout-template'
import { isSafeAssetImagePath, isSafeCardImagePath } from './paths'
import { normalizeRegion } from './regions'
import { boolean, isRecord, number, string } from './values'

/** 配置雛形とその領域データを正規化する。 */
export function normalizeLayoutTemplates(value: unknown): LayoutTemplate[] {
  if (!Array.isArray(value))
    throw new Error('配置雛形の形式が不正です。')
  const ids = new Set<string>()
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id
      || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()
      || typeof item.imageWidth !== 'number' || !Number.isFinite(item.imageWidth) || item.imageWidth <= 0
      || typeof item.imageHeight !== 'number' || !Number.isFinite(item.imageHeight) || item.imageHeight <= 0
      || !Array.isArray(item.regions) || item.regions.length === 0) {
      throw new Error('配置雛形の名前・画像寸法・領域を確認してください。')
    }
    ids.add(item.id)
    const regions = item.regions.map(normalizeRegion)
    if (regions.some(region => !region)
      || new Set(regions.map(region => region?.id)).size !== regions.length) {
      throw new Error('配置雛形の領域IDが不正です。')
    }
    return {
      id: item.id,
      name: item.name.trim(),
      imageWidth: item.imageWidth,
      imageHeight: item.imageHeight,
      regions: (regions as TextRegion[]).map(clearTemplateText),
    }
  })
}

/** アセットの保存用定義を検証し、配置設定の初期値を補う。 */
export function normalizeAsset(value: unknown): ImageAsset | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.sourceImageId !== 'string'
    || !isRecord(value.sourceRect)
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    sourceImageId: value.sourceImageId,
    sourceRect: {
      x: number(value.sourceRect.x),
      y: number(value.sourceRect.y),
      width: Math.max(0, number(value.sourceRect.width)),
      height: Math.max(0, number(value.sourceRect.height)),
    },
    imagePath:
      typeof value.imagePath === 'string' && isSafeAssetImagePath(value.imagePath)
        ? value.imagePath
        : `assets/${value.id}.png`,
    scale: Math.max(0.1, number(value.scale, 1)),
    baselineOffset: number(value.baselineOffset, 0),
    inlinePadding: Math.max(0, number(value.inlinePadding, 0)),
  }
}

/** 保存済みフォント参照の形式を揃える。 */
export function normalizeFont(value: unknown): FontReference | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.familyName !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    displayName: value.displayName,
    familyName: value.familyName,
    fileName: string(value.fileName),
    source: value.source === 'system' ? 'system' : 'user',
    ...(typeof value.postscriptName === 'string'
      ? { postscriptName: value.postscriptName }
      : {}),
    ...(typeof value.style === 'string' ? { style: value.style } : {}),
  }
}

/** OCR辞書項目の原文と置換先を正規化する。 */
export function normalizeOCRDictionaryEntry(value: unknown): OCRDictionaryEntry | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.source !== 'string'
    || typeof value.replacement !== 'string'
    || !value.source.trim()
    || !value.replacement.trim()
  ) {
    return null
  }
  return {
    id: value.id,
    source: value.source.trim(),
    replacement: value.replacement.trim(),
  }
}

/** 用語集の原語・訳語・補足を正規化する。 */
export function normalizeGlossaryEntry(value: unknown): GlossaryEntry | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.source !== 'string'
    || typeof value.translation !== 'string'
    || !value.source.trim()
    || !value.translation.trim()
  ) {
    return null
  }
  return {
    id: value.id,
    source: value.source.trim(),
    translation: value.translation.trim(),
    note: string(value.note).trim(),
  }
}

/** カードの画像参照・寸法・領域・印刷設定を正規化する。 */
export function normalizeCard(value: unknown): FolderProjectCard | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.imagePath !== 'string'
    || !isSafeCardImagePath(value.imagePath)
  ) {
    return null
  }
  const imageWidth = Math.max(0, number(value.imageWidth))
  const imageHeight = Math.max(0, number(value.imageHeight))
  const rawArea = isRecord(value.printArea) ? value.printArea : null
  const areaX = Math.max(0, number(rawArea?.x))
  const areaY = Math.max(0, number(rawArea?.y))
  const areaWidth = Math.min(
    Math.max(0, imageWidth - areaX),
    Math.max(0, number(rawArea?.width)),
  )
  const areaHeight = Math.min(
    Math.max(0, imageHeight - areaY),
    Math.max(0, number(rawArea?.height)),
  )
  const rawDpi = isRecord(value.sourceDpi) ? value.sourceDpi : null
  const dpiX = number(rawDpi?.x)
  const dpiY = number(rawDpi?.y)
  return {
    id: value.id,
    imagePath: value.imagePath,
    imageName: string(value.imageName),
    imageWidth,
    imageHeight,
    printArea: rawArea && areaWidth >= 5 && areaHeight >= 5
      ? {
          x: areaX,
          y: areaY,
          width: areaWidth,
          height: areaHeight,
        }
      : null,
    sourceDpi: dpiX >= 10 && dpiX <= 9600 && dpiY >= 10 && dpiY <= 9600
      ? { x: dpiX, y: dpiY }
      : null,
    ...(value.ocrCandidates !== undefined ? { ocrCandidates: parseRegionCandidates(value.ocrCandidates, imageWidth, imageHeight) } : {}),
    regions: Array.isArray(value.regions)
      ? value.regions
          .map(normalizeRegion)
          .filter((region): region is TextRegion => region !== null)
      : [],
  }
}

/** 列数・余白・カード間隔を許可範囲に揃える。 */
export function normalizePrintSettings(value: unknown): PrintLayoutSettings {
  if (!isRecord(value))
    return { ...DEFAULT_PRINT_SETTINGS }
  const columns = number(value.columns, DEFAULT_PRINT_SETTINGS.columns)
  return {
    columns: columns === 1 || columns === 2 ? columns : 3,
    marginMm: Math.min(30, Math.max(0, number(value.marginMm, 10))),
    gapMm: Math.min(20, Math.max(0, number(value.gapMm, DEFAULT_PRINT_SETTINGS.gapMm))),
    cutMarks: boolean(value.cutMarks, true),
  }
}
