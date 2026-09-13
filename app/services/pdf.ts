import type { PDFFont } from 'pdf-lib'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  createAutomaticTextMask,
  createBlendedBackground,
} from '~/utils/canvas/background'
import { fitText } from '~/utils/canvas/text'
import {
  assertCsvTextLimits,
  assertFileSize,
  assertImageDimensions,
  assertPdfPageDimensions,
  FILE_LIMITS,
} from '~/utils/file-limits'

export type PdfPageKind = 'text' | 'image'
export type PdfDocumentKind = PdfPageKind | 'mixed'
export type PdfViewportTransform = [number, number, number, number, number, number]

export interface PdfTextEntry {
  id: string
  pageNumber: number
  original: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export interface PdfPageAnalysis {
  pageNumber: number
  kind: PdfPageKind
  width: number
  height: number
  textCount: number
  rotation: number
  viewportTransform: PdfViewportTransform
}

export interface PdfDocumentFeatures {
  formFields: number
  links: number
  annotations: number
}

export interface PdfAnalysis {
  fileName: string
  sourceFingerprint: string
  kind: PdfDocumentKind
  pageCount: number
  pages: PdfPageAnalysis[]
  entries: PdfTextEntry[]
  features: PdfDocumentFeatures
}

export interface PdfTranslationRow {
  fileName: string
  pageNumber: number
  textId: string
  original: string
  translation: string
}

export interface PdfTranslationMatch {
  translations: Map<string, string>
  applied: number
  unmatched: number
  duplicateRows: number
  originalMismatches: number
  fileMismatches: number
}

export interface PdfProgress {
  current: number
  total: number
}

export type PdfBackgroundMode = 'blend' | 'white'
export type PdfTextColorMode = 'original' | 'black'

/** 大きなPDFとして処理前の確認を行うページ数の基準。 */
export const PDF_PAGE_WARNING_THRESHOLD = 100

export interface PdfProtectedArea {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfTranslationOptions {
  backgroundMode?: PdfBackgroundMode
  textColorMode?: PdfTextColorMode
  protectedAreas?: ReadonlyMap<number, readonly PdfProtectedArea[]>
  excludedEntryIds?: ReadonlySet<string>
  embeddedFontBytes?: ArrayBuffer
}

export interface PdfTextLayout {
  fontSize: number
  lineHeight: number
  lines: string[]
}

interface PdfFontMetrics {
  widthOfTextAtSize: (text: string, size: number) => number
}

export interface PositionedPdfTextItem {
  text: string
  x: number
  baselineY: number
  width: number
  height: number
  fontSize: number
  hasEOL: boolean
}

export interface PdfEntryMutation {
  analysis: PdfAnalysis
  retainedEntryId: string
  removedEntryIds: string[]
  createdEntryIds: string[]
}

interface PdfRectangle {
  x: number
  y: number
  width: number
  height: number
}

/** 行列を適用して点の座標系を変換する。 */
function transformedPoint(
  x: number,
  y: number,
  transform: PdfViewportTransform,
) {
  const [a, b, c, d, e, f] = transform
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

/** 座標変換を逆向きにたどる行列を求める。 */
function inverseTransform(transform: PdfViewportTransform): PdfViewportTransform {
  const [a, b, c, d, e, f] = transform
  const determinant = a * d - b * c
  if (Math.abs(determinant) < Number.EPSILON)
    throw new Error('PDFページの座標変換を逆算できません。')
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}

/** 矩形の四隅を変換して新しい境界を求める。 */
function transformedRectangle(
  rectangle: PdfRectangle,
  transform: PdfViewportTransform,
): PdfRectangle {
  const points = [
    transformedPoint(rectangle.x, rectangle.y, transform),
    transformedPoint(rectangle.x + rectangle.width, rectangle.y, transform),
    transformedPoint(rectangle.x, rectangle.y + rectangle.height, transform),
    transformedPoint(
      rectangle.x + rectangle.width,
      rectangle.y + rectangle.height,
      transform,
    ),
  ]
  const left = Math.min(...points.map(point => point.x))
  const right = Math.max(...points.map(point => point.x))
  const top = Math.min(...points.map(point => point.y))
  const bottom = Math.max(...points.map(point => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** PDF座標の矩形を、ページ回転を含むプレビュー座標へ変換する。 */
export function pdfRectangleToViewportBounds(
  rectangle: PdfRectangle,
  pageHeight: number,
  transform: PdfViewportTransform,
): PdfRectangle {
  const viewport = transformedRectangle(rectangle, transform)
  return {
    x: viewport.x,
    y: pageHeight - viewport.y - viewport.height,
    width: viewport.width,
    height: viewport.height,
  }
}

/** 画面上で選択した範囲を逆変換し、PDFへの書き出し位置に戻す。 */
export function viewportBoundsToPdfRectangle(
  bounds: PdfRectangle,
  page: Pick<PdfPageAnalysis, 'height' | 'viewportTransform'>,
): PdfRectangle {
  return transformedRectangle({
    x: bounds.x,
    y: page.height - bounds.y - bounds.height,
    width: bounds.width,
    height: bounds.height,
  }, inverseTransform(page.viewportTransform))
}

/** 回転したページへ画像を配置する位置・寸法・角度を求める。 */
export function pdfImagePlacement(
  bounds: PdfRectangle,
  page: Pick<PdfPageAnalysis, 'height' | 'rotation' | 'viewportTransform'>,
) {
  const rectangle = viewportBoundsToPdfRectangle(bounds, page)
  const rotation = ((page.rotation % 360) + 360) % 360
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error(`PDFページの回転角${page.rotation}度には対応していません。`)
  return {
    x: rotation === 90 || rotation === 180
      ? rectangle.x + rectangle.width
      : rectangle.x,
    y: rotation === 180 || rotation === 270
      ? rectangle.y + rectangle.height
      : rectangle.y,
    width: bounds.width,
    height: bounds.height,
    rotation,
  }
}

/** PDFフォントの実測幅で文字列を折り返す。 */
function wrapPdfText(
  font: PdfFontMetrics,
  text: string,
  size: number,
  width: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/gu)) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    for (const character of paragraph) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) {
        lines.push(line.trimEnd())
        line = character.trimStart()
      }
      else {
        line += character
      }
    }
    if (line)
      lines.push(line.trimEnd())
  }
  return lines
}

/** 指定範囲に収まるPDF訳文のサイズと行を探し、収まらない場合は最小サイズの結果を返す。 */
export function fitPdfText(
  font: PdfFontMetrics,
  text: string,
  width: number,
  height: number,
  requestedFontSize: number,
  minimumFontSize = 4,
): PdfTextLayout {
  const maximum = Math.max(minimumFontSize, requestedFontSize)
  for (let size = maximum; size >= minimumFontSize; size -= 0.5) {
    const lines = wrapPdfText(font, text, size, width)
    const lineHeight = size * 1.2
    if (lines.length * lineHeight <= height)
      return { fontSize: size, lineHeight, lines }
  }
  const lines = wrapPdfText(font, text, minimumFontSize, width)
  return {
    fontSize: minimumFontSize,
    lineHeight: minimumFontSize * 1.2,
    lines,
  }
}

/** 各行のPDF上の描画位置をページの変換に合わせて求める。 */
export function pdfTextLinePlacements(
  entry: PdfTextEntry,
  page: Pick<PdfPageAnalysis, 'height' | 'rotation' | 'viewportTransform'>,
  layout: PdfTextLayout,
) {
  const inverse = inverseTransform(page.viewportTransform)
  const top = page.height - entry.y - entry.height
  const rotation = ((page.rotation % 360) + 360) % 360
  return layout.lines.map((text, index) => {
    const baseline = transformedPoint(
      entry.x,
      top + layout.fontSize + index * layout.lineHeight,
      inverse,
    )
    return { text, x: baseline.x, y: baseline.y, rotation }
  })
}

/** 16進数の色をPDF用のRGB値へ変換する。 */
function pdfColor(hex: string) {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/iu.exec(hex)
  if (!match)
    return [0, 0, 0] as const
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ] as const
}

