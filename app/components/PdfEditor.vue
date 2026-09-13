<script setup lang="ts">
import type {
  PdfAnalysis,
  PdfBackgroundMode,
  PdfProgress,
  PdfProtectedArea,
  PdfTextColorMode,
} from '~/services/pdf'
import type { PdfProjectDocument } from '~/services/pdf-project'
import { loadUserFont } from '~/services/fonts/user-font'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { TesseractOCRProvider } from '~/services/ocr/tesseract'
import {
  addPdfOcrEntry,
  analyzePdf,
  createTranslatedPdf,
  fingerprintPdfFile,
  isPdfEntryProtected,
  matchPdfTranslations,
  mergePdfEntryWithNext,
  movePdfEntry,
  parsePdfTranslationCsv,
  pdfFeatureWarnings,
  pdfProcessingErrorMessage,
  renderPdfPagePreview,
  requiresPdfPageWarning,
  serializePdfTranslationCsv,
  splitPdfEntryAtLines,
  updatePdfEntryOriginal,
} from '~/services/pdf'
import {
  assertPdfProjectSource,
  createPdfProjectDocument,
  parsePdfProject,
  serializePdfProject,
} from '~/services/pdf-project'
import { downloadBlob, downloadText } from '~/utils/download'
import { consumeSelectedFile } from '~/utils/file-input'
import {
  assertCsvTextLimits,
  assertFileSize,
  FILE_LIMITS,
} from '~/utils/file-limits'

/** 元PDFを選ぶための入力要素。 */
const pdfInput = ref<HTMLInputElement | null>(null)
/** 翻訳CSVを選ぶための入力要素。 */
const csvInput = ref<HTMLInputElement | null>(null)
/** PDF作業プロジェクトのJSONを選ぶ入力要素。 */
const projectInput = ref<HTMLInputElement | null>(null)
/** PDFへ埋め込むフォントを選ぶ入力要素。 */
const pdfFontInput = ref<HTMLInputElement | null>(null)
/** 元PDFの選択と照合を待っている作業データ。 */
const pendingPdfProject = shallowRef<PdfProjectDocument | null>(null)
/** 編集中PDFの元ファイル。 */
const sourceFile = shallowRef<File | null>(null)
/** 解析済みのページ情報と編集対象の文字項目。 */
const analysis = shallowRef<PdfAnalysis | null>(null)
/** 文字項目IDと編集済みの訳文の対応表。 */
const translations = shallowRef(new Map<string, string>())
/** PDFの解析・復元・書き出し等の処理中か。 */
const processing = ref(false)
/** 実行中のPDF処理を画面で説明するラベル。 */
const processingLabel = ref('')
/** PDF処理の現在ページと総ページ数。 */
const pdfProgress = ref<PdfProgress | null>(null)
/** 現在のPDF処理を中止するためのコントローラー。 */
const processingController = shallowRef<AbortController | null>(null)
/** 操作結果や失敗理由を画面へ通知するメッセージ。 */
const message = ref('')
/** 原文を隠す背景の生成方式。 */
const backgroundMode = ref<PdfBackgroundMode>('blend')
/** 訳文の色を元画像から推定するか固定するかの設定。 */
const textColorMode = ref<PdfTextColorMode>('original')
/** 検索可能な訳文を出力するための埋め込みフォントデータ。 */
const pdfFontBlob = shallowRef<Blob | null>(null)
/** プレビュー用に読み込んだPDF訳文のFontFace。 */
const pdfFontFace = shallowRef<FontFace | null>(null)
/** PDF訳文プレビューに使用するfamily名。 */
const pdfFontFamily = ref('sans-serif')
/** 選択したPDFフォントの表示名。 */
const pdfFontName = ref('')
/** プレビュー中のPDFページ番号。1から始まる。 */
const previewPageNumber = ref(1)
/** 描画済みPDFページの表示用画像。 */
const previewImage = shallowRef<HTMLImageElement | null>(null)
/** PDFページ画像に割り当てた解放対象の一時URL。 */
const previewUrl = ref<string | null>(null)
/** PDFページのプレビューを生成・読み込み中か。 */
const previewLoading = ref(false)
/** PDFプレビューの表示倍率。100が等倍。 */
const previewZoom = ref(100)
/** PDF内で選択している文字項目のID。 */
const selectedEntryId = ref<string | null>(null)
/** 選択したPDF文字項目の、確定前の原文編集値。 */
const originalDraft = ref('')
/** 翻訳の書き出し対象から外すPDF文字項目のID。 */
const excludedEntryIds = shallowRef(new Set<string>())
/** PDF上で保護領域を指定しているか。 */
const protectionEditing = ref(false)
/** PDF上でOCR対象範囲を指定しているか。 */
const ocrEditing = ref(false)
/** OCR処理を実行しているか。 */
const ocrRunning = ref(false)
/** OCRエンジンから通知された進捗値。 */
const ocrProgress = ref(0)
/** OCRエンジンが現在実行している処理の説明。 */
const ocrStatus = ref('')
/** ブラウザ内で英語OCRを実行するWorkerの管理窓口。 */
const ocrProvider = new TesseractOCRProvider(useRuntimeConfig().app.baseURL)
/** PDFページ番号ごとに保持する保護領域。 */
const protectedAreas = shallowRef(
  new Map<number, readonly PdfProtectedArea[]>(),
)
/** 多数ページの処理について、利用者の回答を待つ確認情報。 */
const largePdfWarning = shallowRef<{
  pageCount: number
  resolve: (confirmed: boolean) => void
} | null>(null)

