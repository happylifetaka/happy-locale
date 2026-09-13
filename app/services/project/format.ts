import type {
  AutoMaskPreset,
  BackgroundMode,
  CardProject,
  ExclusionArea,
  FolderProjectCard,
  FolderProjectDocument,
  FontReference,
  GlossaryEntry,
  ImageAsset,
  InlineAssetStyleRange,
  LayoutTemplate,
  MaskStroke,
  OCRDictionaryEntry,
  PrintLayoutSettings,
  SourceIcon,
  TextAlign,
  TextRegion,
  TextStyleRange,
  TranslationStatus,
  VerticalAlign,
} from '~/types/editor'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import { FILE_LIMITS } from '~/utils/file-limits'
import { clearTemplateText } from '~/utils/layout-template'
import { normalizeRegionRole } from '~/utils/region-role'
import { statusForTranslation } from '~/utils/translation-status'

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
/** 現在書き出すカードプロジェクトの形式バージョン。 */
export const CURRENT_PROJECT_VERSION = 2

/** 値がnull以外のオブジェクトとして扱えるか判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 旧形式を正規化処理で扱える形へ移す。個々の値の検証は後段で行う。 */
function migrateProjectDocument(value: unknown): unknown {
  if (!isRecord(value))
    return value
  if (value.version === CURRENT_PROJECT_VERSION)
    return value
  const legacyVersion = value.version === 0 || value.version === undefined
  if (!legacyVersion && value.version !== 1)
    return value
  if (!Array.isArray(value.cards))
    return value
  const firstCard = value.cards.find(isRecord)
  return {
    ...value,
    version: CURRENT_PROJECT_VERSION,
    activeCardId: string(value.activeCardId, string(firstCard?.id)),
    assets: Array.isArray(value.assets) ? value.assets : [],
    fonts: Array.isArray(value.fonts) ? value.fonts : [],
    ocrDictionary: Array.isArray(value.ocrDictionary)
      ? value.ocrDictionary
      : [],
    glossary: Array.isArray(value.glossary) ? value.glossary : [],
    cards: value.cards.map(card => isRecord(card)
      ? { ...card, printArea: null, sourceDpi: null }
      : card),
    printSettings: DEFAULT_PRINT_SETTINGS,
  }
}

/** 文字列ならその値を返し、それ以外は既定値へ戻す。 */
function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 有効な数値ならその値を返し、それ以外は既定値へ戻す。 */
function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 真偽値ならその値を返し、それ以外は既定値へ戻す。 */
function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

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
function normalizeExclusion(value: unknown): ExclusionArea | null {
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
function normalizeRegion(value: unknown, index: number): TextRegion | null {
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
      throw new Error('元画像のアイコンのID・アセット・範囲を確認してください。')
    }
    ids.add(item.id)
    return { id: item.id, assetId: item.assetId, x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height) }
  })
}