/** OCRした範囲と原文をPDFの文字項目へ追加する。 */
export function addPdfOcrEntry(
  analysis: PdfAnalysis,
  pageNumber: number,
  area: PdfProtectedArea,
  original: string,
): { analysis: PdfAnalysis, entry: PdfTextEntry } {
  const page = analysis.pages[pageNumber - 1]
  const normalized = original.trim()
  if (!page)
    throw new Error(`PDFの${pageNumber}ページが見つかりません。`)
  if (!normalized)
    throw new Error('OCRで文字を抽出できませんでした。')
  let sequence = 1
  const prefix = `p${String(pageNumber).padStart(4, '0')}-o`
  const usedIds = new Set(analysis.entries.map(candidate => candidate.id))
  let id = `${prefix}${String(sequence).padStart(4, '0')}`
  while (usedIds.has(id))
    id = `${prefix}${String(++sequence).padStart(4, '0')}`
  const lineCount = normalized.split(/\r?\n/gu).length
  const entry: PdfTextEntry = {
    id,
    pageNumber,
    original: normalized,
    x: area.x,
    y: page.height - area.y - area.height,
    width: area.width,
    height: area.height,
    fontSize: Math.max(1, Math.min(area.height / lineCount, 18)),
  }
  const entries = [...analysis.entries]
  const nextPageIndex = entries.findIndex(candidate =>
    candidate.pageNumber > pageNumber)
  entries.splice(nextPageIndex < 0 ? entries.length : nextPageIndex, 0, entry)
  return { analysis: { ...analysis, entries }, entry }
}

/** PDF読み込みの例外を利用者が判断できるエラーへ変換する。 */
export function normalizePdfLoadError(error: unknown): Error {
  if (error instanceof Error && error.name === 'PasswordException')
    return new Error('パスワード付きPDFには対応していません。解除したコピーを選択してください。')
  if (error instanceof Error && error.name === 'InvalidPDFException')
    return new Error('有効なPDFファイルを選択してください。')
  return error instanceof Error ? error : new Error('PDFを読み込めませんでした。')
}