/** PDF作業データを最後に保存した時点の比較用文字列。 */
const lastSavedSignature = ref<string | null>(null)
/** 現在のPDF作業データを保存形式で表した比較用文字列。 */
const projectSignature = computed(() => analysis.value
  ? serializePdfProject(createPdfProjectDocument(
      analysis.value,
      translations.value,
      excludedEntryIds.value,
      protectedAreas.value,
      backgroundMode.value,
      textColorMode.value,
    ))
  : null)
/** 画面終了後の非同期結果を反映しないための終了フラグ。 */
let disposed = false
/** 最新のPDFプレビュー要求を識別する連番。 */
let previewRequest = 0

/** 文字ページ・画像ページなどの解析結果の要約。 */
const summary = computed(() => {
  if (!analysis.value)
    return ''
  const textPages = analysis.value.pages.filter(page => page.kind === 'text').length
  const imagePages = analysis.value.pageCount - textPages
  const kind = analysis.value.kind === 'text'
    ? '文字PDF'
    : analysis.value.kind === 'image'
      ? '画像PDF'
      : '混在PDF'
  return `${kind}: 文字${textPages}ページ／画像${imagePages}ページ`
})
/** 元PDFのフォームや注釈等から生成する互換性の注意点。 */
const compatibilityWarnings = computed(() =>
  analysis.value ? pdfFeatureWarnings(analysis.value.features) : [],
)

/** 除外指定を考慮した、入力済みの訳文数。 */
const translationCount = computed(() =>
  [...translations.value.entries()].filter(([id, value]) =>
    value.trim() && !excludedEntryIds.value.has(id)).length,
)
/** 除外指定を除いたCSV対象の文字項目数。 */
const exportEntryCount = computed(() =>
  (analysis.value?.entries.length ?? 0) - excludedEntryIds.value.size,
)
/** 保護領域との重なりによって上書き対象から外れる訳文数。 */
const protectedTranslationCount = computed(() =>
  analysis.value?.entries.filter((entry) => {
    if (excludedEntryIds.value.has(entry.id))
      return false
    const translation = translations.value.get(entry.id)?.trim()
    const page = analysis.value?.pages[entry.pageNumber - 1]
    return translation
      && translation !== entry.original
      && page
      && isPdfEntryProtected(
        entry,
        page.height,
        protectedAreas.value.get(entry.pageNumber) ?? [],
      )
  }).length ?? 0,
)

/** 表示中ページの寸法・回転などの解析情報。 */
const previewPage = computed(() =>
  analysis.value?.pages[previewPageNumber.value - 1] ?? null,
)
/** 表示中ページに属する文字項目。 */
const previewEntries = computed(() =>
  analysis.value?.entries.filter(
    entry => entry.pageNumber === previewPageNumber.value,
  ) ?? [],
)
/** 表示中ページから選択IDで求めた文字項目。 */
const selectedEntry = computed(() =>
  previewEntries.value.find(entry => entry.id === selectedEntryId.value) ?? null,
)
/** 選択項目のページ内の順序と総数。 */
const selectedEntryOrder = computed(() => ({
  index: previewEntries.value.findIndex(entry =>
    entry.id === selectedEntryId.value),
  total: previewEntries.value.length,
}))
/** 原文が複数の空でない行を持ち、行分割できるか。 */
const canSplitSelectedEntry = computed(() =>
  originalDraft.value
    .split(/\r?\n/gu)
    .filter(line => line.trim())
    .length >= 2,
)
/** 表示中ページに設定されている保護領域。 */
const pageProtectedAreas = computed(() =>
  protectedAreas.value.get(previewPageNumber.value) ?? [],
)

/** 未保存・処理中の状態に応じた離脱確認の表示と回答窓口。 */
const { leaveConfirmationOpen, confirmLeave, resolveLeave } = useUnsavedChanges(
  () => Boolean(analysis.value) && (
    projectSignature.value !== lastSavedSignature.value
    || originalDraft.value !== (selectedEntry.value?.original ?? '')
  ),
  () => processing.value || ocrRunning.value,
)

// 選択項目が変わったら原文の編集用下書きを入れ替える。
watch(selectedEntry, (entry) => {
  originalDraft.value = entry?.original ?? ''
}, { immediate: true })

// 画面終了時に非同期処理を無効化し、確認待ち・画像・フォント等を解放する。
onBeforeUnmount(() => {
  disposed = true
  previewRequest += 1
  processingController.value?.abort()
  largePdfWarning.value?.resolve(false)
  if (previewUrl.value)
    URL.revokeObjectURL(previewUrl.value)
  void ocrProvider.dispose?.().catch(() => undefined)
  if (pdfFontFace.value)
    document.fonts.delete(pdfFontFace.value)
})

/** 多数ページのPDFについて処理継続の回答を待つ。 */
function confirmLargePdfPageCount(pageCount: number): Promise<boolean> {
  if (!requiresPdfPageWarning(pageCount))
    return Promise.resolve(true)
  largePdfWarning.value?.resolve(false)
  return new Promise<boolean>((resolve) => {
    largePdfWarning.value = { pageCount, resolve }
  })
}

