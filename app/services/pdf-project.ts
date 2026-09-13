import type {
  PdfAnalysis,
  PdfBackgroundMode,
  PdfProtectedArea,
  PdfTextColorMode,
} from '~/services/pdf'
import { FILE_LIMITS } from '~/utils/file-limits'

/** 書き出すPDF作業JSONの形式バージョン。 */
export const PDF_PROJECT_VERSION = 2

export interface PdfProjectDocument {
  version: typeof PDF_PROJECT_VERSION
  analysis: PdfAnalysis
  translations: Array<[string, string]>
  excludedEntryIds: string[]
  protectedAreas: Array<[number, PdfProtectedArea[]]>
  backgroundMode: PdfBackgroundMode
  textColorMode: PdfTextColorMode
}

/** 値がnull以外のオブジェクトとして扱えるか判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 旧PDF作業形式を現在の検証で扱える構造へ移行する。 */
function migratePdfProject(value: unknown): unknown {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.analysis))
    return value
  const pages = value.analysis.pages
  if (!Array.isArray(pages))
    return value
  return {
    ...value,
    version: PDF_PROJECT_VERSION,
    analysis: {
      ...value.analysis,
      pages: pages.map((page) => {
        if (!isRecord(page) || !finiteNumber(page.height))
          return page
        return {
          ...page,
          rotation: 0,
          viewportTransform: [1, 0, 0, -1, 0, page.height],
        }
      }),
    },
  }
}

/** 有限の数値か判定する。 */
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** PDF領域の座標と寸法が有効か検証する。 */
function validArea(value: unknown): value is PdfProtectedArea {
  return isRecord(value)
    && finiteNumber(value.x)
    && finiteNumber(value.y)
    && finiteNumber(value.width)
    && finiteNumber(value.height)
    && value.width >= 0
    && value.height >= 0
}

/** PDF解析情報の構造と各項目を検証する。 */
function validAnalysis(value: unknown): value is PdfAnalysis {
  if (!isRecord(value)
    || typeof value.fileName !== 'string'
    || value.fileName.length > FILE_LIMITS.projectStringLength
    || !/^[a-f\d]{64}$/u.test(String(value.sourceFingerprint))
    || !['text', 'image', 'mixed'].includes(String(value.kind))
    || !finiteNumber(value.pageCount)
    || !Array.isArray(value.pages)
    || !Array.isArray(value.entries)
    || !isRecord(value.features)
    || !finiteNumber(value.features.formFields)
    || !finiteNumber(value.features.links)
    || !finiteNumber(value.features.annotations)
    || value.pageCount !== value.pages.length
    || value.entries.length > FILE_LIMITS.csvRows) {
    return false
  }
  const pageCount = value.pageCount as number
  const pagesValid = value.pages.every(page => isRecord(page)
    && finiteNumber(page.pageNumber)
    && ['text', 'image'].includes(String(page.kind))
    && finiteNumber(page.width)
    && finiteNumber(page.height)
    && finiteNumber(page.textCount)
    && finiteNumber(page.rotation)
    && [0, 90, 180, 270].includes(((page.rotation % 360) + 360) % 360)
    && Array.isArray(page.viewportTransform)
    && page.viewportTransform.length === 6
    && page.viewportTransform.every(finiteNumber))
  const entriesValid = value.entries.every(entry => isRecord(entry)
    && typeof entry.id === 'string'
    && typeof entry.original === 'string'
    && entry.original.length <= FILE_LIMITS.projectStringLength
    && finiteNumber(entry.pageNumber)
    && finiteNumber(entry.x)
    && finiteNumber(entry.y)
    && finiteNumber(entry.width)
    && finiteNumber(entry.height)
    && finiteNumber(entry.fontSize)
    && entry.pageNumber >= 1
    && entry.pageNumber <= pageCount
    && entry.width >= 0
    && entry.height >= 0
    && entry.fontSize > 0)
  return pagesValid && entriesValid
}