/** PDF処理の失敗理由を画面用の説明へ変換する。 */
export function pdfProcessingErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const name = error instanceof Error ? error.name : ''
  const detail = error instanceof Error ? error.message : String(error ?? '')
  if (error instanceof RangeError
    || /out[ -]of[ -]memory|allocation failed|array buffer allocation|invalid array length|not enough memory|メモリ不足/iu.test(`${name} ${detail}`)) {
    return 'PDF処理に必要なメモリを確保できませんでした。他のタブを閉じるか、PDFを分割してから再試行してください。'
  }
  return error instanceof Error && error.message ? error.message : fallback
}

/** ページ数が処理前確認の基準を超えるか判定する。 */
export function requiresPdfPageWarning(pageCount: number): boolean {
  return pageCount > PDF_PAGE_WARNING_THRESHOLD
}

/** フォームや注釈などPDFの機能に関する注意点を列挙する。 */
export function pdfFeatureWarnings(features: PdfDocumentFeatures): string[] {
  const warnings: string[] = []
  if (features.formFields > 0)
    warnings.push(`フォーム${features.formFields}件は編集対象外です。出力後の入力値と動作を確認してください。`)
  if (features.links > 0)
    warnings.push(`リンク${features.links}件は編集せず保持します。出力後のリンク先を確認してください。`)
  if (features.annotations > 0)
    warnings.push(`注釈${features.annotations}件は編集せず保持します。出力後の表示を確認してください。`)
  return warnings
}

/** PDFのバイト列から元ファイル照合用のハッシュを計算する。 */
async function fingerprintPdfBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

/** PDFファイルを読み、照合用の指紋を返す。 */
export async function fingerprintPdfFile(file: Blob): Promise<string> {
  return fingerprintPdfBytes(await file.arrayBuffer())
}

/** 指定したPDF文字項目の原文を変更する。 */
export function updatePdfEntryOriginal(
  analysis: PdfAnalysis,
  entryId: string,
  original: string,
): PdfAnalysis {
  const normalized = original.trim()
  if (!normalized)
    throw new Error('抽出原文を入力してください。')
  if (!analysis.entries.some(entry => entry.id === entryId))
    throw new Error(`PDF文字「${entryId}」が見つかりません。`)
  return {
    ...analysis,
    entries: analysis.entries.map(entry => entry.id === entryId
      ? { ...entry, original: normalized }
      : entry),
  }
}

/** PDF文字項目の並び順を変更する。 */
export function movePdfEntry(
  analysis: PdfAnalysis,
  entryId: string,
  direction: -1 | 1,
): PdfAnalysis {
  const index = analysis.entries.findIndex(entry => entry.id === entryId)
  const entry = analysis.entries[index]
  if (!entry)
    return analysis
  const pageEntries = analysis.entries.filter(candidate =>
    candidate.pageNumber === entry.pageNumber)
  const pageIndex = pageEntries.findIndex(candidate => candidate.id === entryId)
  const adjacent = pageEntries[pageIndex + direction]
  if (!adjacent)
    return analysis
  const adjacentIndex = analysis.entries.findIndex(candidate =>
    candidate.id === adjacent.id)
  const entries = [...analysis.entries]
  const current = entries[index]!
  entries[index] = entries[adjacentIndex]!
  entries[adjacentIndex] = current
  return { ...analysis, entries }
}

/** 隣接するPDF文字項目の原文と範囲を一項目へまとめる。 */
export function mergePdfEntryWithNext(
  analysis: PdfAnalysis,
  entryId: string,
): PdfEntryMutation | null {
  const index = analysis.entries.findIndex(entry => entry.id === entryId)
  const entry = analysis.entries[index]
  if (!entry)
    return null
  const nextIndex = analysis.entries.findIndex((candidate, candidateIndex) =>
    candidateIndex > index && candidate.pageNumber === entry.pageNumber)
  const next = analysis.entries[nextIndex]
  if (!next)
    return null

  const x = Math.min(entry.x, next.x)
  const y = Math.min(entry.y, next.y)
  const right = Math.max(entry.x + entry.width, next.x + next.width)
  const top = Math.max(entry.y + entry.height, next.y + next.height)
  const merged: PdfTextEntry = {
    ...entry,
    original: `${entry.original}\n${next.original}`,
    x,
    y,
    width: right - x,
    height: top - y,
    fontSize: Math.min(entry.fontSize, next.fontSize),
  }
  const entries = analysis.entries
    .map(candidate => candidate.id === entry.id ? merged : candidate)
    .filter(candidate => candidate.id !== next.id)

  return {
    analysis: { ...analysis, entries },
    retainedEntryId: entry.id,
    removedEntryIds: [next.id],
    createdEntryIds: [],
  }
}