/** PDFページ数の確認に対する回答を待機中の処理へ返す。 */
function resolveLargePdfWarning(confirmed: boolean) {
  const warning = largePdfWarning.value
  if (!warning)
    return
  largePdfWarning.value = null
  warning.resolve(confirmed)
}

/** 連続したページ変更では最新要求だけを採用し、不要になった画像URLを解放する。 */
async function loadPreview(pageNumber: number) {
  if (!sourceFile.value || !analysis.value)
    return
  previewLoading.value = true
  const request = ++previewRequest
  let nextUrl: string | null = null
  try {
    const blob = await renderPdfPagePreview(sourceFile.value, pageNumber)
    if (disposed || request !== previewRequest)
      return
    const url = URL.createObjectURL(blob)
    nextUrl = url
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('PDFプレビュー画像を読み込めませんでした。'))
      image.src = url
    })
    if (disposed || request !== previewRequest)
      return
    if (previewUrl.value)
      URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = url
    nextUrl = null
    previewImage.value = image
    previewPageNumber.value = pageNumber
    selectedEntryId.value = previewEntries.value[0]?.id ?? null
    protectionEditing.value = false
    ocrEditing.value = false
  }
  catch (error) {
    message.value = pdfProcessingErrorMessage(
      error,
      'PDFプレビューを作成できませんでした。',
    )
  }
  finally {
    if (nextUrl)
      URL.revokeObjectURL(nextUrl)
    if (request === previewRequest)
      previewLoading.value = false
  }
}

/** 選んだPDFページのプレビュー読み込みを開始する。 */
function selectPreviewPage(event: Event) {
  const pageNumber = Number((event.target as HTMLSelectElement).value)
  void loadPreview(pageNumber)
}

/** 表示中のPDFページに保護領域を追加する。 */
function addProtectedArea(area: PdfProtectedArea) {
  const next = new Map(protectedAreas.value)
  const pageNumber = previewPageNumber.value
  next.set(pageNumber, [...(next.get(pageNumber) ?? []), area])
  protectedAreas.value = next
}

/** 画像PDFの指定範囲をOCRし、文字抽出で得た項目と同じ編集一覧へ追加する。 */
async function addOcrArea(area: PdfProtectedArea) {
  const current = analysis.value
  const page = previewPage.value
  const image = previewImage.value
  if (!current || !page || !image || ocrRunning.value)
    return
  ocrRunning.value = true
  ocrProgress.value = 0
  ocrStatus.value = 'OCRを初期化しています…'
  try {
    const rasterScale = image.naturalWidth / page.width
    const blob = await prepareRegionForOCR(image, {
      x: area.x * rasterScale,
      y: area.y * rasterScale,
      width: area.width * rasterScale,
      height: area.height * rasterScale,
    }, { scale: 2, padding: 8 })
    const result = await ocrProvider.recognize(blob, {
      language: 'eng',
      layout: 'text-block',
      onProgress: (progress) => {
        ocrProgress.value = progress.progress
        ocrStatus.value = progress.status
      },
    })
    if (analysis.value !== current || previewPageNumber.value !== page.pageNumber)
      return
    const added = addPdfOcrEntry(current, page.pageNumber, area, result.text)
    analysis.value = added.analysis
    selectedEntryId.value = added.entry.id
    ocrEditing.value = false
    message.value = `${added.entry.id} をOCR結果としてCSV対象へ追加しました。`
  }
  catch (error) {
    message.value = pdfProcessingErrorMessage(
      error,
      '選択範囲をOCRできませんでした。',
    )
  }
  finally {
    ocrRunning.value = false
    ocrStatus.value = ''
  }
}

/** PDFの保護領域指定モードを切り替える。 */
function toggleProtectionEditing() {
  protectionEditing.value = !protectionEditing.value
  if (protectionEditing.value)
    ocrEditing.value = false
}

/** PDFのOCR範囲指定モードを切り替える。 */
function toggleOcrEditing() {
  ocrEditing.value = !ocrEditing.value
  if (ocrEditing.value)
    protectionEditing.value = false
}

/** PDFページから指定した保護領域を削除する。 */
function removeProtectedArea(pageNumber: number, index: number) {
  const next = new Map(protectedAreas.value)
  const areas = [...(next.get(pageNumber) ?? [])]
  areas.splice(index, 1)
  if (areas.length > 0)
    next.set(pageNumber, areas)
  else
    next.delete(pageNumber)
  protectedAreas.value = next
}

/** 選択したPDF項目を翻訳対象に含めるか切り替える。 */
function toggleSelectedEntryExclusion() {
  const id = selectedEntryId.value
  if (!id)
    return
  const next = new Set(excludedEntryIds.value)
  if (next.has(id))
    next.delete(id)
  else next.add(id)
  excludedEntryIds.value = next
}

/** 原文の下書きを選択中のPDF項目へ確定する。 */
function applySelectedEntryOriginal() {
  const current = analysis.value
  const entry = selectedEntry.value
  if (!current || !entry)
    return
  try {
    analysis.value = updatePdfEntryOriginal(
      current,
      entry.id,
      originalDraft.value,
    )
    const nextTranslations = new Map(translations.value)
    nextTranslations.delete(entry.id)
    translations.value = nextTranslations
    message.value = `${entry.id} の抽出原文を更新しました。`
  }
  catch (error) {
    message.value = error instanceof Error
      ? error.message
      : '抽出原文を更新できませんでした。'
  }
}