/** 配置雛形とその領域データを正規化する。 */
function normalizeLayoutTemplates(value: unknown): LayoutTemplate[] {
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
function normalizeAsset(value: unknown): ImageAsset | null {
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
function normalizeFont(value: unknown): FontReference | null {
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
function normalizeOCRDictionaryEntry(value: unknown): OCRDictionaryEntry | null {
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
function normalizeGlossaryEntry(value: unknown): GlossaryEntry | null {
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
function normalizeCard(value: unknown): FolderProjectCard | null {
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
    regions: Array.isArray(value.regions)
      ? value.regions
          .map(normalizeRegion)
          .filter((region): region is TextRegion => region !== null)
      : [],
  }
}

/** 列数・余白・カード間隔を許可範囲に揃える。 */
function normalizePrintSettings(value: unknown): PrintLayoutSettings {
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

/** 不正な項目の場所と理由を含む読み込みエラーを送出する。 */
function invalidItem(path: string, reason: string): never {
  throw new Error(`project.jsonの${path}が不正です（${reason}）。`)
}

/** 識別子等の重複を検出して読み込みエラーにする。 */
function assertUnique(
  values: readonly unknown[],
  path: string,
  key: string,
  label: string,
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (!isRecord(value) || typeof value[key] !== 'string' || !value[key].trim())
      invalidItem(`${path}[${index}].${key}`, `${label}を入力してください`)
    const identifier = value[key]
    if (seen.has(identifier))
      throw new Error(`project.jsonの${label}「${identifier}」が重複しています。`)
    seen.add(identifier)
  })
}

/** 読み込み時にID・名前の重複と各項目の形式を検証する。 */
function assertProjectIntegrity(value: unknown): void {
  if (!isRecord(value))
    return
  const cards = value.cards
  if (!Array.isArray(cards))
    return

  assertUnique(cards, 'cards', 'id', 'カードID')
  cards.forEach((card, cardIndex) => {
    if (!normalizeCard(card))
      invalidItem(`cards[${cardIndex}]`, 'カードIDまたは画像パスを確認してください')
    const regions = isRecord(card) && Array.isArray(card.regions)
      ? card.regions
      : []
    assertUnique(regions, `cards[${cardIndex}].regions`, 'id', '領域ID')
    assertUnique(
      regions.map((region, regionIndex) => isRecord(region)
        ? { regionId: string(region.regionId, `region_${regionIndex + 1}`) }
        : region),
      `cards[${cardIndex}].regions`,
      'regionId',
      'region_id',
    )
    regions.forEach((region, regionIndex) => {
      if (!normalizeRegion(region, regionIndex)) {
        invalidItem(
          `cards[${cardIndex}].regions[${regionIndex}]`,
          '領域IDを確認してください',
        )
      }
      const exclusions = isRecord(region) && Array.isArray(region.exclusionAreas)
        ? region.exclusionAreas
        : []
      assertUnique(
        exclusions,
        `cards[${cardIndex}].regions[${regionIndex}].exclusionAreas`,
        'id',
        '保護領域ID',
      )
      exclusions.forEach((exclusion, exclusionIndex) => {
        if (!normalizeExclusion(exclusion)) {
          invalidItem(
            `cards[${cardIndex}].regions[${regionIndex}].exclusionAreas[${exclusionIndex}]`,
            '保護領域IDを確認してください',
          )
        }
      })
    })
  })

  const collections = [
    ['assets', value.assets, normalizeAsset, 'アセットID'],
    ['fonts', value.fonts, normalizeFont, 'フォントID'],
    ['ocrDictionary', value.ocrDictionary, normalizeOCRDictionaryEntry, 'OCR辞書ID'],
    ['glossary', value.glossary, normalizeGlossaryEntry, '用語集ID'],
  ] as const
  for (const [path, collection, normalize, label] of collections) {
    if (!Array.isArray(collection))
      continue
    assertUnique(collection, path, 'id', label)
    collection.forEach((item, index) => {
      if (!normalize(item))
        invalidItem(`${path}[${index}]`, `${label}と必須項目を確認してください`)
    })
  }

  if (Array.isArray(value.assets))
    assertUnique(value.assets, 'assets', 'name', 'アセット名')
}

/** フォルダ外のファイルを参照・削除しないよう、保存形式で許可する相対パスを限定する。 */
export function isSafeProjectPath(path: string): boolean {
  const parts = path.split('/')
  return (
    path.length > 0
    && !path.startsWith('/')
    && parts.every(part => part.length > 0 && part !== '.' && part !== '..')
  )
}

/** 元画像用ディレクトリ内の許可された相対パスか確認する。 */
export function isSafeCardImagePath(path: string): boolean {
  return /^images\/[^/]+\.(?:png|jpe?g)$/iu.test(path)
    && isSafeProjectPath(path)
}

/** アセット用ディレクトリ内のPNGパスか確認する。 */
export function isSafeAssetImagePath(path: string): boolean {
  return /^assets\/[^/]+\.png$/iu.test(path)
    && isSafeProjectPath(path)
}

/** 容量・複雑さ・整合性を検証したうえで正規化し、外部JSONをアプリ内の型へ取り込む。 */
export function parseFolderProject(text: string): FolderProjectDocument {
  if (new Blob([text]).size > FILE_LIMITS.textBytes)
    throw new Error('project.jsonは20 MiB以下にしてください。')
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    throw new Error('project.jsonが正しいJSONではありません。')
  }
  value = migrateProjectDocument(value)
  assertProjectComplexity(value)
  if (
    !isRecord(value)
    || value.version !== CURRENT_PROJECT_VERSION
    || !Array.isArray(value.cards)
  ) {
    throw new Error('対応していないプロジェクト形式です。')
  }
  assertProjectIntegrity(value)
  const cards = value.cards
    .map(normalizeCard)
    .filter((card): card is FolderProjectCard => card !== null)
  if (cards.length === 0) {
    throw new Error('プロジェクトに読み込めるカードがありません。')
  }
  const requestedActiveId = string(value.activeCardId)
  const activeCardId = cards.some(card => card.id === requestedActiveId)
    ? requestedActiveId
    : cards[0]!.id
  return {
    version: CURRENT_PROJECT_VERSION,
    name: string(value.name, 'HappyLocale Project'),
    ...(value.demoPreset === 'sample-v1' ? { demoPreset: 'sample-v1' as const } : {}),
    ...(value.layoutTemplates !== undefined ? { layoutTemplates: normalizeLayoutTemplates(value.layoutTemplates) } : {}),
    activeCardId,
    cards,
    assets: Array.isArray(value.assets)
      ? value.assets
          .map(normalizeAsset)
          .filter((asset): asset is ImageAsset => asset !== null)
      : [],
    fonts: Array.isArray(value.fonts)
      ? value.fonts
          .map(normalizeFont)
          .filter((font): font is FontReference => font !== null)
      : [],
    ocrDictionary: Array.isArray(value.ocrDictionary)
      ? value.ocrDictionary
          .map(normalizeOCRDictionaryEntry)
          .filter((entry): entry is OCRDictionaryEntry => entry !== null)
      : [],
    glossary: Array.isArray(value.glossary)
      ? value.glossary
          .map(normalizeGlossaryEntry)
          .filter((entry): entry is GlossaryEntry => entry !== null)
      : [],
    printSettings: normalizePrintSettings(value.printSettings),
  }
}

/** 大量の領域やマスク点による負荷を、詳細な正規化や描画に進む前に制限する。 */
function assertProjectComplexity(value: unknown): void {
  if (!isRecord(value))
    return
  if (Array.isArray(value.cards) && value.cards.length > FILE_LIMITS.projectCards)
    throw new Error(`カードは${FILE_LIMITS.projectCards}件以下にしてください。`)
  if (Array.isArray(value.assets) && value.assets.length > FILE_LIMITS.projectAssets)
    throw new Error(`アセットは${FILE_LIMITS.projectAssets}件以下にしてください。`)
  if (Array.isArray(value.cards)) {
    for (const card of value.cards) {
      if (
        isRecord(card)
        && Array.isArray(card.regions)
        && card.regions.length > FILE_LIMITS.projectRegionsPerCard
      ) {
        throw new Error(
          `カードごとの文字領域は${FILE_LIMITS.projectRegionsPerCard}件以下にしてください。`,
        )
      }
    }
  }

  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (current.length > FILE_LIMITS.projectStringLength) {
        throw new Error(
          `project.json内の文字列は${FILE_LIMITS.projectStringLength}文字以下にしてください。`,
        )
      }
    }
    else if (Array.isArray(current)) {
      if (current.length > FILE_LIMITS.csvRows)
        throw new Error('project.json内の配列要素数が上限を超えています。')
      pending.push(...current)
    }
    else if (isRecord(current)) {
      pending.push(...Object.values(current))
    }
  }
}

/** フォルダプロジェクトを保存用JSONへ変換する。 */
export function serializeFolderProject(project: FolderProjectDocument): string {
  assertProjectComplexity(project)
  assertProjectIntegrity(project)
  if (project.layoutTemplates !== undefined)
    normalizeLayoutTemplates(project.layoutTemplates)
  return `${JSON.stringify(project, null, 2)}\n`
}

/** 保存カードから編集履歴に必要な情報だけを取り出す。 */
export function toCardProject(card: FolderProjectCard): CardProject {
  return {
    imageName: card.imageName,
    imageWidth: card.imageWidth,
    imageHeight: card.imageHeight,
    regions: card.regions,
  }
}