/** 改行位置でPDF文字項目を分け、分割先の範囲とIDを作る。 */
export function splitPdfEntryAtLines(
  analysis: PdfAnalysis,
  entryId: string,
  original: string,
): PdfEntryMutation | null {
  const index = analysis.entries.findIndex(entry => entry.id === entryId)
  const entry = analysis.entries[index]
  if (!entry)
    return null
  const lines = original
    .split(/\r?\n/gu)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length < 2)
    return null

  const usedIds = new Set(analysis.entries.map(candidate => candidate.id))
  const partHeight = entry.height / lines.length
  const createdEntryIds: string[] = []
  const splitEntries = lines.map((line, lineIndex): PdfTextEntry => {
    let id = entry.id
    if (lineIndex > 0) {
      let suffix = lineIndex + 1
      do id = `${entry.id}-s${suffix++}`
      while (usedIds.has(id))
      usedIds.add(id)
      createdEntryIds.push(id)
    }
    return {
      ...entry,
      id,
      original: line,
      y: entry.y + entry.height - (lineIndex + 1) * partHeight,
      height: partHeight,
      fontSize: Math.min(entry.fontSize, partHeight),
    }
  })
  const entries = [...analysis.entries]
  entries.splice(index, 1, ...splitEntries)

  return {
    analysis: { ...analysis, entries },
    retainedEntryId: entry.id,
    removedEntryIds: [],
    createdEntryIds,
  }
}

interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** PDF.jsの抽出結果が位置付き文字情報か判定する。 */
function isTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== 'object')
    return false
  const item = value as Partial<PdfTextItem>
  return typeof item.str === 'string'
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === 'number'
    && typeof item.height === 'number'
}

/** PDF内部の文字変換情報から位置・寸法・基線を求める。 */
function positionedTextItem(item: PdfTextItem): PositionedPdfTextItem | null {
  const text = item.str.replace(/\s+/gu, ' ').trim()
  if (!text)
    return null
  const fontSize = Math.max(
    1,
    Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
    item.height,
  )
  return {
    text,
    x: item.transform[4] ?? 0,
    baselineY: item.transform[5] ?? 0,
    width: Math.max(item.width, fontSize * 0.5),
    height: Math.max(item.height, fontSize),
    fontSize,
    hasEOL: Boolean(item.hasEOL),
  }
}

/** 文字情報をページの表示変換に合わせた編集座標へ変換する。 */
function viewportTextItem(
  item: PositionedPdfTextItem,
  pageHeight: number,
  transform: PdfViewportTransform,
): PositionedPdfTextItem {
  const bounds = pdfRectangleToViewportBounds({
    x: item.x,
    y: item.baselineY - item.height * 0.25,
    width: item.width,
    height: item.height * 1.25,
  }, pageHeight, transform)
  const height = bounds.height / 1.25
  return {
    ...item,
    x: bounds.x,
    baselineY: bounds.y + height * 0.25,
    width: bounds.width,
    height,
  }
}

/** 文字片の距離に応じて必要な空白を補い、本文を連結する。 */
function joinText(left: string, right: string, gap: number, fontSize: number) {
  if (gap <= fontSize * 0.2 || /^[,.;:!?)}\]]/u.test(right))
    return left + right
  return `${left} ${right}`
}

/** PDF内部の細かい文字片を、基線と横の距離を使って編集可能な一行にまとめる。 */
export function groupPdfTextItems(
  pageNumber: number,
  items: readonly PositionedPdfTextItem[],
): PdfTextEntry[] {
  const entries: PdfTextEntry[] = []
  let current: (PdfTextEntry & { baselineY: number, right: number }) | null = null

  const finish = () => {
    if (!current)
      return
    const { baselineY: _baselineY, right: _right, ...entry } = current
    entries.push(entry)
    current = null
  }

  for (const item of items) {
    const sameLine = current
      && Math.abs(current.baselineY - item.baselineY)
      <= Math.max(current.height, item.height) * 0.45
    const gap = current ? item.x - current.right : 0
    const follows = sameLine
      && gap >= -item.fontSize * 0.25
      && gap <= Math.max(24, item.fontSize * 3)
    if (!current || !follows) {
      finish()
      current = {
        id: '',
        pageNumber,
        original: item.text,
        x: item.x,
        y: item.baselineY - item.height * 0.25,
        width: item.width,
        height: item.height * 1.25,
        fontSize: item.fontSize,
        baselineY: item.baselineY,
        right: item.x + item.width,
      }
    }
    else {
      current.original = joinText(
        current.original,
        item.text,
        gap,
        item.fontSize,
      )
      current.right = Math.max(current.right, item.x + item.width)
      current.width = current.right - current.x
      current.y = Math.min(current.y, item.baselineY - item.height * 0.25)
      current.height = Math.max(current.height, item.height * 1.25)
      current.fontSize = Math.max(current.fontSize, item.fontSize)
    }
    if (item.hasEOL)
      finish()
  }
  finish()

  return entries.map((entry, index) => ({
    ...entry,
    id: `p${String(pageNumber).padStart(4, '0')}-t${String(index + 1).padStart(4, '0')}`,
  }))
}