/** 選択したPDF文字項目の順序を前後へ移す。 */
function moveSelectedEntry(direction: -1 | 1) {
  const current = analysis.value
  const id = selectedEntryId.value
  if (!current || !id)
    return
  analysis.value = movePdfEntry(current, id, direction)
}

/** 選択項目と次のPDF文字項目を結合する。 */
function mergeSelectedEntry() {
  const current = analysis.value
  const entry = selectedEntry.value
  const nextEntry = previewEntries.value[selectedEntryOrder.value.index + 1]
  if (!current || !entry || !nextEntry)
    return
  const result = mergePdfEntryWithNext(current, entry.id)
  if (!result)
    return

  analysis.value = result.analysis
  const nextTranslations = new Map(translations.value)
  nextTranslations.delete(entry.id)
  for (const id of result.removedEntryIds)
    nextTranslations.delete(id)
  translations.value = nextTranslations

  const nextExcludedIds = new Set(excludedEntryIds.value)
  const shouldRemainExcluded = nextExcludedIds.has(entry.id)
    || result.removedEntryIds.some(id => nextExcludedIds.has(id))
  for (const id of result.removedEntryIds)
    nextExcludedIds.delete(id)
  if (shouldRemainExcluded)
    nextExcludedIds.add(result.retainedEntryId)
  excludedEntryIds.value = nextExcludedIds
  selectedEntryId.value = result.retainedEntryId
  message.value = `${entry.id} と ${nextEntry.id} を結合しました。翻訳は未翻訳に戻しました。`
}

/** 原文の改行を使ってPDF文字項目を分割する。 */
function splitSelectedEntry() {
  const current = analysis.value
  const entry = selectedEntry.value
  if (!current || !entry)
    return
  const result = splitPdfEntryAtLines(current, entry.id, originalDraft.value)
  if (!result) {
    message.value = '分割するには、抽出原文を2行以上にしてください。'
    return
  }

  analysis.value = result.analysis
  const nextTranslations = new Map(translations.value)
  nextTranslations.delete(entry.id)
  for (const id of result.createdEntryIds)
    nextTranslations.delete(id)
  translations.value = nextTranslations

  if (excludedEntryIds.value.has(entry.id)) {
    const nextExcludedIds = new Set(excludedEntryIds.value)
    for (const id of result.createdEntryIds)
      nextExcludedIds.add(id)
    excludedEntryIds.value = nextExcludedIds
  }
  selectedEntryId.value = result.retainedEntryId
  message.value = `${entry.id} を ${result.createdEntryIds.length + 1} 個の文字項目に分割しました。翻訳は未翻訳に戻しました。`
}

/** 実行中のPDF処理へ中止を要求する。 */
function cancelPdfProcessing() {
  processingController.value?.abort()
  message.value = 'PDF処理をキャンセルしています…'
}

/** 処理中断に相当する例外か判定する。 */
function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 解析を終えてから元ファイルと編集状態を切り替える。中断・失敗では既存の解析結果を残す。 */
async function importPdf(file: File) {
  if (processing.value)
    return
  if (!await confirmLeave())
    return
  processing.value = true
  processingLabel.value = 'PDFの文字情報を解析しています'
  pdfProgress.value = null
  const controller = new AbortController()
  processingController.value = controller
  try {
    const result = await analyzePdf(file, ({ current, total }) => {
      pdfProgress.value = { current, total }
      message.value = `PDFの文字情報を解析しています（${current}/${total}）`
    }, controller.signal, confirmLargePdfPageCount)
    if (disposed)
      return
    sourceFile.value = file
    analysis.value = result
    translations.value = new Map()
    excludedEntryIds.value = new Set()
    protectedAreas.value = new Map()
    previewPageNumber.value = 1
    selectedEntryId.value = null
    originalDraft.value = ''
    lastSavedSignature.value = projectSignature.value
    const textPages = result.pages.filter(page => page.kind === 'text').length
    const imagePages = result.pageCount - textPages
    message.value = result.kind === 'image'
      ? `${file.name} は画像PDFです。抽出可能な文字がありません。`
      : `${file.name} を解析しました。文字ページ${textPages}、画像ページ${imagePages}、CSV対象${result.entries.length}件です。`
    await loadPreview(1)
  }
  catch (error) {
    message.value = isAbortError(error)
      ? 'PDFの解析をキャンセルしました。'
      : pdfProcessingErrorMessage(error, 'PDFを解析できませんでした。')
  }
  finally {
    processing.value = false
    processingLabel.value = ''
    pdfProgress.value = null
    processingController.value = null
  }
}