/** 同名の別PDFへ編集内容を当てないよう、保存した指紋と元ファイルを照合する。 */
export function assertPdfProjectSource(
  project: PdfProjectDocument,
  sourceFingerprint: string,
): void {
  if (sourceFingerprint !== project.analysis.sourceFingerprint) {
    throw new Error(
      `元PDFが一致しません。「${project.analysis.fileName}」と同じファイルを選択してください。`,
    )
  }
}

/** PDF編集状態をJSONに保存できる文書へ組み立てる。 */
export function createPdfProjectDocument(
  analysis: PdfAnalysis,
  translations: ReadonlyMap<string, string>,
  excludedEntryIds: ReadonlySet<string>,
  protectedAreas: ReadonlyMap<number, readonly PdfProtectedArea[]>,
  backgroundMode: PdfBackgroundMode,
  textColorMode: PdfTextColorMode,
): PdfProjectDocument {
  return {
    version: PDF_PROJECT_VERSION,
    analysis,
    translations: [...translations],
    excludedEntryIds: [...excludedEntryIds],
    protectedAreas: [...protectedAreas].map(([page, areas]) => [page, [...areas]]),
    backgroundMode,
    textColorMode,
  }
}

/** PDF作業文書を保存用JSON文字列へ変換する。 */
export function serializePdfProject(document: PdfProjectDocument): string {
  return JSON.stringify(document, null, 2)
}

/** 作業JSONのバージョン・領域・参照を検証する。元PDFとの一致確認は復元時に別途行う。 */
export function parsePdfProject(text: string): PdfProjectDocument {
  if (new Blob([text]).size > FILE_LIMITS.textBytes)
    throw new Error('PDFプロジェクトは20 MiB以下にしてください。')
  let value: unknown
  try {
    value = migratePdfProject(JSON.parse(text))
  }
  catch {
    throw new Error('PDFプロジェクトJSONを読み込めませんでした。')
  }
  if (!isRecord(value) || value.version !== PDF_PROJECT_VERSION)
    throw new Error(`対応しているPDFプロジェクトのversionは${PDF_PROJECT_VERSION}です。`)
  if (!validAnalysis(value.analysis)
    || !Array.isArray(value.translations)
    || !Array.isArray(value.excludedEntryIds)
    || !Array.isArray(value.protectedAreas)
    || !['blend', 'white'].includes(String(value.backgroundMode))
    || !['original', 'black'].includes(String(value.textColorMode))) {
    throw new Error('PDFプロジェクトのデータ形式が不正です。')
  }

  const analysis = value.analysis as PdfAnalysis
  const entryIds = new Set(analysis.entries.map(entry => entry.id))
  const validTranslations = value.translations.every(item =>
    Array.isArray(item)
    && item.length === 2
    && typeof item[0] === 'string'
    && typeof item[1] === 'string'
    && item[1].length <= FILE_LIMITS.projectStringLength
    && entryIds.has(item[0]))
  const validExcludedIds = value.excludedEntryIds.every(id =>
    typeof id === 'string' && entryIds.has(id))
  const validProtectedAreas = value.protectedAreas.every(item =>
    Array.isArray(item)
    && item.length === 2
    && finiteNumber(item[0])
    && item[0] >= 1
    && item[0] <= analysis.pageCount
    && Array.isArray(item[1])
    && item[1].every(validArea))
  if (!validTranslations || !validExcludedIds || !validProtectedAreas)
    throw new Error('PDFプロジェクトの編集データが不正です。')
  return {
    version: PDF_PROJECT_VERSION,
    analysis,
    translations: value.translations as Array<[string, string]>,
    excludedEntryIds: value.excludedEntryIds as string[],
    protectedAreas: value.protectedAreas as Array<[number, PdfProtectedArea[]]>,
    backgroundMode: value.backgroundMode as PdfBackgroundMode,
    textColorMode: value.textColorMode as PdfTextColorMode,
  }
}