/** 文字情報をページ順に抽出する。画像だけのページは分類のみ行い、OCRは別操作に任せる。 */
export async function analyzePdf(
  file: File,
  onProgress?: (progress: PdfProgress) => void,
  signal?: AbortSignal,
  confirmPageCount?: (pageCount: number) => boolean | Promise<boolean>,
): Promise<PdfAnalysis> {
  signal?.throwIfAborted()
  assertFileSize(file, FILE_LIMITS.pdfBytes, 'PDF')
  const pdfjs = await import('pdfjs-dist')
  signal?.throwIfAborted()
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const sourceBytes = await file.arrayBuffer()
  const sourceFingerprint = await fingerprintPdfBytes(sourceBytes)
  signal?.throwIfAborted()
  const task = pdfjs.getDocument({ data: sourceBytes })
  const pdfDocument = await task.promise.catch(async (error: unknown) => {
    await task.destroy()
    throw normalizePdfLoadError(error)
  })
  const pages: PdfPageAnalysis[] = []
  const entries: PdfTextEntry[] = []
  const features: PdfDocumentFeatures = {
    formFields: 0,
    links: 0,
    annotations: 0,
  }
  try {
    signal?.throwIfAborted()
    if (confirmPageCount && !await confirmPageCount(pdfDocument.numPages))
      throw new Error(`${pdfDocument.numPages}ページのPDF読み込みを中止しました。`)
    signal?.throwIfAborted()
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      signal?.throwIfAborted()
      const page = await pdfDocument.getPage(pageNumber)
      try {
        const viewport = page.getViewport({ scale: 1 })
        const viewportTransform = [...viewport.transform] as PdfViewportTransform
        assertPdfPageDimensions(viewport.width, viewport.height)
        const content = await page.getTextContent()
        const annotations = await page.getAnnotations({ intent: 'display' })
        signal?.throwIfAborted()
        for (const annotation of annotations) {
          if (annotation.annotationType === pdfjs.AnnotationType.WIDGET)
            features.formFields += 1
          else if (annotation.annotationType === pdfjs.AnnotationType.LINK)
            features.links += 1
          else
            features.annotations += 1
        }
        const items: PositionedPdfTextItem[] = []
        for (const rawItem of content.items) {
          if (!isTextItem(rawItem))
            continue
          const item = positionedTextItem(rawItem)
          if (item)
            items.push(viewportTextItem(item, viewport.height, viewportTransform))
        }
        const pageEntries = groupPdfTextItems(pageNumber, items)
        const kind: PdfPageKind = pageEntries.length > 0 ? 'text' : 'image'
        pages.push({
          pageNumber,
          kind,
          width: viewport.width,
          height: viewport.height,
          textCount: pageEntries.length,
          rotation: viewport.rotation,
          viewportTransform,
        })
        entries.push(...pageEntries)
        onProgress?.({ current: pageNumber, total: pdfDocument.numPages })
      }
      finally {
        page.cleanup()
      }
    }
  }
  finally {
    await task.destroy()
  }
  const textPages = pages.filter(page => page.kind === 'text').length
  const kind: PdfDocumentKind = textPages === pages.length
    ? 'text'
    : textPages === 0
      ? 'image'
      : 'mixed'
  return {
    fileName: file.name,
    sourceFingerprint,
    kind,
    pageCount: pages.length,
    pages,
    entries,
    features,
  }
}

/** 表計算ソフトが数式として扱う先頭文字を無害化する。 */
function neutralizeFormula(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/u.test(value) ? `\t${value}` : value
}

/** 引用符と区切り文字をCSVセルとして安全に書き出せる形へ変換する。 */
function escapeCell(value: string) {
  const safeValue = neutralizeFormula(value)
  return /[",\r\n\t]/u.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue
}

/** 引用符内の改行やカンマを保持してCSVのレコードを読み取る。 */
function parseRecords(csv: string): string[][] {
  assertCsvTextLimits(csv)
  const records: string[][] = []
  let record: string[] = []
  let value = ''
  let quoted = false
  const finish = () => {
    record.push(restoreFormulaValue(value))
    if (record.some(cell => cell.length > 0))
      records.push(record)
    if (records.length > FILE_LIMITS.csvRows)
      throw new Error(`CSVは${FILE_LIMITS.csvRows}行以下にしてください。`)
    record = []
    value = ''
  }
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"'
        index += 1
      }
      else {
        quoted = !quoted
      }
    }
    else if (character === ',' && !quoted) {
      record.push(restoreFormulaValue(value))
      value = ''
    }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n')
        index += 1
      if (quoted)
        value += '\n'
      else
        finish()
    }
    else {
      value += character
    }
  }
  if (quoted)
    throw new Error('CSVの引用符が閉じられていません。')
  if (record.length > 0 || value.length > 0)
    finish()
  return records
}

/** CSV書き出し時に付けた数式対策の接頭辞を読み戻す。 */
function restoreFormulaValue(value: string): string {
  return /^\t[\t\r\n ]*[=+\-@]/u.test(value) ? value.slice(1) : value
}