/** 元PDFの指紋が一致した場合だけ編集内容を復元する。利用するフォントは再選択が必要。 */
async function restorePdfProject(
  file: File,
  project: PdfProjectDocument,
) {
  if (processing.value)
    return
  if (!await confirmLeave())
    return
  processing.value = true
  processingLabel.value = '元PDFを照合しています'
  pdfProgress.value = null
  try {
    if (!await confirmLargePdfPageCount(project.analysis.pageCount)) {
      message.value = `${project.analysis.pageCount}ページのPDF読み込みを中止しました。`
      return
    }
    assertFileSize(file, FILE_LIMITS.pdfBytes, 'PDF')
    const fingerprint = await fingerprintPdfFile(file)
    assertPdfProjectSource(project, fingerprint)
    if (disposed)
      return
    sourceFile.value = file
    analysis.value = project.analysis
    translations.value = new Map(project.translations)
    excludedEntryIds.value = new Set(project.excludedEntryIds)
    protectedAreas.value = new Map(project.protectedAreas)
    backgroundMode.value = project.backgroundMode
    textColorMode.value = project.textColorMode
    clearPdfFont()
    previewPageNumber.value = 1
    selectedEntryId.value = null
    originalDraft.value = ''
    lastSavedSignature.value = projectSignature.value
    pendingPdfProject.value = null
    message.value = `${project.analysis.fileName} のPDF作業を復元しました。検索可能な訳文にする場合はフォントを再選択してください。`
    await loadPreview(1)
  }
  catch (error) {
    message.value = pdfProcessingErrorMessage(
      error,
      'PDF作業を復元できませんでした。',
    )
  }
  finally {
    processing.value = false
    processingLabel.value = ''
  }
}

/** PDFの編集状態を作業JSONとして保存する。 */
function exportPdfProject() {
  if (!analysis.value)
    return
  const project = createPdfProjectDocument(
    analysis.value,
    translations.value,
    excludedEntryIds.value,
    protectedAreas.value,
    backgroundMode.value,
    textColorMode.value,
  )
  const baseName = analysis.value.fileName.replace(/\.pdf$/iu, '') || 'document'
  downloadText(
    serializePdfProject(project),
    `${baseName}.happy-locale-pdf.json`,
    'application/json;charset=utf-8',
  )
  lastSavedSignature.value = serializePdfProject(project)
  message.value = 'PDF作業プロジェクトを保存しました。'
}

/** PDF作業JSONを検証し、対応する元PDFの選択を待つ。 */
async function importPdfProject(file: File) {
  try {
    assertFileSize(file, FILE_LIMITS.textBytes, 'PDFプロジェクト')
    const project = parsePdfProject(await file.text())
    pendingPdfProject.value = project
    message.value = `続けて元PDF「${project.analysis.fileName}」を選択してください。`
    pdfInput.value?.click()
  }
  catch (error) {
    pendingPdfProject.value = null
    message.value = error instanceof Error
      ? error.message
      : 'PDFプロジェクトを読み込めませんでした。'
  }
}

/** 元PDFのファイル選択を開く。 */
function openPdf() {
  pendingPdfProject.value = null
  pdfInput.value?.click()
}

/** 選択した元PDFを新規解析または作業復元へ渡す。 */
function selectPdf(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  if (!file)
    return
  if (pendingPdfProject.value)
    void restorePdfProject(file, pendingPdfProject.value)
  else
    void importPdf(file)
}

/** 選択した作業JSONを復元処理へ渡す。 */
function selectPdfProject(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  if (file)
    void importPdfProject(file)
}

/** PDF訳文用フォントを読み込み、プレビューと埋め込みに使用する。 */
async function selectPdfFont(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  if (!file)
    return
  try {
    if (!/\.(?:ttf|otf)$/iu.test(file.name))
      throw new Error('PDF埋め込みにはTTFまたはOTFフォントを選択してください。')
    const loaded = await loadUserFont(file)
    if (pdfFontFace.value)
      document.fonts.delete(pdfFontFace.value)
    pdfFontBlob.value = loaded.blob
    pdfFontFace.value = loaded.face
    pdfFontFamily.value = loaded.reference.familyName
    pdfFontName.value = loaded.reference.fileName
    message.value = `${loaded.reference.displayName}をPDF埋め込みフォントに設定しました。`
  }
  catch (error) {
    message.value = error instanceof Error
      ? error.message
      : 'PDF用フォントを読み込めませんでした。'
  }
}

/** PDF訳文用フォントを解放して標準表示へ戻す。 */
function clearPdfFont() {
  if (pdfFontFace.value)
    document.fonts.delete(pdfFontFace.value)
  pdfFontBlob.value = null
  pdfFontFace.value = null
  pdfFontFamily.value = 'sans-serif'
  pdfFontName.value = ''
}

/** 現在の編集対象の原文・訳文をCSVとして書き出す。 */
function exportCsv() {
  if (!analysis.value || analysis.value.entries.length === 0)
    return
  const name = analysis.value.fileName.replace(/\.pdf$/iu, '') || 'document'
  downloadText(
    serializePdfTranslationCsv(
      analysis.value,
      translations.value,
      excludedEntryIds.value,
    ),
    `${name}-pdf-translations.csv`,
    'text/csv;charset=utf-8',
  )
  message.value = `${exportEntryCount.value}件のPDF文字をCSVへ書き出しました。`
}

/** 読み込み開始時の解析結果に照合し、部分CSVにない既存訳は残す。別PDFへ切り替わった結果は反映しない。 */
async function importCsv(file: File) {
  const current = analysis.value
  if (!current)
    return
  try {
    assertFileSize(file, FILE_LIMITS.textBytes, 'CSV')
    const csv = await file.text()
    if (disposed || analysis.value !== current)
      return
    assertCsvTextLimits(csv)
    const matched = matchPdfTranslations(
      current,
      parsePdfTranslationCsv(csv),
      translations.value,
    )
    translations.value = matched.translations
    const warnings = [
      matched.unmatched > 0 ? `未一致${matched.unmatched}件` : '',
      matched.duplicateRows > 0 ? `重複${matched.duplicateRows}件` : '',
      matched.originalMismatches > 0 ? `原文変更${matched.originalMismatches}件` : '',
      matched.fileMismatches > 0 ? `PDF名不一致${matched.fileMismatches}件` : '',
    ].filter(Boolean)
    message.value = `${matched.applied}件のPDF翻訳を読み込みました。${warnings.length > 0 ? ` ${warnings.join('、')}。` : ''}`
  }
  catch (error) {
    message.value = error instanceof Error
      ? error.message
      : 'PDF翻訳CSVを読み込めませんでした。'
  }
}

/** 選択したCSVをPDF訳文の取り込みへ渡す。 */
function selectCsv(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  if (file)
    void importCsv(file)
}

/** 除外項目・保護領域・フォント設定をまとめて渡し、進捗表示とキャンセルを管理する。 */
async function exportPdf() {
  if (!sourceFile.value || !analysis.value || processing.value)
    return
  if (translationCount.value === 0) {
    message.value = 'translation列を入力したPDF翻訳CSVを先に読み込んでください。'
    return
  }
  processing.value = true
  processingLabel.value = '翻訳PDFを書き出しています'
  pdfProgress.value = null
  const controller = new AbortController()
  processingController.value = controller
  try {
    const blob = await createTranslatedPdf(
      sourceFile.value,
      analysis.value,
      translations.value,
      ({ current, total }) => {
        pdfProgress.value = { current, total }
        message.value = `PDFの文字を差し替えています（${current}/${total}）`
      },
      {
        backgroundMode: backgroundMode.value,
        textColorMode: textColorMode.value,
        protectedAreas: protectedAreas.value,
        excludedEntryIds: excludedEntryIds.value,
        embeddedFontBytes: pdfFontBlob.value
          ? await pdfFontBlob.value.arrayBuffer()
          : undefined,
      },
      controller.signal,
    )
    const name = sourceFile.value.name.replace(/\.pdf$/iu, '') || 'document'
    downloadBlob(blob, `${name}-ja.pdf`)
    const exported = translationCount.value - protectedTranslationCount.value
    message.value = `${exported}件を差し替えたPDFを書き出しました。${protectedTranslationCount.value > 0 ? ` 保護領域内の${protectedTranslationCount.value}件は元のまま残しました。` : ''}`
  }
  catch (error) {
    message.value = isAbortError(error)
      ? '翻訳PDFの書き出しをキャンセルしました。'
      : pdfProcessingErrorMessage(error, 'PDFを書き出せませんでした。')
  }
  finally {
    processing.value = false
    processingLabel.value = ''
    pdfProgress.value = null
    processingController.value = null
  }
}
</script>