/** PDFの原文と訳文を項目ID付きのCSVへ変換する。 */
export function serializePdfTranslationCsv(
  analysis: PdfAnalysis,
  translations: ReadonlyMap<string, string> = new Map(),
  excludedEntryIds: ReadonlySet<string> = new Set(),
) {
  const rows = analysis.entries
    .filter(entry => !excludedEntryIds.has(entry.id))
    .map(entry => [
      analysis.fileName,
      String(entry.pageNumber),
      analysis.pages[entry.pageNumber - 1]?.kind ?? 'text',
      entry.id,
      entry.original,
      translations.get(entry.id) ?? '',
    ].map(escapeCell).join(','))
  return [
    '\uFEFFpdf_name (readonly),page (readonly),page_type (readonly),text_id,original (readonly),translation',
    ...rows,
  ].join('\r\n')
}

/** PDF翻訳CSVを検証し、項目ごとの原文と訳文へ変換する。 */
export function parsePdfTranslationCsv(csv: string): PdfTranslationRow[] {
  const records = parseRecords(csv.replace(/^\uFEFF/u, ''))
  if (records.length === 0)
    return []
  const headers = records[0]!.map(header =>
    header.trim().replace(/\s*\(readonly\)$/iu, ''),
  )
  const fileIndex = headers.indexOf('pdf_name')
  const pageIndex = headers.indexOf('page')
  const idIndex = headers.indexOf('text_id')
  const originalIndex = headers.indexOf('original')
  const translationIndex = headers.indexOf('translation')
  if (idIndex < 0 || translationIndex < 0)
    throw new Error('PDF翻訳CSVには text_id と translation 列が必要です。')
  return records.slice(1).map(values => ({
    fileName: fileIndex < 0 ? '' : (values[fileIndex] ?? ''),
    pageNumber: pageIndex < 0 ? 0 : Number(values[pageIndex] ?? 0),
    textId: values[idIndex]?.trim() ?? '',
    original: originalIndex < 0 ? '' : (values[originalIndex] ?? ''),
    translation: values[translationIndex] ?? '',
  }))
}

/** CSVの識別子と原文を照合し、該当する訳だけを既存の翻訳Mapへ重ねる。 */
export function matchPdfTranslations(
  analysis: PdfAnalysis,
  rows: readonly PdfTranslationRow[],
  existing: ReadonlyMap<string, string> = new Map(),
): PdfTranslationMatch {
  const translations = new Map(existing)
  const seen = new Set<string>()
  let unmatched = 0
  let duplicateRows = 0
  let originalMismatches = 0
  let fileMismatches = 0
  for (const row of rows) {
    const entry = analysis.entries.find(item => item.id === row.textId)
    if (!entry || !row.textId) {
      unmatched += 1
      continue
    }
    if (row.fileName && row.fileName !== analysis.fileName) {
      fileMismatches += 1
      continue
    }
    if (row.original && row.original !== entry.original)
      originalMismatches += 1
    if (seen.has(row.textId))
      duplicateRows += 1
    seen.add(row.textId)
    translations.set(row.textId, row.translation)
  }
  return {
    translations,
    applied: seen.size,
    unmatched,
    duplicateRows,
    originalMismatches,
    fileMismatches,
  }
}

/** Canvasの描画内容をPNGのBlobへ変換する。 */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else reject(new Error('PDF訳文画像を作成できませんでした。'))
    }, 'image/png')
  })
}

export interface PdfPageRaster {
  image: ImageData
  pageHeight: number
  scale: number
}

/** 対象文字の周囲から、原文を隠すための背景画像を作る。 */
export function createPdfBackgroundPatch(
  entry: PdfTextEntry,
  background: PdfPageRaster,
  padding: number,
) {
  const width = Math.max(8, entry.width + padding * 2)
  const height = Math.max(10, entry.height + padding * 2)
  const bounds = {
    x: (entry.x - padding) * background.scale,
    y: (
      background.pageHeight - entry.y - entry.height - padding
    ) * background.scale,
    width: width * background.scale,
    height: height * background.scale,
  }
  return createBlendedBackground(
    background.image,
    background.image.width,
    background.image.height,
    bounds,
    '#ffffff',
  )
}

/** PDF文字項目の範囲をラスタ画像の画素範囲へ換算する。 */
function entryRasterBounds(
  entry: PdfTextEntry,
  background: PdfPageRaster,
  padding: number,
) {
  const width = Math.max(8, entry.width + padding * 2)
  const height = Math.max(10, entry.height + padding * 2)
  return {
    x: (entry.x - padding) * background.scale,
    y: (background.pageHeight - entry.y - entry.height - padding)
      * background.scale,
    width: width * background.scale,
    height: height * background.scale,
  }
}