<template>
  <div class="pdf-editor">
    <header class="toolbar" aria-label="PDFファイル操作">
      <WorkspaceSwitcher />
      <button
        v-if="analysis"
        type="button"
        :class="{ primary: !analysis }"
        :disabled="processing || ocrRunning"
        @click="openPdf"
      >
        {{ processing || ocrRunning ? 'PDF処理中…' : '新しいPDFを開く' }}
      </button>
      <button
        v-if="analysis"
        type="button"
        :disabled="processing || ocrRunning"
        @click="projectInput?.click()"
      >
        保存した作業を開く
      </button>
    </header>
    <input
      ref="pdfInput"
      class="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      @change="selectPdf"
    >
    <input
      ref="projectInput"
      class="visually-hidden"
      type="file"
      accept=".json,application/json"
      @change="selectPdfProject"
    >

    <main class="pdf-editor-main">
      <section v-if="processing" class="pdf-processing-status" aria-live="polite">
        <span>
          {{ processingLabel }}<template v-if="pdfProgress">（{{ pdfProgress.current }}/{{ pdfProgress.total }}）</template>
        </span>
        <progress
          v-if="pdfProgress"
          :value="pdfProgress.current"
          :max="pdfProgress.total"
        />
        <progress v-else />
        <button type="button" @click="cancelPdfProcessing">
          キャンセル
        </button>
      </section>
      <section v-if="!analysis" class="pdf-empty-state">
        <h1>PDF翻訳</h1>
        <p>PDFから文字を抽出し、CSVで翻訳して元のページへ戻します。</p>
        <button
          class="primary"
          type="button"
          :disabled="processing || ocrRunning"
          @click="openPdf"
        >
          PDFを選択
        </button>
        <button
          type="button"
          :disabled="processing || ocrRunning"
          @click="projectInput?.click()"
        >
          保存した作業を開く
        </button>
      </section>

      <section v-else class="pdf-workflow-panel">
        <div class="pdf-workflow-header">
          <div>
            <h1>{{ analysis.fileName }}</h1>
            <p>{{ summary }}／抽出{{ analysis.entries.length }}件／CSV対象{{ exportEntryCount }}件</p>
          </div>
          <div class="pdf-workflow-actions">
            <button
              type="button"
              :disabled="processing || ocrRunning"
              @click="exportPdfProject"
            >
              作業を保存
            </button>
            <button
              type="button"
              :disabled="exportEntryCount === 0 || processing || ocrRunning"
              @click="exportCsv"
            >
              1. 文字CSVを保存
            </button>
            <button
              type="button"
              :disabled="analysis.entries.length === 0 || processing || ocrRunning"
              @click="csvInput?.click()"
            >
              2. 翻訳CSVを読み込む
            </button>
            <input
              ref="csvInput"
              class="visually-hidden"
              type="file"
              accept=".csv,text/csv"
              @change="selectCsv"
            >
            <button
              type="button"
              class="primary"
              :disabled="translationCount === 0 || processing || ocrRunning"
              @click="exportPdf"
            >
              3. 翻訳PDFを保存
            </button>
          </div>
        </div>

        <aside
          v-if="compatibilityWarnings.length"
          class="pdf-compatibility-warning"
          aria-label="PDF互換性の注意"
        >
          <strong>対話機能を含むPDFです</strong>
          <ul>
            <li v-for="warning in compatibilityWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </aside>

        <section class="pdf-output-options" aria-label="翻訳PDFの出力設定">
          <fieldset class="pdf-background-options">
            <legend>文字を消した部分の背景</legend>
            <div class="pdf-option-controls">
              <label>
                <input v-model="backgroundMode" type="radio" value="blend">
                周囲になじませる
              </label>
              <label>
                <input v-model="backgroundMode" type="radio" value="white">
                白で塗りつぶす
              </label>
            </div>
            <small title="ページ画像の周囲4辺を参照します。複雑な図柄では調整が必要になる場合があります。">
              背景補間は周囲4辺を参照します
            </small>
          </fieldset>

          <fieldset class="pdf-background-options pdf-format-options">
            <legend>訳文のPDF形式</legend>
            <div class="pdf-option-controls">
              <span v-if="pdfFontBlob" class="pdf-option-value" :title="pdfFontName">
                検索可能（{{ pdfFontName }}）
              </span>
              <span v-else class="pdf-option-value">画像文字</span>
              <button
                type="button"
                :disabled="processing || ocrRunning"
                @click="pdfFontInput?.click()"
              >
                TTF / OTFを選択
              </button>
              <button
                v-if="pdfFontBlob"
                type="button"
                :disabled="processing || ocrRunning"
                @click="clearPdfFont"
              >
                画像文字へ戻す
              </button>
            </div>
            <input
              ref="pdfFontInput"
              class="visually-hidden"
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              @change="selectPdfFont"
            >
            <small title="フォントを選ぶと日本語訳を検索・選択可能なPDFテキストとして埋め込みます。利用条件を確認できる日本語対応フォントを選んでください。">
              日本語フォント選択時は検索・選択可能
            </small>
          </fieldset>

          <fieldset class="pdf-background-options">
            <legend>訳文の文字色</legend>
            <div class="pdf-option-controls">
              <label>
                <input v-model="textColorMode" type="radio" value="original">
                元の文字色を推定
              </label>
              <label>
                <input v-model="textColorMode" type="radio" value="black">
                黒に固定
              </label>
            </div>
            <small title="元ページの文字と補間背景の色差から文字色を推定します。">
              元ページと背景の色差から推定します
            </small>
          </fieldset>
        </section>

        <section class="pdf-preview-workspace">
          <div class="pdf-preview-toolbar">
            <label>
              ページ
              <select
                :value="previewPageNumber"
                :disabled="previewLoading || ocrRunning"
                @change="selectPreviewPage"
              >
                <option
                  v-for="page in analysis.pages"
                  :key="page.pageNumber"
                  :value="page.pageNumber"
                >
                  {{ page.pageNumber }} / {{ analysis.pageCount }}
                  （{{ page.kind === 'text' ? `${page.textCount}件` : '画像' }}）
                </option>
              </select>
            </label>
            <button
              type="button"
              :class="{ primary: protectionEditing }"
              :disabled="ocrRunning"
              @click="toggleProtectionEditing"
            >
              {{ protectionEditing ? '保護領域の追加を終了' : '保護領域を追加' }}
            </button>
            <button
              type="button"
              :class="{ primary: ocrEditing }"
              :disabled="previewPage?.kind !== 'image' || ocrRunning"
              @click="toggleOcrEditing"
            >
              {{ ocrEditing ? 'OCR範囲の選択を終了' : '範囲を選んでOCR' }}
            </button>
            <span v-if="ocrRunning" class="pdf-ocr-progress" aria-live="polite">
              {{ ocrStatus }} {{ Math.round(ocrProgress * 100) }}%
            </span>
            <label>
              表示倍率
              <select v-model.number="previewZoom">
                <option :value="50">50%</option>
                <option :value="75">75%</option>
                <option :value="100">100%</option>
                <option :value="150">150%</option>
              </select>
            </label>
            <span class="pdf-preview-legend">
              <i class="translated" /> 翻訳あり
              <i class="selected" /> 選択中
              <i class="protected" /> 保護領域
              <i class="excluded" /> CSV対象外
            </span>
          </div>

          <div class="pdf-preview-layout">
            <div class="pdf-preview-scroll">
              <p v-if="previewLoading" class="muted">
                ページを描画しています…
              </p>
              <PdfPreviewCanvas
                v-else-if="previewImage && previewPage"
                :image="previewImage"
                :page="previewPage"
                :entries="previewEntries"
                :translations="translations"
                :protected-areas="pageProtectedAreas"
                :excluded-entry-ids="excludedEntryIds"
                :selected-entry-id="selectedEntryId"
                :background-mode="backgroundMode"
                :text-color-mode="textColorMode"
                :font-family="pdfFontFamily"
                :protection-editing="protectionEditing"
                :ocr-editing="ocrEditing"
                :zoom="previewZoom"
                @select="selectedEntryId = $event"
                @add-protected-area="addProtectedArea"
                @add-ocr-area="addOcrArea"
              />
            </div>

            <aside class="pdf-preview-inspector">
              <template v-if="selectedEntry">
                <h2>選択中の文字</h2>
                <code>{{ selectedEntry.id }}</code>
                <dl>
                  <dt>翻訳</dt>
                  <dd>{{ translations.get(selectedEntry.id) || '未翻訳' }}</dd>
                </dl>
                <label>
                  抽出原文
                  <textarea v-model="originalDraft" rows="4" />
                </label>
                <button
                  type="button"
                  :disabled="!originalDraft.trim() || originalDraft.trim() === selectedEntry.original"
                  @click="applySelectedEntryOriginal"
                >
                  原文を更新
                </button>
                <p class="muted">
                  原文を改行して分割できます。結合はCSV順で直後の項目が対象です。
                </p>
                <div class="pdf-entry-order-actions" aria-label="文字項目の結合と分割">
                  <button
                    type="button"
                    :disabled="selectedEntryOrder.index >= selectedEntryOrder.total - 1"
                    @click="mergeSelectedEntry"
                  >
                    次の項目と結合
                  </button>
                  <button
                    type="button"
                    :disabled="!canSplitSelectedEntry"
                    @click="splitSelectedEntry"
                  >
                    改行で分割
                  </button>
                </div>
                <div class="pdf-entry-order-actions" aria-label="CSVの読み順">
                  <button
                    type="button"
                    :disabled="selectedEntryOrder.index <= 0"
                    @click="moveSelectedEntry(-1)"
                  >
                    前へ
                  </button>
                  <button
                    type="button"
                    :disabled="selectedEntryOrder.index >= selectedEntryOrder.total - 1"
                    @click="moveSelectedEntry(1)"
                  >
                    次へ
                  </button>
                </div>
                <button
                  type="button"
                  :aria-pressed="excludedEntryIds.has(selectedEntry.id)"
                  @click="toggleSelectedEntryExclusion"
                >
                  {{ excludedEntryIds.has(selectedEntry.id) ? 'CSV対象へ戻す' : 'CSV対象から除外' }}
                </button>
              </template>
              <p v-else class="muted">
                ページ上の文字枠を選択してください。保護領域は上部のボタンから追加できます。
              </p>
              <h3>このページの保護領域（{{ pageProtectedAreas.length }}）</h3>
              <p class="muted">
                「保護領域を追加」を有効にしてページ上をドラッグします。赤い領域に重なる文字枠は、背景補修も翻訳も行いません。
              </p>
              <ol v-if="pageProtectedAreas.length" class="pdf-protected-list">
                <li
                  v-for="(area, index) in pageProtectedAreas"
                  :key="`${previewPageNumber}-${index}`"
                >
                  <span>
                    {{ Math.round(area.width) }}×{{ Math.round(area.height) }}
                  </span>
                  <button
                    type="button"
                    @click="removeProtectedArea(previewPageNumber, index)"
                  >
                    削除
                  </button>
                </li>
              </ol>
            </aside>
          </div>
        </section>

        <p v-if="analysis.kind === 'image'" class="pdf-workflow-warning">
          このPDFには抽出可能な文字がありません。画像ページには一括OCRを実行していません。
        </p>
        <p v-else class="muted">
          CSVの <code>translation</code> 列を編集して戻してください。現在、翻訳{{ translationCount }}件を読み込み済みです。<template v-if="protectedTranslationCount">
            うち{{ protectedTranslationCount }}件は保護対象です。
          </template>
        </p>

        <div v-if="analysis.entries.length" class="pdf-text-preview">
          <table>
            <thead>
              <tr>
                <th>ページ</th>
                <th>text_id</th>
                <th>抽出した原文</th>
                <th>翻訳</th>
                <th>CSV対象</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in analysis.entries" :key="entry.id">
                <td>{{ entry.pageNumber }}</td>
                <td><code>{{ entry.id }}</code></td>
                <td>{{ entry.original }}</td>
                <td>{{ translations.get(entry.id) || '—' }}</td>
                <td>{{ excludedEntryIds.has(entry.id) ? '除外' : '対象' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-if="message" class="notice" role="status">
        {{ message }}
      </p>
    </main>
    <div
      v-if="largePdfWarning"
      class="confirmation-backdrop"
      @click.self="resolveLargePdfWarning(false)"
    >
      <section
        class="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="large-pdf-warning-title"
        aria-describedby="large-pdf-warning-description"
        @keydown.esc="resolveLargePdfWarning(false)"
      >
        <h2 id="large-pdf-warning-title">
          ページ数の多いPDFです
        </h2>
        <p id="large-pdf-warning-description">
          このPDFは{{ largePdfWarning.pageCount }}ページあります。画像量や文字数によっては処理に時間がかかり、メモリ不足になる場合があります。読み込みを続けますか？
        </p>
        <div class="confirmation-actions">
          <button type="button" autofocus @click="resolveLargePdfWarning(false)">
            中止
          </button>
          <button type="button" class="primary" @click="resolveLargePdfWarning(true)">
            読み込みを続ける
          </button>
        </div>
      </section>
    </div>
    <DataPrivacyFooter />
  </div>
  <UnsavedChangesDialog :open="leaveConfirmationOpen" @resolve="resolveLeave" />
</template>