/** 昇順の中央要素を返す。偶数個なら中央の大きい方、空なら0。 */
function median(values: number[]) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** RGBの各値を16進数の色文字列へ変換する。 */
function colorHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map(value => Math.round(value).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Estimates the original glyph color from pixels that differ from the repaired background. */
export function estimatePdfTextColor(
  entry: PdfTextEntry,
  background: PdfPageRaster,
  padding = 2,
) {
  const bounds = entryRasterBounds(entry, background, padding)
  const patch = createPdfBackgroundPatch(entry, background, padding)
  const mask = createAutomaticTextMask(
    background.image,
    patch,
    bounds,
    65,
    true,
  )
  const startX = Math.round(bounds.x)
  const startY = Math.round(bounds.y)
  const candidates: Array<{ red: number, green: number, blue: number, difference: number }> = []
  for (let y = 0; y < patch.height; y += 1) {
    for (let x = 0; x < patch.width; x += 1) {
      const pixel = y * patch.width + x
      if ((mask[pixel] ?? 0) < 128)
        continue
      const sourceX = Math.max(0, Math.min(background.image.width - 1, startX + x))
      const sourceY = Math.max(0, Math.min(background.image.height - 1, startY + y))
      const sourceIndex = (sourceY * background.image.width + sourceX) * 4
      const patchIndex = pixel * 4
      const red = background.image.data[sourceIndex] ?? 0
      const green = background.image.data[sourceIndex + 1] ?? 0
      const blue = background.image.data[sourceIndex + 2] ?? 0
      const deltaRed = red - (patch.data[patchIndex] ?? 0)
      const deltaGreen = green - (patch.data[patchIndex + 1] ?? 0)
      const deltaBlue = blue - (patch.data[patchIndex + 2] ?? 0)
      const difference = Math.hypot(deltaRed, deltaGreen, deltaBlue)
      if (difference >= 32)
        candidates.push({ red, green, blue, difference })
    }
  }
  if (candidates.length < 3)
    return '#000000'
  const cutoff = median(candidates.map(candidate => candidate.difference))
  const foreground = candidates.filter(candidate => candidate.difference >= cutoff)
  return colorHex(
    median(foreground.map(candidate => candidate.red)),
    median(foreground.map(candidate => candidate.green)),
    median(foreground.map(candidate => candidate.blue)),
  )
}

/** Protection areas use PDF page coordinates with a top-left origin. */
export function isPdfEntryProtected(
  entry: PdfTextEntry,
  pageHeight: number,
  protectedAreas: readonly PdfProtectedArea[],
) {
  const top = pageHeight - entry.y - entry.height
  return protectedAreas.some(area =>
    entry.x < area.x + area.width
    && entry.x + entry.width > area.x
    && top < area.y + area.height
    && top + entry.height > area.y,
  )
}

/** 空訳・原文と同じ訳・除外項目・保護領域を取り除き、実際に上書きする項目だけを返す。 */
export function entriesForPdfTranslation(
  analysis: PdfAnalysis,
  translations: ReadonlyMap<string, string>,
  options: PdfTranslationOptions = {},
): PdfTextEntry[] {
  return analysis.entries
    .filter((entry) => {
      if (options.excludedEntryIds?.has(entry.id))
        return false
      const value = translations.get(entry.id)?.trim()
      const pageHeight = analysis.pages[entry.pageNumber - 1]?.height ?? 0
      const protectedOnPage = options.protectedAreas?.get(entry.pageNumber) ?? []
      return Boolean(value
        && value !== entry.original
        && !isPdfEntryProtected(entry, pageHeight, protectedOnPage))
    })
    .toSorted((left, right) => left.pageNumber - right.pageNumber)
}

/** 周辺から作った背景または白背景の上に訳文を描き、PDFへ重ねる画像を作る。 */
export function createPdfTranslationPatch(
  entry: PdfTextEntry,
  text: string,
  backgroundMode: PdfBackgroundMode,
  background?: PdfPageRaster,
  textColor = '#000000',
  fontFamily = 'sans-serif',
) {
  const scale = background?.scale ?? 3
  const padding = 2
  const width = Math.max(8, entry.width + padding * 2)
  const height = Math.max(10, entry.height + padding * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('PDF訳文用Canvasを初期化できませんでした。')

  if (backgroundMode === 'blend' && background) {
    const patch = createPdfBackgroundPatch(entry, background, padding)
    context.putImageData(patch, 0, 0)
  }
  else {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  const layout = fitText(
    context,
    text,
    entry.width * scale,
    entry.height * scale,
    entry.fontSize * scale,
    4 * scale,
    fontFamily,
  )
  context.fillStyle = textColor
  context.font = `${layout.fontSize}px ${fontFamily}`
  context.textBaseline = 'top'
  layout.lines.forEach((line, index) => {
    context.fillText(
      line,
      padding * scale,
      padding * scale + index * layout.lineHeight,
    )
  })
  return { canvas, width, height, padding }
}

/** 指定したPDFページを画像へ描画し、PNGのBlobを返す。 */
export async function renderPdfPagePreview(
  source: File,
  pageNumber: number,
  scale = 2,
): Promise<Blob> {
  assertFileSize(source, FILE_LIMITS.pdfBytes, 'PDF')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const task = pdfjs.getDocument({ data: await source.arrayBuffer() })
  try {
    const page = await task.promise.then(document => document.getPage(pageNumber))
    const viewport = page.getViewport({ scale })
    assertPdfPageDimensions(viewport.width / scale, viewport.height / scale)
    assertImageDimensions(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
      'PDFプレビュー',
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('PDFプレビュー用Canvasを初期化できませんでした。')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    page.cleanup()
    return await canvasBlob(canvas)
  }
  finally {
    await task.destroy()
  }
}

/** 元PDFに背景と訳文を重ねる。フォント指定時は文字、未指定時は画像として出力する。 */
export async function createTranslatedPdf(
  source: File,
  analysis: PdfAnalysis,
  translations: ReadonlyMap<string, string>,
  onProgress?: (progress: PdfProgress) => void,
  options: PdfTranslationOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted()
  assertFileSize(source, FILE_LIMITS.pdfBytes, 'PDF')
  const { degrees, PDFDocument, rgb } = await import('pdf-lib')
  const pdfDocument = await PDFDocument.load(await source.arrayBuffer())
  signal?.throwIfAborted()
  let embeddedFont: PDFFont | null = null
  if (options.embeddedFontBytes) {
    const { default: fontkit } = await import('@pdf-lib/fontkit')
    pdfDocument.registerFontkit(fontkit)
    embeddedFont = await pdfDocument.embedFont(options.embeddedFontBytes, {
      subset: true,
    })
  }
  const translated = entriesForPdfTranslation(analysis, translations, options)
  const translatedPageNumbers = [...new Set(
    translated.map(entry => entry.pageNumber),
  )]
  const backgroundMode = options.backgroundMode ?? 'blend'
  const textColorMode = options.textColorMode ?? 'original'
  const pdfjs = backgroundMode === 'blend' || textColorMode === 'original'
    ? await import('pdfjs-dist')
    : null
  if (pdfjs)
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const rasterTask = pdfjs
    ? pdfjs.getDocument({ data: await source.arrayBuffer() })
    : null
  const rasterDocument = rasterTask ? await rasterTask.promise : null
  let rasterPageNumber = 0
  let raster: PdfPageRaster | undefined

  try {
    for (const [index, entry] of translated.entries()) {
      signal?.throwIfAborted()
      const page = pdfDocument.getPage(entry.pageNumber - 1)
      if (!page)
        continue
      if (rasterPageNumber !== entry.pageNumber && rasterDocument) {
        const rasterPage = await rasterDocument.getPage(entry.pageNumber)
        try {
          const rasterScale = 3
          const viewport = rasterPage.getViewport({ scale: rasterScale })
          assertImageDimensions(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
            'PDF背景画像',
          )
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context)
            throw new Error('PDF背景用Canvasを初期化できませんでした。')
          await rasterPage.render({ canvas, canvasContext: context, viewport }).promise
          signal?.throwIfAborted()
          raster = {
            image: context.getImageData(0, 0, canvas.width, canvas.height),
            pageHeight: analysis.pages[entry.pageNumber - 1]?.height
              ?? page.getHeight(),
            scale: rasterScale,
          }
          rasterPageNumber = entry.pageNumber
        }
        finally {
          rasterPage.cleanup()
        }
      }
      const translation = translations.get(entry.id)!.trim()
      const textColor = textColorMode === 'original' && raster
        ? estimatePdfTextColor(entry, raster)
        : '#000000'
      const patch = createPdfTranslationPatch(
        entry,
        embeddedFont ? '' : translation,
        backgroundMode,
        raster,
        textColor,
      )
      const blob = await canvasBlob(patch.canvas)
      signal?.throwIfAborted()
      const image = await pdfDocument.embedPng(await blob.arrayBuffer())
      const analysisPage = analysis.pages[entry.pageNumber - 1]
      if (!analysisPage)
        continue
      const placement = pdfImagePlacement({
        x: entry.x - patch.padding,
        y: entry.y - patch.padding,
        width: patch.width,
        height: patch.height,
      }, analysisPage)
      page.drawImage(image, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotate: degrees(placement.rotation),
      })
      if (embeddedFont) {
        const layout = fitPdfText(
          embeddedFont,
          translation,
          entry.width,
          entry.height,
          entry.fontSize,
        )
        const [red, green, blue] = pdfColor(textColor)
        for (const line of pdfTextLinePlacements(entry, analysisPage, layout)) {
          if (!line.text)
            continue
          page.drawText(line.text, {
            x: line.x,
            y: line.y,
            size: layout.fontSize,
            lineHeight: layout.lineHeight,
            font: embeddedFont,
            color: rgb(red, green, blue),
            rotate: degrees(line.rotation),
          })
        }
      }
      if (translated[index + 1]?.pageNumber !== entry.pageNumber) {
        onProgress?.({
          current: translatedPageNumbers.indexOf(entry.pageNumber) + 1,
          total: translatedPageNumbers.length,
        })
      }
    }
  }
  finally {
    raster = undefined
    if (rasterTask)
      await rasterTask.destroy()
  }
  signal?.throwIfAborted()
  const bytes = await pdfDocument.save()
  signal?.throwIfAborted()
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' })
}
