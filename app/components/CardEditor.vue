<script setup lang="ts">
import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import type {
  OCRProvider,
} from '~/services/ocr/types'
import type {
  ExclusionArea,
  FolderProjectCard,
  FolderProjectDocument,
  GlossaryEntry,
  LayoutTemplate,
  MaskStroke,
  RegionDraft,
  SourceIcon,
  TextRegion,
} from '~/types/editor'
import type { SplitAxis, SplitText } from '~/utils/split-region'
import type { ReusableTranslation } from '~/utils/translation-reuse'
import { storeToRefs } from 'pinia'
import { useBatchOCR } from '~/composables/useBatchOCR'
import { useCardThumbnails } from '~/composables/useCardThumbnails'
import { useEditorAssets } from '~/composables/useEditorAssets'
import { useEditorFonts } from '~/composables/useEditorFonts'
import { useEditorOCR } from '~/composables/useEditorOCR'
import { useEditorTranslation } from '~/composables/useEditorTranslation'
import { usePreviewDeferral } from '~/composables/usePreviewDeferral'
import { useProjectPersistence } from '~/composables/useProjectPersistence'
import { useRegionCandidates } from '~/composables/useRegionCandidates'
import { useTranslationReview } from '~/composables/useTranslationReview'
import { cloneRegionCandidates } from '~/services/ocr/candidates'
import { TesseractOCRProvider } from '~/services/ocr/tesseract'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import {
  activateProjectCard,
  moveProjectCard,
  renameProjectCard,
} from '~/services/project/cards'
import {
  addFolderProjectCards,
  folderProjectExists,
  listImageFiles,
  loadFolderProjectCardImage,
  openFolderProject,
  pickImageDirectory,
  pickProjectDirectory,
  supportsFolderProjects,
} from '~/services/project/folder'
import { loadProjectAssetImages } from '~/services/project/resources'
import { createSampleProjectCopy, resolveSampleCandidates } from '~/services/project/sample'
import { useProjectStore } from '~/stores/project'
import {
  createCardThumbnailBlob,
} from '~/utils/card-thumbnail'
import { downloadBlob } from '~/utils/download'
import {
  assertFileSize,
  assertImageDimensions,
  FILE_LIMITS,
} from '~/utils/file-limits'
import { glossaryKey } from '~/utils/glossary'
import { readImageDpi } from '~/utils/image-dpi'
import { historyShortcut } from '~/utils/keyboard'
import { fitsImage } from '~/utils/layout-template'
import { savedProjectSignature } from '~/utils/project-save'
import { transformRegionContents } from '~/utils/regions'
import { sourceIconProblems } from '~/utils/source-icons'
import { findReusableTranslations } from '~/utils/translation-reuse'
import { statusForTranslation } from '~/utils/translation-status'
import RegionCandidatePanel from './RegionCandidatePanel.vue'

const props = defineProps<{
  openSampleOnMount?: boolean
}>()

interface CanvasApi {
  exportPng: () => Promise<Blob | null>
  exportJpeg: () => Promise<Blob | null>
  backgroundColorForBounds: (bounds: RegionDraft) => string
}
interface DiagnosticEntry {
  time: string
  message: string
  details?: string
  level: 'info' | 'error'
}
type InspectorDetailTab = 'region' | 'ocr' | 'text'
type InspectorTab = 'list' | 'print' | InspectorDetailTab

/** 右側の設定タブの表示順とラベル。 */
const inspectorTabs: Array<{ id: InspectorTab, label: string }> = [
  { id: 'list', label: '領域一覧' },
  { id: 'region', label: '領域' },
  { id: 'ocr', label: 'OCR' },
  { id: 'text', label: '翻訳' },
  { id: 'print', label: '印刷\n範囲' },
]
/** JSONに保存できるカード・共有設定を管理するストア。 */
const projectStore = useProjectStore()
/** カード単位の編集履歴を管理し、確定した変更をストアへ通知する。 */
const editor = useCardEditor((cardId, project) => {
  projectStore.updateCard(cardId, project)
})
/** 保存ストアの各項目を、リアクティブな参照を保ったまま編集画面へ公開する。 */
const {
  document: folderDocument,
  activeCard: storedCard,
  assets,
  fonts,
  ocrDictionary,
  glossary,
} = storeToRefs(projectStore)
/** 開いているプロジェクトが配布サンプルか。翻訳設定とは独立して判定する。 */
const isDemo = computed(() => folderDocument.value?.demoPreset === 'sample-v1')
/** 画像・フォント・フォルダ等の非シリアライズ資源を管理する実行時状態。 */
const projectRuntime = useProjectRuntime()
/** 描画資源と保存待ち画像の参照。差し替え・解放はruntimeを通して行う。 */
const {
  cardImage: image,
  assetSourceImage,
  directory: projectDirectory,
  cardThumbnails,
  assetImages,
  pendingAssetWrites,
  loadedFonts,
} = projectRuntime
/** アセット切り出し元の画像を識別するID。 */
const assetSourceImageId = ref<string>(crypto.randomUUID())
/** 最後に保存が成功した内容の比較用文字列。 */
const lastSavedProjectSignature = ref<string | null>(null)
/** 現在編集中のカード画像を識別するID。 */
const currentImageId = ref<string>(crypto.randomUUID())
/** 切り替え先として読み込み中のカードID。処理終了後はnull。 */
const loadingCardId = ref<string | null>(null)
/** カード画像の追加処理中か。 */
const addingCards = ref(false)
/** プロジェクトの保存処理中か。 */
const savingProject = ref(false)
/** プロジェクトフォルダの読み込み処理中か。 */
const openingProject = ref(false)
/** 保存・読込・カード追加・切り替えのいずれかが実行中か。 */
const projectBusy = computed(() => savingProject.value || openingProject.value || addingCards.value || Boolean(loadingCardId.value))
/** 複数カードの画像書き出し処理中か。 */
const exportingCards = ref(false)
let exportDisposed = false
/** サムネイルの要求・再生成・保存。URLの所有はruntimeに残す。 */
const {
  setCardThumbnail,
  resetCardThumbnails,
  removeCardThumbnail,
  cacheCardThumbnail,
  persistCardThumbnail,
  requestCardThumbnail,
} = useCardThumbnails({
  directory: projectDirectory,
  document: folderDocument,
  runtime: projectRuntime,
  logDiagnostic,
})
/** 次回保存時に削除するカードID。保存前なら取り消せる。 */
const pendingCardDeletionIds = shallowRef(new Set<string>())
/** 削除確認を待っているカード。 */
const cardPendingDeletionConfirmation = shallowRef<FolderProjectCard | null>(
  null,
)
/** 削除確認を待っている翻訳領域。 */
const regionPendingDeletionConfirmation = shallowRef<TextRegion | null>(null)
/** カード上でアセットの切り出し範囲を指定しているか。 */
const assetEditing = ref(false)
/** カード・アセット・印刷のうち現在表示する作業画面。 */
const currentView = ref<'card' | 'assets' | 'print'>('card')
/** 配置雛形ダイアログの保存・適用モード。nullなら閉じている。 */
const layoutTemplateMode = ref<'capture' | 'apply' | null>(null)
/** 分割確認を開いた時点のカードと領域の情報。 */
const regionSplitRequest = shallowRef<{ cardId: string, region: TextRegion } | null>(null)
/** 原文アイコン指定を開いた時点のカードと領域の情報。 */
const sourceIconsRequest = shallowRef<{ cardId: string, region: TextRegion } | null>(null)
/** 子Canvasの画像書き出し等を呼び出す公開API。 */
const canvasApi = ref<CanvasApi | null>(null)
/** 操作結果や失敗理由を画面へ通知するメッセージ。 */
const message = ref('')
/** 自動検出した消去マスクを重ねて表示するか。 */
const autoMaskPreview = ref(false)
/** 右側インスペクターで現在選択しているタブ。 */
const inspectorTab = ref<InspectorTab>('list')
/** 入力中の描画遅延と、編集対象を変更した際の待機解除。 */
const { previewDeferred, deferPreview, flushPreview } = usePreviewDeferral([
  editor.selectedRegionId,
  currentView,
  inspectorTab,
  image,
])
/** 一覧へ移る前などに開いていた領域の詳細タブ。 */
const lastInspectorDetailTab = ref<InspectorDetailTab>('text')
/** 詳細画面に戻る際に表示するタブ。 */
const activeInspectorDetailTab = computed<InspectorDetailTab>(() =>
  inspectorTab.value === 'region'
  || inspectorTab.value === 'ocr'
  || inspectorTab.value === 'text'
    ? inspectorTab.value
    : lastInspectorDetailTab.value,
)
/** 原文消去用の手動マスクを描いているか。 */
const maskEditing = ref(false)
/** 手動マスクのブラシ直径。元画像の画素単位。 */
const maskBrushSize = ref(28)
/** 手動マスクを追加するか消すかの操作モード。 */
const maskBrushMode = ref<'paint' | 'erase'>('paint')
/** 背景補修から保護する領域を編集しているか。 */
const exclusionEditing = ref(false)
/** 現在選択している保護領域のID。 */
const selectedExclusionId = ref<string | null>(null)
/** カード編集画面の表示倍率。100が等倍。 */
const cardZoom = ref(50)
/** 編集結果と元画像のどちらを表示するか。 */
const cardPreviewMode = ref<'edited' | 'original'>('edited')
/** アセット編集画面の表示倍率。100が等倍。 */
const assetZoom = ref(100)
/** ブラウザがフォルダへの読み書きに対応しているか。 */
const folderProjectsSupported = ref(false)
/** 操作経過とエラーを記録した診断ログ。 */
const diagnostics = ref<DiagnosticEntry[]>([])
/** 診断ログの表示欄を開いているか。 */
const diagnosticsOpen = ref(false)
/** ブラウザ内で英語OCRを実行するWorkerの管理窓口。 */
const ocrProvider: OCRProvider = new TesseractOCRProvider(
  useRuntimeConfig().app.baseURL,
)
/** OCR処理を実行しているか。 */
const ocrRunning = ref(false)
/** OCRエンジンから通知された進捗値。 */
const ocrProgress = ref<number | null>(null)
/** OCRエンジンが現在実行している処理の説明。 */
const ocrStatus = ref('')
/** 単一領域の認識と補正。実行状態とWorkerは全体・一括OCRと共有する。 */
const {
  ocrLayout,
  ocrCandidate,
  ocrConfidence,
  ocrCorrectionCandidate,
  ocrCorrectionChanges,
  clearOCRCandidate,
  updateOCRCandidate,
  applyOCRCorrection,
  discardOCRCorrection,
  addOCRDictionaryEntry,
  removeOCRDictionaryEntry,
  finishOCRCandidate,
  recognizeSelectedRegion,
  applyOCRCandidate,
} = useEditorOCR({
  editor,
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  image,
  currentImageId,
  assets,
  ocrDictionary,
  setOCRDictionary: projectStore.setOCRDictionary,
  cardPreviewMode,
  setMessage,
  logDiagnostic,
})
/** フォントの読込・復元・使用箇所を考慮した削除。 */
const {
  cachedFontIds,
  pendingFontCacheDeletionIds,
  fontPendingDeletionConfirmation,
  loadedFontIds,
  fontFamilies,
  restoreCachedFonts,
  loadFont,
  loadSystemFont,
  requestFontDeletion,
  cancelFontDeletion,
  confirmFontDeletion,
  finalizeFontCacheDeletions,
  renameFont,
} = useEditorFonts({
  editor,
  projectStore,
  projectRuntime,
  projectDirectory,
  folderDocument,
  fonts,
  loadedFonts,
  setMessage,
  logDiagnostic,
})
/** 保存開始時のスナップショットと保存成功後の状態反映。 */
const { saveProject } = useProjectPersistence({
  editor,
  projectStore,
  projectRuntime,
  isDemo,
  projectBusy,
  ocrRunning,
  savingProject,
  currentImageId,
  pendingCardDeletionIds,
  lastSavedProjectSignature,
  removeCardThumbnail,
  persistCardThumbnail,
  finalizeFontCacheDeletions,
  setMessage,
  logDiagnostic,
})
/** 共有アセットの作成・再切り出し・配置設定・画像の登録。 */
const {
  assetCreationDraft,
  assetCreationRunning,
  assetRecropId,
  toggleAssetEditing,
  startAssetRecrop,
  addAsset,
  updateAssetCreationDraft,
  cancelAssetCreation,
  confirmAssetCreation,
  renameAsset,
  removeAsset,
  updateAsset,
} = useEditorAssets({
  editor,
  projectStore,
  projectRuntime,
  assets,
  folderDocument,
  assetSourceImage,
  assetSourceImageId,
  assetEditing,
  maskEditing,
  exclusionEditing,
  setMessage,
  logDiagnostic,
})
/** 現在の画像の候補検出・選択・編集履歴。 */
const {
  regionCandidates,
  selectedCandidateId,
  regionCandidateEditHistory,
  clearRegionCandidates,
  selectRegionCandidate,
  toggleRegionCandidate,
  selectAllRegionCandidates,
  splitCandidate,
  updateCandidateBounds,
  undoCandidateChange,
  detectRegionCandidates,
} = useRegionCandidates({
  editor,
  image,
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  isDemo,
  cardPreviewMode,
  clearOCRCandidate,
  persistDisplayedBatchCandidates,
  setMessage,
  logDiagnostic,
})
/** 現在の翻訳設定と、ブラウザへの保存を伴う更新操作。 */
const { settings: translationSettings, updateSettings: updateTranslationSettings }
  = useTranslationSettings()
/** 配信設定で外部の翻訳接続機能が有効になっているか。 */
const translationEndpointEnabled
  = String(useRuntimeConfig().public.translationEndpointEnabled) === 'true'
/** 翻訳方式と接続先の設定ダイアログを開いているか。 */
const translationSettingsOpen = ref(false)
/** 用語集の編集ダイアログを開いているか。 */
const glossaryOpen = ref(false)
/** 翻訳要求と候補の状態。確定した変更だけを編集履歴に反映する。 */
const {
  translationRunning,
  translationRequest,
  translationPreview,
  sampleTranslate,
  translateSelectedRegion,
  sendTranslationRequest,
  applyTranslationPreview,
  discardTranslationPreview,
} = useEditorTranslation({
  editor,
  currentImageId,
  isDemo,
  translationEndpointEnabled,
  translationSettings,
  setMessage,
  logDiagnostic,
})
// OCR開始時は結果を確認するOCRタブへ移動する。
watch(ocrRunning, (running) => {
  if (running)
    switchInspectorTab('ocr')
})

// マスク編集開始時は領域設定のタブへ移動する。
watch(maskEditing, (editing) => {
  if (editing)
    switchInspectorTab('region')
})

// 領域選択がなくなったら、領域が必要な詳細タブから一覧へ戻す。
watch(
  () => editor.selectedRegionId.value,
  (id) => {
    if (!id && (inspectorTab.value === 'region' || inspectorTab.value === 'text'))
      inspectorTab.value = 'list'
  },
)

/** 選択領域や画像の有無からタブを開けるか判定する。 */
function canOpenInspectorTab(tab: InspectorTab) {
  if (tab === 'list')
    return true
  if (tab === 'ocr')
    return Boolean(image.value)
  if (tab === 'print')
    return Boolean(image.value && folderDocument.value)
  return Boolean(editor.selectedRegion.value)
}

/** 開けるタブへ切り替え、領域の詳細タブなら次回表示用に記憶する。 */
function switchInspectorTab(tab: InspectorTab) {
  if (!canOpenInspectorTab(tab))
    return
  inspectorTab.value = tab
  if (tab === 'region' || tab === 'ocr' || tab === 'text')
    lastInspectorDetailTab.value = tab
}

/** 矢印キー等によるタブ移動とフォーカス変更を処理する。 */
function moveInspectorTab(event: KeyboardEvent, currentIndex: number) {
  const enabledTabs = inspectorTabs.filter(tab => canOpenInspectorTab(tab.id))
  const current = enabledTabs.findIndex(
    tab => tab.id === inspectorTabs[currentIndex]?.id,
  )
  let nextIndex: number | null = null
  if (event.key === 'ArrowRight')
    nextIndex = (current + 1) % enabledTabs.length
  else if (event.key === 'ArrowLeft')
    nextIndex = (current - 1 + enabledTabs.length) % enabledTabs.length
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = enabledTabs.length - 1
  if (nextIndex === null)
    return
  event.preventDefault()
  const nextTab = enabledTabs[nextIndex]
  if (!nextTab)
    return
  switchInspectorTab(nextTab.id)
  const tablist = (event.currentTarget as HTMLElement).parentElement
  nextTick(() => tablist
    ?.querySelector<HTMLButtonElement>(`#inspector-tab-${nextTab.id}`)
    ?.focus())
}

/** 領域を選択し、編集に使うインスペクターを表示する。 */
function selectRegionForEditing(id: string | null) {
  editor.selectedRegionId.value = id
  if (id)
    switchInspectorTab(lastInspectorDetailTab.value)
}

/** 下書きまたは保存済み文書から構成したカード一覧。 */
const projectCards = computed(() => {
  const documentValue = folderDocument.value
  if (!documentValue) {
    if (!image.value || !projectDirectory.value)
      return []
    return [
      {
        id: currentImageId.value,
        imagePath: '',
        printArea: null,
        sourceDpi: null,
        ...storedCard.value,
      },
    ]
  }
  return documentValue.cards
})
/** 一括OCRの順次実行・カード別結果・確認待ち状態。 */
const {
  batchOCRRunning,
  batchOCRCompleted,
  batchOCRTotal,
  batchOCRStates,
  batchOCRResults,
  batchOCREligibleCards,
  resetBatchOCR,
  updateBatchOCRState,
  updateBatchOCRResult,
  finishBatchOCRReview,
  requestBatchOCRCancellation,
  startBatchOCR,
} = useBatchOCR({
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  projectCards,
  folderDocument,
  projectDirectory,
  currentImageId,
  pendingCardDeletionIds,
  isDemo,
  selectProjectCard,
  showBatchOCRCandidates,
  clearRegionCandidates,
  setMessage,
  logDiagnostic,
})
/** レビュー下書き、CSV照合・出力、確定した訳文の反映。 */
const {
  translationReview,
  translationReviewError,
  translationReviewApplied,
  batchTranslationRegions,
  translationReviewCards,
  openTranslationReview,
  translateUntranslatedRegions,
  loadReviewImage,
  locateReviewRegion,
  applyTranslationReview,
  importCsv,
  exportCsv,
  exportCardCsv,
} = useTranslationReview({
  editor,
  projectStore,
  folderDocument,
  projectCards,
  currentImageId,
  pendingCardDeletionIds,
  projectDirectory,
  image,
  selectProjectRegion,
  setMessage,
  logDiagnostic,
})
/** 選択領域と同じ原文を持つ用語集・他領域の既存訳。 */
const reusableTranslations = computed(() => {
  const region = editor.selectedRegion.value
  return region ? findReusableTranslations(region, currentImageId.value, projectCards.value.map(card => card.id === currentImageId.value ? { ...card, regions: editor.project.value.regions } : card), glossary.value) : []
})
/** 既存訳の再利用を確認する対象領域と候補一覧。 */
const reuseRequest = shallowRef<{ cardId: string, region: TextRegion, candidates: ReusableTranslation[] } | null>(null)
/** 選択領域に使える既存訳を再利用の確認画面へ渡す。 */
function requestTranslationReuse() {
  const region = editor.selectedRegion.value
  if (!region || !reusableTranslations.value.length)
    return
  reuseRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)), candidates: reusableTranslations.value }
}
/** 確認した既存訳を対象領域へ反映する。 */
function applyReusedTranslation(translation: string) {
  const request = reuseRequest.value
  if (!request)
    return
  const region = editor.project.value.regions.find(item => item.id === request.region.id)
  reuseRequest.value = null
  if (request.cardId !== currentImageId.value || !region || JSON.stringify(region) !== JSON.stringify(request.region)) {
    setMessage('対象が変更されたため、既存訳を反映しませんでした。候補を開き直してください。')
    return
  }
  editor.updateRegion(region.id, { translatedText: translation, translationStatus: statusForTranslation(translation) })
  setMessage('既存訳を下書きとして反映しました。')
}
/** 保存済み文書または下書きで現在有効なカードID。 */
const activeCardId = computed(
  () => folderDocument.value?.activeCardId ?? currentImageId.value,
)
/** 現在のカードIDに対応する保存用メタデータ。 */
const activeProjectCard = computed(() => folderDocument.value?.cards.find(
  card => card.id === activeCardId.value,
) ?? null)
/** エラーや補足データを診断ログ用の文字列へ変換する。 */
function diagnosticDetails(value: unknown): string | undefined {
  if (value === undefined)
    return undefined
  if (value instanceof Error)
    return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

/** 操作名・詳細・重要度を診断ログへ追加する。 */
function logDiagnostic(
  message: string,
  details?: unknown,
  level: 'info' | 'error' = 'info',
) {
  const entry: DiagnosticEntry = {
    time: new Date().toLocaleTimeString('ja-JP'),
    message,
    details: diagnosticDetails(details),
    level,
  }
  diagnostics.value = [...diagnostics.value.slice(-49), entry]
  const logger = level === 'error' ? console.error : console.warn
  logger(`[HappyLocale] ${message}`, details ?? '')
}

/** ダイアログ表示中や入力欄の履歴操作を除外してから、カードのUndo／Redoへ渡す。 */
function handleEditorKeydown(event: KeyboardEvent) {
  if (projectBusy.value)
    return
  if (currentView.value !== 'card')
    return
  const modalOpen = Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
  const shortcut = historyShortcut(event, modalOpen)
  if (!shortcut)
    return
  event.preventDefault()
  if (shortcut === 'undo')
    editor.undo()
  else
    editor.redo()
}

// キーボード操作とブラウザ機能の確認を開始し、必要ならサンプルを開く。
onMounted(() => {
  window.addEventListener('keydown', handleEditorKeydown)
  folderProjectsSupported.value = supportsFolderProjects()
  logDiagnostic('アプリを初期化しました', {
    folderProjectsSupported: folderProjectsSupported.value,
    secureContext: window.isSecureContext,
  })
  if (props.openSampleOnMount)
    void openProject(true)
})

// 手動補修以外の背景方式に変わったらマスク描画を終了する。
watch(
  () => editor.selectedRegion.value?.backgroundMode,
  (mode) => {
    if (mode !== 'manual')
      maskEditing.value = false
  },
)

// 別の領域を選んだら保護領域の選択と編集モードを解除する。
watch(
  () => editor.selectedRegionId.value,
  () => {
    selectedExclusionId.value = null
    exclusionEditing.value = false
    clearOCRCandidate()
  },
)

// 保護領域が削除されたら無効になった選択IDを解除する。
watch(
  () => editor.selectedRegion.value?.exclusionAreas,
  (areas) => {
    if (
      selectedExclusionId.value
      && !areas?.some(area => area.id === selectedExclusionId.value)
    ) {
      selectedExclusionId.value = null
    }
  },
  { deep: true },
)

// 画面終了時にタイマー・イベント・画像・フォント・OCRのリソースを解放する。
onBeforeUnmount(() => {
  exportDisposed = true
  window.removeEventListener('keydown', handleEditorKeydown)
  projectRuntime.dispose()
  projectStore.clearProject()
  void ocrProvider.dispose?.().catch(error =>
    logDiagnostic('OCR Workerの終了に失敗しました', error, 'error'),
  )
})

/** 画面の操作結果メッセージを更新する。 */
function setMessage(value: string) {
  message.value = value
  window.setTimeout(() => {
    if (message.value === value)
      message.value = ''
  }, 4000)
}

/** 調整中の候補と選択状態をカード別に退避し、別カードの確認から戻れるようにする。 */
function persistDisplayedBatchCandidates() {
  if (batchOCRStates.value.get(currentImageId.value)?.status !== 'review')
    return
  updateBatchOCRResult(currentImageId.value, regionCandidates.value)
  updateBatchOCRState(currentImageId.value, {
    status: 'review',
    candidates: regionCandidates.value.length,
  })
}

/** 指定カードに退避した領域候補を確認画面へ戻す。 */
function showBatchOCRCandidates(cardId: string) {
  const candidates = batchOCRResults.value.get(cardId)
  if (!candidates)
    return false
  regionCandidates.value = cloneRegionCandidates(candidates)
  selectedCandidateId.value = null
  regionCandidateEditHistory.value = []
  editor.selectedRegionId.value = null
  cardPreviewMode.value = 'original'
  switchInspectorTab('ocr')
  return true
}

/** 領域候補を追加せず破棄し、一括OCRの確認状態を進める。 */
function discardRegionCandidates() {
  const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status
    === 'review'
    ? currentImageId.value
    : null
  logDiagnostic('領域候補を破棄しました', {
    candidates: regionCandidates.value.length,
    selected: regionCandidates.value.filter(candidate => candidate.selected)
      .length,
    history: regionCandidateEditHistory.value.length,
  })
  clearRegionCandidates()
  if (reviewedCardId)
    finishBatchOCRReview(reviewedCardId)
}

/** 選んだ候補だけを編集領域へ確定する。サンプルでは用意済みの原文と設定を対応付ける。 */
function confirmRegionCandidates() {
  const selected = regionCandidates.value.filter(candidate => candidate.selected)
  if (selected.length === 0) {
    setMessage('追加する領域候補を選択してください。')
    return
  }
  let sampleCandidates: TextRegion[] | null = null
  try {
    if (activeProjectCard.value)
      sampleCandidates = resolveSampleCandidates(activeProjectCard.value, selected)
  }
  catch (error) {
    setMessage(error instanceof Error ? error.message : 'デモ候補を表示し直してください。')
    return
  }
  if (sampleCandidates) {
    const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status === 'review' ? currentImageId.value : null
    editor.appendTemplateRegions(sampleCandidates)
    clearRegionCandidates()
    switchInspectorTab('text')
    setMessage('原文・アイコン・ルビ設定を追加しました。「未翻訳をまとめて取得」で日本語訳を一括確認できます。')
    if (reviewedCardId)
      finishBatchOCRReview(reviewedCardId)
    return
  }
  editor.addRegions(
    selected.map(candidate => ({
      bounds: {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
      },
      backgroundColor:
        canvasApi.value?.backgroundColorForBounds(candidate) ?? '#ffffff',
      originalText: candidate.text,
    })),
  )
  const count = selected.length
  const reviewedCardId = batchOCRStates.value.get(currentImageId.value)?.status
    === 'review'
    ? currentImageId.value
    : null
  logDiagnostic('領域候補を通常領域へ追加しました', {
    added: count,
    discarded: regionCandidates.value.length - count,
    history: regionCandidateEditHistory.value.length,
  })
  clearRegionCandidates()
  setMessage(`${count}件の領域を追加しました。`)
  if (reviewedCardId)
    finishBatchOCRReview(reviewedCardId)
}

/** 取り込み対象として扱える画像形式か確認する。 */
function isImageFile(file: File) {
  return (
    ['image/png', 'image/jpeg'].includes(file.type)
    || /\.(?:png|jpe?g)$/iu.test(file.name)
  )
}

/** 画像の形式・容量・寸法を確認し、表示用要素とURLを用意する。採用後の解放はruntimeが担う。 */
async function loadImage(file: File): Promise<RuntimeLoadedImage | null> {
  logDiagnostic('画像ファイルを受け取りました', {
    type: file.type || '(未設定)',
    size: file.size,
    extension: file.name.match(/\.[^.]+$/u)?.[0]?.toLowerCase() ?? '(なし)',
  })
  if (!isImageFile(file)) {
    logDiagnostic('画像形式を判定できませんでした', undefined, 'error')
    setMessage('PNGまたはJPEG画像を選択してください。')
    return null
  }
  try {
    assertFileSize(file, FILE_LIMITS.imageBytes, '画像')
  }
  catch (error) {
    logDiagnostic('画像ファイルの上限を超えています', error, 'error')
    setMessage(error instanceof Error ? error.message : '画像が大きすぎます。')
    return null
  }
  const url = URL.createObjectURL(file)
  logDiagnostic('画像用Object URLを作成しました')
  const loadedImage = new Image()
  loadedImage.decoding = 'async'
  try {
    await new Promise<void>((resolve, reject) => {
      loadedImage.onload = () => resolve()
      loadedImage.onerror = () =>
        reject(new Error('画像のloadイベントが失敗しました。'))
      loadedImage.src = url
    })
    assertImageDimensions(loadedImage.naturalWidth, loadedImage.naturalHeight)
    try {
      await loadedImage.decode()
      logDiagnostic('画像のデコードが完了しました')
    }
    catch (error) {
      // loadイベントが成功していれば画像は利用できるため、decode固有の失敗は継続する。
      logDiagnostic('decode()は失敗しましたがload済み画像を使用します', error)
    }
  }
  catch (error) {
    URL.revokeObjectURL(url)
    logDiagnostic('画像を読み込めませんでした', error, 'error')
    setMessage(
      error instanceof Error ? error.message : '画像を読み込めませんでした。',
    )
    return null
  }
  logDiagnostic('画像の読み込み準備が完了しました', {
    width: loadedImage.naturalWidth,
    height: loadedImage.naturalHeight,
  })
  return { element: loadedImage, file, url }
}

/** 読み込み済みカード画像を表示用runtimeへ採用する。 */
function applyLoadedImage(loaded: RuntimeLoadedImage) {
  clearRegionCandidates()
  projectRuntime.replaceCardImage(loaded)
  logDiagnostic('画像をエディターへ反映しました', {
    width: loaded.element.naturalWidth,
    height: loaded.element.naturalHeight,
  })
}

/** 画像のDPIを取得し、対応するカードの実寸情報へ反映する。 */
async function detectAndApplyCardDpi(cardId: string, file: File) {
  const card = folderDocument.value?.cards.find(item => item.id === cardId)
  if (!card || card.sourceDpi)
    return
  const dpi = await readImageDpi(file)
  if (!dpi)
    return
  updateCardPrintDpi(cardId, dpi)
  logDiagnostic('元画像のDPIメタデータを読み込みました', {
    cardId,
    x: dpi.x,
    y: dpi.y,
  })
}

/** 現在のカード画像と関連リソースを解放する。 */
function clearLoadedCardImage() {
  clearRegionCandidates()
  projectRuntime.clearCardImage()
}

/** 未保存判定に使用する現在の保存対象の比較値を作る。 */
function projectSignature() {
  if (!projectDirectory.value)
    return null
  const documentValue = folderDocument.value
  const cards = documentValue
    ? documentValue.cards
    : image.value
      ? [{ id: currentImageId.value, imagePath: '', printArea: null, sourceDpi: null, ...storedCard.value }]
      : []
  return savedProjectSignature({
    cards,
    assets: assets.value,
    fonts: fonts.value,
    ocrDictionary: ocrDictionary.value,
    glossary: glossary.value,
    layoutTemplates: documentValue?.layoutTemplates,
    printSettings: documentValue?.printSettings ?? { ...DEFAULT_PRINT_SETTINGS },
  }, pendingCardDeletionIds.value, pendingAssetWrites.value.keys(), pendingFontCacheDeletionIds.value)
}

/** 作成した配置雛形を共有設定へ追加する。 */
function saveLayoutTemplate(template: LayoutTemplate) {
  const document = folderDocument.value
  if (!document || projectBusy.value)
    return
  projectStore.replaceProject({
    ...document,
    layoutTemplates: [...(document.layoutTemplates ?? []), template],
  })
  layoutTemplateMode.value = null
  setMessage('配置雛形を登録しました。プロジェクト保存で保存できます。')
}

/** 選んだ雛形の領域を現在のカードへ追加する。 */
function applyLayoutTemplate(regions: TextRegion[]) {
  if (projectBusy.value || regions.some(region => !fitsImage(region, editor.project.value.imageWidth, editor.project.value.imageHeight)))
    return
  editor.appendTemplateRegions(regions)
  layoutTemplateMode.value = null
  inspectorTab.value = 'list'
  setMessage(`${regions.length}領域を追加しました。原文と訳文を設定してください。`)
}

/** 領域の現在値を控えて分割確認を開く。 */
function requestRegionSplit(id: string) {
  const region = editor.project.value.regions.find(item => item.id === id)
  if (!region || projectBusy.value)
    return
  regionSplitRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)) as TextRegion }
}

/** 確認した分割位置と本文を二つの編集領域へ反映する。 */
function applyRegionSplit(axis: SplitAxis, position: number, texts: [SplitText, SplitText]) {
  const request = regionSplitRequest.value
  if (!request)
    return
  const current = editor.project.value.regions.find(item => item.id === request.region.id)
  if (request.cardId !== currentImageId.value || JSON.stringify(current) !== JSON.stringify(request.region)) {
    regionSplitRequest.value = null
    setMessage('領域が変更されたため分割を中止しました。現在の内容でやり直してください。')
    return
  }
  editor.splitRegion(request.region.id, axis, position, texts)
  regionSplitRequest.value = null
  inspectorTab.value = 'list'
  setMessage('領域を分割しました。原文・訳文と保護領域を確認してください。')
}

/** 選択領域の原文アイコンを指定する画面を開く。 */
function requestSourceIcons() {
  const region = editor.selectedRegion.value
  if (!region || ocrRunning.value)
    return
  sourceIconsRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)) as TextRegion }
}

/** 確認した原文アイコンの範囲と参照を領域へ反映する。 */
function applySourceIcons(icons: SourceIcon[]) {
  const request = sourceIconsRequest.value
  if (!request)
    return
  const current = editor.project.value.regions.find(region => region.id === request.region.id)
  if (currentImageId.value !== request.cardId || JSON.stringify(current) !== JSON.stringify(request.region)) {
    sourceIconsRequest.value = null
    setMessage('対象の領域が変更されました。現在の内容でアイコンを指定し直してください。')
    return
  }
  if (sourceIconProblems({ ...request.region, sourceIcons: icons }, assets.value).length)
    return
  editor.updateRegion(request.region.id, { sourceIcons: icons })
  clearOCRCandidate()
  sourceIconsRequest.value = null
  inspectorTab.value = 'ocr'
  setMessage('アイコンの位置を記録しました。OCRを実行して原文候補を確認してください。')
}

/** 現在の保存対象データから計算した変更検出用文字列。 */
const currentProjectSignature = computed(projectSignature)
/** 現在の内容と保存成功時の内容を比較した保存状態。 */
const saveStatus = computed<'none' | 'saved' | 'unsaved'>(() => {
  if (!image.value || !currentProjectSignature.value)
    return 'none'
  return currentProjectSignature.value === lastSavedProjectSignature.value
    ? 'saved'
    : 'unsaved'
})

/** 未保存・処理中の状態に応じた離脱確認の表示と回答窓口。 */
const { leaveConfirmationOpen, confirmLeave, resolveLeave } = useUnsavedChanges(
  () => currentProjectSignature.value !== lastSavedProjectSignature.value,
  () => projectBusy.value,
)

/** 対象画像を読めてからカードと履歴を切り替え、そのカードの一括OCR候補も復元する。 */
async function selectProjectCard(cardId: string) {
  if (projectBusy.value)
    return
  const directory = projectDirectory.value
  const documentValue = folderDocument.value
  if (
    !directory
    || !documentValue
    || pendingCardDeletionIds.value.has(cardId)
    || loadingCardId.value
  ) {
    return
  }
  if (documentValue.activeCardId === cardId) {
    if (showBatchOCRCandidates(cardId))
      setMessage(`${storedCard.value.imageName} のOCR候補を確認してください。`)
    return
  }
  if (translationRunning.value) {
    setMessage('翻訳の完了後にカードを切り替えてください。')
    return
  }
  if (ocrRunning.value) {
    setMessage('OCRの完了後にカードを切り替えてください。')
    return
  }
  const target = documentValue.cards.find(card => card.id === cardId)
  if (!target)
    return

  loadingCardId.value = cardId
  logDiagnostic('カード画像の遅延読み込みを開始しました', {
    cardId,
    imagePath: target.imagePath,
  })
  try {
    const file = await loadFolderProjectCardImage(directory, target)
    const loaded = await loadImage(file)
    if (!loaded)
      return
    editor.switchSavedProject(cardId, {
      imageName: target.imageName,
      imageWidth: loaded.element.naturalWidth,
      imageHeight: loaded.element.naturalHeight,
      regions: target.regions,
    })
    projectStore.replaceProject(activateProjectCard(
      {
        ...folderDocument.value!,
        cards: folderDocument.value!.cards.map(card =>
          card.id === cardId
            ? {
                ...card,
                imageWidth: loaded.element.naturalWidth,
                imageHeight: loaded.element.naturalHeight,
              }
            : card,
        ),
      },
      cardId,
    ))
    currentImageId.value = cardId
    maskEditing.value = false
    exclusionEditing.value = false
    selectedExclusionId.value = null
    clearOCRCandidate()
    applyLoadedImage(loaded)
    await detectAndApplyCardDpi(cardId, file)
    const hasBatchCandidates = showBatchOCRCandidates(cardId)
    const thumbnail = await cacheCardThumbnail(cardId, loaded.element)
    if (thumbnail)
      void persistCardThumbnail(directory, cardId, thumbnail)
    currentView.value = 'card'
    logDiagnostic('編集対象カードを切り替えました', {
      cardId,
      regions: target.regions.length,
      loadedImages: 1,
    })
    setMessage(
      hasBatchCandidates
        ? `${target.imageName} のOCR候補を確認してください。`
        : `${target.imageName} を開きました。`,
    )
  }
  catch (error) {
    logDiagnostic('カード画像を読み込めませんでした', error, 'error')
    setMessage('カード画像を読み込めませんでした。')
  }
  finally {
    loadingCardId.value = null
  }
}

/** 対象カードへ切り替えて指定領域を選択する。 */
async function selectProjectRegion(cardId: string, regionId: string) {
  await selectProjectCard(cardId)
  if (currentImageId.value !== cardId)
    return
  const region = editor.project.value.regions.find(item => item.id === regionId)
  if (!region)
    return
  editor.selectedRegionId.value = region.id
  switchInspectorTab('text')
  currentView.value = 'card'
}

/** カード名と編集中の画像名を更新する。 */
function renameCard(cardId: string, imageName: string) {
  const name = imageName.trim()
  if (!name)
    return
  if (folderDocument.value) {
    projectStore.replaceProject(renameProjectCard(
      folderDocument.value,
      cardId,
      name,
    ))
  }
  if (currentImageId.value === cardId || folderDocument.value?.activeCardId === cardId)
    editor.renameImage(name)
  setMessage(`カード名を「${name}」へ変更しました。`)
}

/** カード一覧の順序を一つ前または後へ移す。 */
function moveCard(cardId: string, direction: -1 | 1) {
  if (!folderDocument.value || pendingCardDeletionIds.value.size > 0)
    return
  projectStore.replaceProject(moveProjectCard(
    folderDocument.value,
    cardId,
    direction,
  ))
}

/** 削除対象のカードを確認ダイアログへ渡す。 */
function requestProjectCardDeletion(cardId: string) {
  const documentValue = folderDocument.value
  if (
    !documentValue
    || loadingCardId.value
    || addingCards.value
    || ocrRunning.value
  ) {
    return
  }
  if (documentValue.cards.length <= 1) {
    setMessage('最後の1枚は削除できません。')
    return
  }
  const remainingCards = documentValue.cards.filter(
    item => !pendingCardDeletionIds.value.has(item.id),
  )
  if (remainingCards.length <= 1) {
    setMessage('最後の1枚は削除できません。')
    return
  }
  const card = projectCards.value.find(item => item.id === cardId)
  if (!card)
    return
  cardPendingDeletionConfirmation.value = card
}

/** カード削除の確認を閉じる。 */
function cancelProjectCardDeletion() {
  cardPendingDeletionConfirmation.value = null
}

/** 削除はまず予定として記録する。画像ファイルの削除はプロジェクト保存の成功後まで遅らせる。 */
async function confirmProjectCardDeletion() {
  const card = cardPendingDeletionConfirmation.value
  cardPendingDeletionConfirmation.value = null
  if (!card)
    return
  const cardId = card.id

  const documentValue = folderDocument.value
  if (!documentValue)
    return
  if (documentValue.activeCardId === cardId) {
    const index = documentValue.cards.findIndex(item => item.id === cardId)
    const isSelectable = (item: FolderProjectCard) =>
      item.id !== cardId && !pendingCardDeletionIds.value.has(item.id)
    const nextCard = documentValue.cards.slice(index + 1).find(isSelectable)
      ?? documentValue.cards.slice(0, index).reverse().find(isSelectable)
    if (!nextCard)
      return
    await selectProjectCard(nextCard.id)
    if (folderDocument.value?.activeCardId !== nextCard.id)
      return
  }

  pendingCardDeletionIds.value = new Set(pendingCardDeletionIds.value).add(
    cardId,
  )
  logDiagnostic('カードを削除予定にしました', {
    cardId,
    imageName: card.imageName,
    pending: pendingCardDeletionIds.value.size,
  })
  setMessage(`${card.imageName} を削除予定にしました。`)
}

/** 指定カードの削除予定を取り消す。 */
function cancelProjectCardDeletionRequest(cardId: string) {
  if (!pendingCardDeletionIds.value.has(cardId))
    return
  const card = folderDocument.value?.cards.find(item => item.id === cardId)
  const nextIds = new Set(pendingCardDeletionIds.value)
  nextIds.delete(cardId)
  pendingCardDeletionIds.value = nextIds
  logDiagnostic('カードの削除予定を取り消しました', {
    cardId,
    imageName: card?.imageName,
    pending: pendingCardDeletionIds.value.size,
  })
  setMessage(`${card?.imageName ?? 'カード'} の削除を取り消しました。`)
}

/** 追加画像とサムネイルを準備し、保存成功後にカード一覧と保存済みアセットのパスを更新する。 */
async function addProjectCards(files: File[]) {
  if (isDemo.value) {
    setMessage('デモではサンプルカードのみ編集できます。')
    return
  }
  if (projectBusy.value)
    return
  const directory = projectDirectory.value
  const documentValue = folderDocument.value
  if (
    !directory
    || !documentValue
    || addingCards.value
    || loadingCardId.value
    || files.length === 0
  ) {
    return
  }
  if (ocrRunning.value) {
    setMessage('OCRの完了後にカードを追加してください。')
    return
  }
  if (pendingCardDeletionIds.value.size > 0) {
    setMessage('カードを追加する前に、削除予定を保存または取り消してください。')
    return
  }

  addingCards.value = true
  const assetWrites = new Map(pendingAssetWrites.value)
  logDiagnostic('カード画像の一括追加を開始しました', {
    requested: files.length,
  })
  try {
    const additions = []
    const thumbnails = new Map<string, Blob>()
    for (const file of files) {
      const loaded = await loadImage(file)
      if (!loaded)
        continue
      const id = crypto.randomUUID()
      additions.push({
        id,
        file,
        imageWidth: loaded.element.naturalWidth,
        imageHeight: loaded.element.naturalHeight,
      })
      const thumbnail = await createCardThumbnailBlob(
        loaded.element,
        loaded.element.naturalWidth,
        loaded.element.naturalHeight,
      )
      if (thumbnail)
        thumbnails.set(id, thumbnail)
      URL.revokeObjectURL(loaded.url)
      loaded.element.removeAttribute('src')
    }
    if (additions.length === 0) {
      setMessage('追加できるPNG / JPEG画像がありませんでした。')
      return
    }
    const updatedDocument = await addFolderProjectCards(
      directory,
      documentValue,
      additions,
      assetWrites,
    )
    const previousIds = new Set(documentValue.cards.map(card => card.id))
    projectStore.replaceProject({
      ...folderDocument.value!,
      cards: [
        ...folderDocument.value!.cards,
        ...updatedDocument.cards.filter(card => !previousIds.has(card.id)),
      ],
    })
    projectStore.acceptSavedProject(updatedDocument, new Set())
    projectRuntime.acknowledgeAssetWrites(assetWrites)
    thumbnails.forEach((thumbnail, id) => {
      setCardThumbnail(id, thumbnail)
      void persistCardThumbnail(directory, id, thumbnail)
    })
    logDiagnostic('カード画像の一括追加が完了しました', {
      added: additions.length,
      cards: updatedDocument.cards.length,
    })
    setMessage(`${additions.length}枚のカードを追加しました。`)
  }
  catch (error) {
    logDiagnostic('カード画像を追加できませんでした', error, 'error')
    setMessage('カード画像を追加できませんでした。')
  }
  finally {
    addingCards.value = false
  }
}

/** フォルダ内の画像を列挙してカード追加へ渡す。 */
async function addProjectCardsFromFolder() {
  if (isDemo.value) {
    setMessage('デモではサンプルカードのみ編集できます。')
    return
  }
  try {
    const directory = await pickImageDirectory()
    const files = await listImageFiles(directory)
    if (files.length === 0) {
      setMessage('選択したフォルダ直下にPNG / JPEG画像がありません。')
      return
    }
    await addProjectCards(files)
  }
  catch (error) {
    if (isPickerCancellation(error))
      return
    logDiagnostic('フォルダからカード画像を追加できませんでした', error, 'error')
    setMessage(
      error instanceof Error
        ? error.message
        : 'フォルダからカード画像を追加できませんでした。',
    )
  }
}

/** アセット切り出し用の元画像をruntimeへ採用する。 */
function applyAssetSourceImage(loaded: RuntimeLoadedImage) {
  projectRuntime.replaceAssetSourceImage(loaded)
  assetSourceImageId.value = crypto.randomUUID()
  logDiagnostic('アセット切り出し元画像を反映しました', {
    width: loaded.element.naturalWidth,
    height: loaded.element.naturalHeight,
  })
}

/** アセット切り出し用の画像と一時URLを解放する。 */
function clearAssetSourceImage() {
  projectRuntime.clearAssetSourceImage()
  assetSourceImageId.value = crypto.randomUUID()
  assetEditing.value = false
  assetCreationDraft.value = null
  assetRecropId.value = null
}

/** project.jsonがない選択フォルダで、新しいカード編集を開始する。 */
function startNewFolderProject(directory: FileSystemDirectoryHandle) {
  resetBatchOCR()
  clearLoadedCardImage()
  editor.loadImageProject('', 0, 0)
  projectRuntime.setDirectory(directory)
  projectStore.clearProject()
  currentImageId.value = crypto.randomUUID()
  resetCardThumbnails()
  pendingCardDeletionIds.value = new Set()
  cardPendingDeletionConfirmation.value = null
  clearAssetSourceImage()
  projectRuntime.replaceAssetImages(new Map())
  projectRuntime.clearPendingAssetWrites()
  cachedFontIds.value = new Set()
  pendingFontCacheDeletionIds.value = new Set()
  fontPendingDeletionConfirmation.value = null
  projectRuntime.replaceLoadedFonts(new Map())
  currentView.value = 'card'
  nextTick(() => {
    lastSavedProjectSignature.value = projectSignature()
  })
}

/** 新規プロジェクトの最初のカード画像を読み込み、編集状態を初期化する。 */
async function openCardImage(file: File) {
  if (addingCards.value || loadingCardId.value) {
    setMessage('カードの処理が完了してから画像を開いてください。')
    return
  }
  if (!projectDirectory.value) {
    setMessage('先にプロジェクトフォルダを選択してください。')
    return
  }
  if (folderDocument.value) {
    setMessage('既存プロジェクトへの追加はカード一覧の＋を使用してください。')
    return
  }
  logDiagnostic('「画像を開く」の選択を開始しました')
  const loaded = await loadImage(file)
  if (!loaded)
    return
  try {
    editor.loadImageProject(
      file.name,
      loaded.element.naturalWidth,
      loaded.element.naturalHeight,
    )
    logDiagnostic('新規プロジェクトの最初のカード画像を反映しました')
    applyLoadedImage(loaded)
    const thumbnail = await cacheCardThumbnail(
      currentImageId.value,
      loaded.element,
    )
    if (thumbnail) {
      projectRuntime.setPendingCardThumbnail(currentImageId.value, thumbnail)
    }
    setMessage(`${file.name} を読み込みました。`)
  }
  catch (error) {
    URL.revokeObjectURL(loaded.url)
    logDiagnostic('編集プロジェクトの初期化に失敗しました', error, 'error')
    setMessage('画像の編集画面を初期化できませんでした。')
  }
}

/** 選択画像をアセットの切り出し元として読み込む。 */
async function openAssetSourceImage(file: File) {
  logDiagnostic('アセット切り出し元の画像選択を開始しました')
  const loaded = await loadImage(file)
  if (!loaded)
    return
  applyAssetSourceImage(loaded)
  assetEditing.value = false
  assetCreationDraft.value = null
  assetRecropId.value = null
  setMessage(`${file.name} をアセット切り出し元として読み込みました。`)
}

/** ファイルやフォルダ選択のキャンセルに相当する例外か判定する。 */
function isPickerCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 文書・カード画像・アセット画像の読み込みを終えてから編集画面を差し替える。 */
async function openProject(sample = false) {
  if (projectBusy.value || ocrRunning.value) {
    setMessage('カードの処理が完了してからプロジェクトを開いてください。')
    return
  }
  if (!await confirmLeave())
    return
  openingProject.value = true
  let stagedImage: RuntimeLoadedImage | null = null
  let stagedAssets: Map<string, ImageBitmap> | null = null
  logDiagnostic('「プロジェクトを開く」を開始しました')
  try {
    const directory = sample ? await createSampleProjectCopy(useRuntimeConfig().app.baseURL) : await pickProjectDirectory()
    logDiagnostic('プロジェクトフォルダの権限を取得しました')
    if (!(await folderProjectExists(directory))) {
      startNewFolderProject(directory)
      logDiagnostic('新規プロジェクト用のフォルダを選択しました', {
        folderName: directory.name,
      })
      setMessage(
        `${directory.name} を選択しました。最初のカード画像を開いてください。`,
      )
      return
    }
    const opened = await openFolderProject(directory)
    logDiagnostic('project.jsonと画像ファイルを取得しました', {
      cards: opened.document.cards.length,
      imageType: opened.imageFile.type || '(未設定)',
      imageSize: opened.imageFile.size,
    })
    const loaded = await loadImage(opened.imageFile)
    if (!loaded)
      return
    stagedImage = loaded
    stagedAssets = await loadProjectAssetImages(opened.assetFiles)
    projectRuntime.setDirectory(opened.directory)
    resetBatchOCR()
    projectStore.replaceProject(opened.document)
    editor.loadSavedProject({
      imageName: opened.card.imageName,
      imageWidth: loaded.element.naturalWidth,
      imageHeight: loaded.element.naturalHeight,
      regions: opened.card.regions,
    }, opened.card.id)
    currentImageId.value = opened.card.id
    resetCardThumbnails()
    pendingCardDeletionIds.value = new Set()
    cardPendingDeletionConfirmation.value = null
    clearAssetSourceImage()
    projectRuntime.replaceAssetImages(stagedAssets)
    stagedAssets = null
    applyLoadedImage(loaded)
    stagedImage = null
    projectRuntime.clearPendingAssetWrites()
    projectRuntime.replaceLoadedFonts(new Map())
    cachedFontIds.value = new Set()
    pendingFontCacheDeletionIds.value = new Set()
    fontPendingDeletionConfirmation.value = null
    await restoreCachedFonts(opened.document.fonts)
    await detectAndApplyCardDpi(opened.card.id, opened.imageFile)
    const thumbnail = await cacheCardThumbnail(opened.card.id, loaded.element)
    if (thumbnail) {
      void persistCardThumbnail(
        opened.directory,
        opened.card.id,
        thumbnail,
      )
    }
    currentView.value = 'card'
    if (isDemo.value)
      switchInspectorTab('ocr')
    await nextTick()
    lastSavedProjectSignature.value = projectSignature()
    logDiagnostic('保存済み編集データを反映しました', {
      regions: opened.card.regions.length,
    })
    setMessage(`${opened.document.name} を開きました。`)
  }
  catch (error) {
    if (isPickerCancellation(error)) {
      logDiagnostic('フォルダ選択をキャンセルしました')
      return
    }
    logDiagnostic('プロジェクトを開けませんでした', error, 'error')
    setMessage(
      error instanceof Error
        ? error.message
        : 'プロジェクトを開けませんでした。',
    )
  }
  finally {
    if (stagedImage) {
      URL.revokeObjectURL(stagedImage.url)
      stagedImage.element.removeAttribute('src')
    }
    stagedAssets?.forEach(bitmap => bitmap.close())
    openingProject.value = false
  }
}

/** 用語集へ原語・訳語・補足を追加する。 */
function addGlossaryEntry(source: string, translation: string, note: string) {
  const normalizedSource = source.trim()
  const normalizedTranslation = translation.trim()
  if (!normalizedSource || !normalizedTranslation)
    return
  if (glossary.value.some(entry => glossaryKey(entry.source) === glossaryKey(normalizedSource))) {
    setMessage(`用語「${normalizedSource}」は既に登録されています。`)
    return
  }
  projectStore.setGlossary([...glossary.value, {
    id: crypto.randomUUID(),
    source: normalizedSource,
    translation: normalizedTranslation,
    note: note.trim(),
  }])
}

/** 指定した用語集項目の内容を変更する。 */
function updateGlossaryEntry(
  id: string,
  patch: Pick<GlossaryEntry, 'source' | 'translation' | 'note'>,
) {
  const source = patch.source.trim()
  const translation = patch.translation.trim()
  if (!source || !translation) {
    setMessage('用語の原文と訳語は空にできません。')
    return
  }
  if (glossary.value.some(entry =>
    entry.id !== id && glossaryKey(entry.source) === glossaryKey(source),
  )) {
    setMessage(`用語「${source}」は既に登録されています。`)
    return
  }
  projectStore.setGlossary(glossary.value.map(entry => entry.id === id
    ? { ...entry, source, translation, note: patch.note.trim() }
    : entry))
}

/** 指定した用語集項目を取り除く。 */
function removeGlossaryEntry(id: string) {
  projectStore.setGlossary(glossary.value.filter(entry => entry.id !== id))
}

/** カード編集とアセット編集を切り替える。 */
function switchView(view: 'card' | 'assets') {
  currentView.value = view
  maskEditing.value = false
  exclusionEditing.value = false
  assetEditing.value = false
  assetRecropId.value = null
}

/** フォルダプロジェクトの印刷レイアウト画面を開く。 */
function openPrintLayout() {
  if (!folderDocument.value || !projectDirectory.value)
    return
  currentView.value = 'print'
  maskEditing.value = false
  exclusionEditing.value = false
}

/** 列数・余白・間隔などの用紙設定を文書へ反映する。 */
function updatePrintSettings(settings: FolderProjectDocument['printSettings']) {
  if (!folderDocument.value)
    return
  projectStore.replaceProject({ ...folderDocument.value, printSettings: settings })
}

/** 指定カードの縦横DPIを変更する。 */
function updateCardPrintDpi(cardId: string, sourceDpi: FolderProjectCard['sourceDpi']) {
  if (!folderDocument.value)
    return
  projectStore.replaceProject({
    ...folderDocument.value,
    cards: folderDocument.value.cards.map(card => card.id === cardId
      ? { ...card, sourceDpi }
      : card),
  })
}

/** 現在のカードの印刷用メタデータを更新する。 */
function updateActivePrintCard(
  patch: Partial<Pick<FolderProjectCard, 'printArea' | 'sourceDpi'>>,
) {
  const documentValue = folderDocument.value
  if (!documentValue)
    return
  projectStore.replaceProject({
    ...documentValue,
    cards: documentValue.cards.map(card => card.id === activeCardId.value
      ? { ...card, ...patch }
      : card),
  })
}

/** 現在のカードへ印刷範囲を設定する。 */
function updatePrintArea(area: RegionDraft) {
  updateActivePrintCard({ printArea: area })
}

/** 現在のカードの印刷範囲を解除する。 */
function clearPrintArea() {
  updateActivePrintCard({ printArea: null })
}

/** 現在のカードへ縦横DPIを設定する。 */
function updatePrintDpi(sourceDpi: FolderProjectCard['sourceDpi']) {
  updateActivePrintCard({ sourceDpi })
}

/** 他カードの未設定の印刷範囲を画像サイズ比で補い、未設定のDPIも現在のカードから引き継ぐ。 */
function applyPrintAreaToUnconfiguredCards() {
  const documentValue = folderDocument.value
  const sourceCard = activeProjectCard.value
  if (!documentValue || !sourceCard?.printArea)
    return
  const area = sourceCard.printArea
  projectStore.replaceProject({
    ...documentValue,
    cards: documentValue.cards.map((card) => {
      if (card.id === sourceCard.id)
        return card
      return {
        ...card,
        printArea: card.printArea ?? {
          x: area.x / sourceCard.imageWidth * card.imageWidth,
          y: area.y / sourceCard.imageHeight * card.imageHeight,
          width: area.width / sourceCard.imageWidth * card.imageWidth,
          height: area.height / sourceCard.imageHeight * card.imageHeight,
        },
        sourceDpi: card.sourceDpi ?? sourceCard.sourceDpi,
      }
    }),
  })
  setMessage('印刷範囲とDPIを未設定のカードへ一括適用しました。')
}

/** 指定範囲に新しい翻訳領域を追加する。 */
function addRegion(bounds: RegionDraft, backgroundColor: string) {
  editor.addRegion(bounds, backgroundColor)
  switchInspectorTab('region')
}

/** 翻訳領域の表示名を変更する。 */
function renameRegion(id: string, displayName: string) {
  const name = displayName.trim()
  if (!name)
    return
  editor.updateRegion(id, { displayName: name })
  setMessage(`領域名を「${name}」へ変更しました。`)
}

/** 領域削除の確認を開く。 */
function requestRegionDeletion(id: string) {
  regionPendingDeletionConfirmation.value
    = editor.project.value.regions.find(region => region.id === id) ?? null
}

/** 領域削除の確認を閉じる。 */
function cancelRegionDeletion() {
  regionPendingDeletionConfirmation.value = null
}

/** 確認した翻訳領域を削除する。 */
function confirmRegionDeletion() {
  const region = regionPendingDeletionConfirmation.value
  if (!region)
    return
  editor.removeRegion(region.id)
  regionPendingDeletionConfirmation.value = null
  setMessage(`「${region.displayName.trim() || region.regionId}」を削除しました。`)
}

/** 領域と内部マスク・保護範囲の座標を合わせて変更する。 */
function updateRegionBounds(regionId: string, bounds: RegionDraft) {
  const region = editor.project.value.regions.find(
    item => item.id === regionId,
  )
  if (!region)
    return
  editor.updateRegion(regionId, {
    ...bounds,
    ...transformRegionContents(region, bounds),
  })
}

/** 一筆分の手動マスクを領域へ追加する。 */
function addMaskStroke(regionId: string, stroke: MaskStroke) {
  const region = editor.project.value.regions.find(
    item => item.id === regionId,
  )
  if (!region)
    return
  const savedStroke: MaskStroke = {
    brushSize: stroke.brushSize,
    mode: stroke.mode,
    points: stroke.points.map(point => ({ ...point })),
  }
  editor.updateRegion(regionId, {
    manualMaskStrokes: [...region.manualMaskStrokes, savedStroke],
  })
}

/** 原文消去用マスクの描画モードを切り替える。 */
function toggleMaskEditing() {
  maskEditing.value = !maskEditing.value
  if (maskEditing.value) {
    exclusionEditing.value = false
    assetEditing.value = false
  }
}

/** 保護領域の作成・調整モードを切り替える。 */
function toggleExclusionEditing() {
  exclusionEditing.value = !exclusionEditing.value
  if (exclusionEditing.value) {
    maskEditing.value = false
    assetEditing.value = false
  }
}

/** 原文領域の内部へ保護矩形を追加する。 */
function addExclusion(regionId: string, bounds: RegionDraft) {
  const region = editor.project.value.regions.find(
    item => item.id === regionId,
  )
  if (!region)
    return
  const area: ExclusionArea = {
    id: crypto.randomUUID(),
    ...bounds,
  }
  editor.updateRegion(regionId, {
    exclusionAreas: [...region.exclusionAreas, area],
  })
  selectedExclusionId.value = area.id
  exclusionEditing.value = false
}

/** 指定した保護領域の位置と大きさを変更する。 */
function updateExclusion(
  regionId: string,
  exclusionId: string,
  bounds: RegionDraft,
) {
  const region = editor.project.value.regions.find(
    item => item.id === regionId,
  )
  if (!region)
    return
  editor.updateRegion(regionId, {
    exclusionAreas: region.exclusionAreas.map(area =>
      area.id === exclusionId ? { ...area, ...bounds } : area,
    ),
  })
}

/** 指定した保護領域を削除する。 */
function removeExclusion(regionId: string, exclusionId: string) {
  const region = editor.project.value.regions.find(
    item => item.id === regionId,
  )
  if (!region)
    return
  editor.updateRegion(regionId, {
    exclusionAreas: region.exclusionAreas.filter(
      area => area.id !== exclusionId,
    ),
  })
  selectedExclusionId.value = null
}

/** 指定カードの編集画像をPNGまたはJPEGとして書き出す。 */
async function exportCardImage(
  cardId: string,
  format: 'png' | 'jpeg',
) {
  if (exportDisposed || pendingCardDeletionIds.value.has(cardId))
    return
  if (currentImageId.value !== cardId) {
    await selectProjectCard(cardId)
    if (exportDisposed || currentImageId.value !== cardId)
      return
    await nextTick()
  }
  const blob
    = format === 'png'
      ? await canvasApi.value?.exportPng()
      : await canvasApi.value?.exportJpeg()
  if (exportDisposed)
    return
  if (!blob) {
    setMessage('カード画像を書き出せませんでした。')
    return
  }
  const name = editor.project.value.imageName.replace(/\.[^.]+$/u, '') || 'card'
  const extension = format === 'png' ? 'png' : 'jpg'
  downloadBlob(blob, `${name}-ja.${extension}`)
  logDiagnostic(`${format.toUpperCase()}画像を書き出しました`, {
    cardId,
    imageName: editor.project.value.imageName,
  })
}

/** 削除予定を除いたカードを順に書き出し、処理後は元の編集カードへ戻す。 */
async function exportAllCardImages(format: 'png' | 'jpeg') {
  if (exportDisposed || exportingCards.value || addingCards.value || loadingCardId.value)
    return
  const cards = projectCards.value.filter(
    card => !pendingCardDeletionIds.value.has(card.id),
  )
  if (cards.length < 2)
    return
  const originalCardId = currentImageId.value
  const extension = format === 'png' ? 'png' : 'jpg'
  let exported = 0
  exportingCards.value = true
  try {
    for (const [index, card] of cards.entries()) {
      if (exportDisposed)
        return
      if (currentImageId.value !== card.id) {
        await selectProjectCard(card.id)
        if (exportDisposed)
          return
        if (currentImageId.value !== card.id)
          continue
        await nextTick()
      }
      const blob = format === 'png'
        ? await canvasApi.value?.exportPng()
        : await canvasApi.value?.exportJpeg()
      if (exportDisposed)
        return
      if (!blob)
        continue
      const base = editor.project.value.imageName.replace(/\.[^.]+$/u, '')
        || 'card'
      const sequence = String(index + 1).padStart(3, '0')
      downloadBlob(blob, `${sequence}-${base}-ja.${extension}`)
      exported += 1
    }
  }
  finally {
    if (!exportDisposed && currentImageId.value !== originalCardId)
      await selectProjectCard(originalCardId)
    exportingCards.value = false
  }
  if (!exportDisposed)
    setMessage(`${exported}枚のカードを${format.toUpperCase()}で書き出しました。`)
}
</script>

<template>
  <div class="editor" :inert="projectBusy" :aria-busy="projectBusy">
    <EditorToolbar
      :has-card-image="Boolean(image)"
      :can-undo="currentView === 'card' && editor.canUndo.value"
      :can-redo="currentView === 'card' && editor.canRedo.value"
      :folder-projects-supported="folderProjectsSupported"
      :has-open-project="Boolean(projectDirectory)"
      :has-saved-project="Boolean(folderDocument)"
      :is-demo="isDemo"
      :save-status="saveStatus"
      :current-view="currentView"
      :diagnostic-count="diagnostics.length"
      @open-project="openProject"
      @save-project="saveProject"
      @import-csv="importCsv"
      @export-csv="exportCsv"
      @undo="editor.undo"
      @redo="editor.redo"
      @diagnostic="logDiagnostic"
      @view="switchView"
      @open-translation-settings="translationSettingsOpen = true"
      @open-glossary="glossaryOpen = true"
      @open-diagnostics="diagnosticsOpen = true"
    />
    <GlossaryDialog
      :open="glossaryOpen"
      :entries="glossary"
      @close="glossaryOpen = false"
      @add="addGlossaryEntry"
      @update="updateGlossaryEntry"
      @remove="removeGlossaryEntry"
    />
    <TranslationSettingsDialog
      :endpoint-enabled="translationEndpointEnabled"
      :open="translationSettingsOpen"
      :settings="translationSettings"
      @close="translationSettingsOpen = false"
      @save="
        updateTranslationSettings($event);
        translationSettingsOpen = false
      "
    />
    <TranslationReviewDialog
      v-if="translationReview"
      :cards="translationReview.cards"
      :active-card-id="currentImageId"
      :assets="assets"
      :asset-images="assetImages"
      :glossary="glossary"
      :initial-import="translationReview.initialImport"
      :auto-translate="translationReview.autoTranslate"
      :load-image="loadReviewImage"
      :translate="isDemo ? sampleTranslate : undefined"
      :error="translationReviewError"
      :applied-rows="translationReviewApplied"
      @apply="applyTranslationReview"
      @close="translationReview = null"
      @locate="locateReviewRegion"
    />
    <TranslationReuseDialog
      v-if="reuseRequest"
      :region="reuseRequest.region"
      :candidates="reuseRequest.candidates"
      :assets="assets"
      @close="reuseRequest = null"
      @apply="applyReusedTranslation"
    />

    <TranslationPreviewDialog
      v-if="translationPreview"
      :original-text="translationPreview.originalText"
      :current-translation="translationPreview.currentTranslation"
      :proposed-translation="translationPreview.proposedTranslation"
      @apply="applyTranslationPreview"
      @cancel="discardTranslationPreview"
    />
    <LayoutTemplateDialog
      v-if="layoutTemplateMode && image"
      :mode="layoutTemplateMode"
      :project="editor.project.value"
      :image-url="image.src"
      :templates="folderDocument?.layoutTemplates ?? []"
      @save="saveLayoutTemplate"
      @apply="applyLayoutTemplate"
      @close="layoutTemplateMode = null"
    />
    <RegionSplitDialog
      v-if="regionSplitRequest && image"
      :region="regionSplitRequest.region"
      :image-url="image.src"
      :image-width="editor.project.value.imageWidth"
      :image-height="editor.project.value.imageHeight"
      @apply="applyRegionSplit"
      @close="regionSplitRequest = null"
    />
    <SourceIconsDialog
      v-if="sourceIconsRequest && image"
      :region="sourceIconsRequest.region"
      :image-url="image.src"
      :image-width="editor.project.value.imageWidth"
      :image-height="editor.project.value.imageHeight"
      :assets="assets"
      @apply="applySourceIcons"
      @close="sourceIconsRequest = null"
    />
    <TranslationRequestDialog
      v-if="translationRequest"
      :original-text="translationRequest.originalText"
      :endpoint="translationRequest.endpoint"
      @send="sendTranslationRequest"
      @cancel="translationRequest = null"
    />
    <p v-if="message" class="notice" role="status">
      {{ message }}
    </p>
    <div
      v-if="regionPendingDeletionConfirmation"
      class="confirmation-backdrop"
      @click.self="cancelRegionDeletion"
    >
      <section
        class="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="region-delete-title"
        aria-describedby="region-delete-description"
        @keydown.esc="cancelRegionDeletion"
      >
        <h2 id="region-delete-title">
          領域を削除しますか？
        </h2>
        <p id="region-delete-description">
          「{{ regionPendingDeletionConfirmation.displayName.trim()
            || regionPendingDeletionConfirmation.regionId }}」を削除します。
          元テキスト、訳文、文字設定も削除されます。
        </p>
        <div class="confirmation-actions">
          <button type="button" autofocus @click="cancelRegionDeletion">
            キャンセル
          </button>
          <button
            type="button"
            class="confirmation-danger"
            @click="confirmRegionDeletion"
          >
            削除
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="cardPendingDeletionConfirmation"
      class="confirmation-backdrop"
      @click.self="cancelProjectCardDeletion"
    >
      <section
        class="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="card-delete-title"
        aria-describedby="card-delete-description"
        @keydown.esc="cancelProjectCardDeletion"
      >
        <h2 id="card-delete-title">
          カードを削除しますか？
        </h2>
        <p id="card-delete-description">
          「{{ cardPendingDeletionConfirmation.imageName }}」と翻訳領域
          {{ cardPendingDeletionConfirmation.regions.length }}件を一覧から削除します。
          この変更はプロジェクト保存時に確定します。
        </p>
        <div class="confirmation-actions">
          <button type="button" autofocus @click="cancelProjectCardDeletion">
            キャンセル
          </button>
          <button
            type="button"
            class="confirmation-danger"
            @click="confirmProjectCardDeletion"
          >
            削除
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="fontPendingDeletionConfirmation"
      class="confirmation-backdrop"
      @click.self="cancelFontDeletion"
    >
      <section
        class="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="font-delete-title"
        aria-describedby="font-delete-description"
        @keydown.esc="cancelFontDeletion"
      >
        <h2 id="font-delete-title">
          フォントを削除しますか？
        </h2>
        <p id="font-delete-description">
          「{{ fontPendingDeletionConfirmation.font.displayName }}」は
          {{ fontPendingDeletionConfirmation.usageCount }}件の領域で使用されています。
          削除すると、そのフォント指定は標準フォントへ戻ります。
          この変更はプロジェクト保存時に確定します。
        </p>
        <div class="confirmation-actions">
          <button type="button" autofocus @click="cancelFontDeletion">
            キャンセル
          </button>
          <button
            type="button"
            class="confirmation-danger"
            @click="confirmFontDeletion"
          >
            削除
          </button>
        </div>
      </section>
    </div>
    <div
      v-show="currentView === 'card'"
      class="editor-layout"
      :class="{ 'has-card-list': projectCards.length > 0 }"
    >
      <CardList
        v-if="projectCards.length > 0"
        :cards="projectCards"
        :active-card-id="activeCardId"
        :loading-card-id="loadingCardId"
        :adding-cards="addingCards"
        :exporting-cards="exportingCards"
        :can-add-cards="Boolean(folderDocument) && !isDemo"
        :add-cards-disabled-reason="isDemo ? 'デモではサンプルカードのみ編集できます。' : undefined"
        :thumbnails="cardThumbnails"
        :pending-deletion-ids="pendingCardDeletionIds"
        :batch-ocr-running="batchOCRRunning"
        :batch-ocr-completed="batchOCRCompleted"
        :batch-ocr-total="batchOCRTotal"
        :batch-ocr-eligible-count="batchOCREligibleCards.length"
        :batch-ocr-states="batchOCRStates"
        :batch-translation-available="true"
        :batch-translation-count="translationReviewCards.filter(card => card.regions.length).length"
        :translation-running="translationRunning"
        @start-batch-translation="openTranslationReview(undefined, false, isDemo)"
        @select="selectProjectCard"
        @add="addProjectCards"
        @add-folder="addProjectCardsFromFolder"
        @export-png="exportCardImage($event, 'png')"
        @export-jpeg="exportCardImage($event, 'jpeg')"
        @export-csv="exportCardCsv"
        @delete="requestProjectCardDeletion"
        @cancel-delete="cancelProjectCardDeletionRequest"
        @rename="renameCard"
        @move="moveCard"
        @export-all="exportAllCardImages"
        @select-region="selectProjectRegion"
        @request-thumbnail="requestCardThumbnail"
        @start-batch-ocr="startBatchOCR"
        @cancel-batch-ocr="requestBatchOCRCancellation"
        @open-print-layout="openPrintLayout"
      />
      <CardCanvas
        ref="canvasApi"
        :image="image"
        :project-selected="Boolean(projectDirectory)"
        :project="editor.project.value"
        :preview-deferred="previewDeferred"
        :selected-region-id="editor.selectedRegionId.value"
        :auto-mask-preview="autoMaskPreview"
        :mask-editing="maskEditing"
        :mask-brush-size="maskBrushSize"
        :mask-brush-mode="maskBrushMode"
        :exclusion-editing="exclusionEditing"
        :selected-exclusion-id="selectedExclusionId"
        :zoom="cardZoom"
        :preview-mode="cardPreviewMode"
        :assets="assets"
        :asset-images="assetImages"
        :font-families="fontFamilies"
        :region-candidates="regionCandidates"
        :selected-candidate-id="selectedCandidateId"
        :print-area="activeProjectCard?.printArea ?? null"
        :print-area-editing="inspectorTab === 'print'"
        @image="openCardImage"
        @diagnostic="logDiagnostic"
        @add-region="addRegion"
        @update-region-bounds="updateRegionBounds"
        @add-mask-stroke="addMaskStroke"
        @add-exclusion="addExclusion"
        @update-exclusion="updateExclusion"
        @select-exclusion="selectedExclusionId = $event"
        @select-region="selectRegionForEditing"
        @update-preview-mode="cardPreviewMode = $event"
        @update-zoom="cardZoom = $event"
        @select-region-candidate="selectRegionCandidate"
        @update-region-candidate-bounds="updateCandidateBounds"
        @update-print-area="updatePrintArea"
      />
      <aside class="side-panel">
        <p v-if="isDemo" class="muted">
          デモ：左側の「まとめて領域検出」→「選択した候補を追加」→ 左側の「まとめて翻訳」→PDF(A4)作成で翻訳からPDF作成の流れを体験できます。<br>
          デモでは領域・原文・翻訳・アセットはデモ用データを使います。実際はOCR認識、アセット登録、翻訳をする必要があります。<br>
        </p>
        <div v-if="isDemo && editor.project.value.regions.length" class="batch-translation-actions">
          <button
            type="button"
            :disabled="translationRunning || !batchTranslationRegions.length"
            @click="translateUntranslatedRegions"
          >
            {{ translationRunning ? '翻訳候補を取得中…' : `未翻訳をまとめて取得（${batchTranslationRegions.length}件）` }}
          </button>
          <small>このカードの原文がある未翻訳領域が対象です。</small>
        </div>
        <div class="side-panel-tabs" role="tablist" aria-label="領域の管理と編集">
          <button
            v-for="(tab, index) in inspectorTabs"
            :id="`inspector-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="inspectorTab === tab.id"
            :aria-controls="`inspector-panel-${tab.id}`"
            :class="{ selected: inspectorTab === tab.id }"
            :disabled="!canOpenInspectorTab(tab.id)"
            :tabindex="inspectorTab === tab.id ? 0 : -1"
            @click="switchInspectorTab(tab.id)"
            @keydown="moveInspectorTab($event, index)"
          >
            <span>{{ tab.label }}</span>
          </button>
        </div>
        <p
          v-if="editor.selectedRegion.value && inspectorTab !== 'list'"
          class="side-panel-selection"
        >
          <span>選択中</span>
          <strong>{{ editor.selectedRegion.value.displayName.trim()
            || editor.selectedRegion.value.regionId }}</strong>
        </p>
        <div
          v-show="inspectorTab === 'list'"
          id="inspector-panel-list"
          class="side-panel-tab-content"
          role="tabpanel"
          aria-labelledby="inspector-tab-list"
        >
          <RegionList
            :regions="editor.project.value.regions"
            :selected-id="editor.selectedRegionId.value"
            @select="selectRegionForEditing"
            @rename="renameRegion"
            @split="requestRegionSplit"
            @remove="requestRegionDeletion"
          />
          <details class="layout-template-tools">
            <summary>配置雛形</summary>
            <p v-if="!folderDocument" class="muted">
              プロジェクトを一度保存すると、配置雛形を登録できます。
            </p>
            <button type="button" :disabled="!folderDocument || !editor.project.value.regions.length || projectBusy" @click="layoutTemplateMode = 'capture'">
              このカードの領域を雛形にする
            </button>
            <button type="button" :disabled="!folderDocument?.layoutTemplates?.length || projectBusy" @click="layoutTemplateMode = 'apply'">
              配置雛形から領域を追加
            </button>
          </details>
          <p v-if="editor.project.value.regions.length === 0" class="muted">
            画像上をドラッグして最初の領域を追加してください。
          </p>
        </div>
        <RegionCandidatePanel
          v-show="inspectorTab === 'ocr'"
          :detection-disabled-reason="isDemo ? 'デモでは使用できません。左側の「まとめて領域検出」を使ってください。' : undefined"
          :has-image="Boolean(image)"
          :running="ocrRunning"
          :progress="ocrProgress"
          :status="ocrStatus"
          :candidates="regionCandidates"
          :selected-candidate-id="selectedCandidateId"
          :can-undo-change="regionCandidateEditHistory.length > 0"
          @detect="detectRegionCandidates"
          @toggle="toggleRegionCandidate"
          @split="splitCandidate"
          @undo-change="undoCandidateChange"
          @select-all="selectAllRegionCandidates"
          @confirm="confirmRegionCandidates"
          @cancel="discardRegionCandidates"
        />
        <RegionInspector
          v-show="inspectorTab === 'region' || inspectorTab === 'ocr' || inspectorTab === 'text'"
          :region="editor.selectedRegion.value"
          :active-tab="activeInspectorDetailTab"
          :auto-mask-preview="autoMaskPreview"
          :mask-editing="maskEditing"
          :mask-brush-size="maskBrushSize"
          :mask-brush-mode="maskBrushMode"
          :exclusion-editing="exclusionEditing"
          :selected-exclusion-id="selectedExclusionId"
          :fonts="fonts"
          :loaded-font-ids="loadedFontIds"
          :assets="assets"
          :asset-images="assetImages"
          :ocr-running="ocrRunning"
          :ocr-progress="ocrProgress"
          :ocr-status="ocrStatus"
          :ocr-candidate="ocrCandidate"
          :ocr-confidence="ocrConfidence"
          :ocr-layout="ocrLayout"
          :ocr-fill-enabled="cardPreviewMode === 'edited'"
          :ocr-correction-candidate="ocrCorrectionCandidate"
          :ocr-correction-changes="ocrCorrectionChanges"
          :ocr-dictionary="ocrDictionary"
          :translation-enabled="
            isDemo
              || (translationEndpointEnabled && translationSettings.provider === 'local')
          "
          :translation-running="translationRunning"
          :glossary="glossary"
          :reusable-translation-count="reusableTranslations.length"
          @reuse-translation="requestTranslationReuse"
          @update="editor.updateRegion"
          @defer-preview="deferPreview"
          @flush-preview="flushPreview"
          @update-auto-mask-preview="autoMaskPreview = $event"
          @toggle-mask-editing="toggleMaskEditing"
          @update-mask-brush-size="maskBrushSize = $event"
          @update-mask-brush-mode="maskBrushMode = $event"
          @clear-mask="editor.updateRegion($event, { manualMaskStrokes: [] })"
          @toggle-exclusion-editing="toggleExclusionEditing"
          @select-exclusion="selectedExclusionId = $event"
          @remove-exclusion="removeExclusion"
          @recognize-text="recognizeSelectedRegion"
          @update-ocr-candidate="updateOCRCandidate"
          @update-ocr-correction-candidate="ocrCorrectionCandidate = $event"
          @apply-ocr-candidate="applyOCRCandidate"
          @discard-ocr-candidate="finishOCRCandidate"
          @apply-ocr-correction="applyOCRCorrection"
          @discard-ocr-correction="discardOCRCorrection"
          @add-ocr-dictionary-entry="addOCRDictionaryEntry"
          @remove-ocr-dictionary-entry="removeOCRDictionaryEntry"
          @update-ocr-layout="ocrLayout = $event"
          @update-ocr-fill-enabled="
            cardPreviewMode = $event ? 'edited' : 'original'
          "
          @translate="translateSelectedRegion"
          @split="editor.selectedRegionId.value && requestRegionSplit(editor.selectedRegionId.value)"
          @source-icons="requestSourceIcons"
        />
        <PrintAreaInspector
          v-if="activeProjectCard"
          v-show="inspectorTab === 'print'"
          :area="activeProjectCard.printArea"
          :dpi="activeProjectCard.sourceDpi"
          :image-width="activeProjectCard.imageWidth"
          :image-height="activeProjectCard.imageHeight"
          :can-apply-to-others="projectCards.some(card => !card.printArea || !card.sourceDpi)"
          @update-area="updatePrintArea"
          @update-dpi="updatePrintDpi"
          @clear-area="clearPrintArea"
          @apply-to-others="applyPrintAreaToUnconfiguredCards"
        />
        <FontLibrary
          v-show="inspectorTab === 'text'"
          :fonts="fonts"
          :loaded-font-ids="loadedFontIds"
          @load="loadFont"
          @load-system="loadSystemFont"
          @rename="renameFont"
          @remove="requestFontDeletion"
        />
      </aside>
    </div>
    <AssetEditor
      v-show="currentView === 'assets'"
      :image="assetSourceImage"
      :assets="assets"
      :asset-images="assetImages"
      :zoom="assetZoom"
      :selecting="assetEditing"
      :creation-draft="assetCreationDraft"
      :creation-running="assetCreationRunning"
      @image="openAssetSourceImage"
      @toggle-selecting="toggleAssetEditing"
      @add="addAsset"
      @update-draft="updateAssetCreationDraft"
      @confirm-draft="confirmAssetCreation"
      @cancel-draft="cancelAssetCreation"
      @rename="renameAsset"
      @update="updateAsset"
      @recrop="startAssetRecrop"
      @remove="removeAsset"
      @update-zoom="assetZoom = $event"
    />
    <PrintLayoutWorkspace
      v-if="currentView === 'print' && folderDocument && projectDirectory"
      :project-name="folderDocument.name"
      :cards="projectCards.filter(card => !pendingCardDeletionIds.has(card.id))"
      :directory="projectDirectory"
      :settings="folderDocument.printSettings"
      :assets="assets"
      :asset-images="assetImages"
      :font-families="fontFamilies"
      @close="currentView = 'card'"
      @update-settings="updatePrintSettings"
      @update-dpi="updateCardPrintDpi"
    />
    <div
      v-if="diagnosticsOpen"
      class="confirmation-backdrop"
      @click.self="diagnosticsOpen = false"
    >
      <section
        class="diagnostics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
        @keydown.esc="diagnosticsOpen = false"
      >
        <div class="diagnostics-dialog-title">
          <div>
            <h2 id="diagnostics-title">
              診断ログ（{{ diagnostics.length }}件）
            </h2>
            <p>画像データやファイル内容は記録しません。</p>
          </div>
          <button type="button" autofocus @click="diagnosticsOpen = false">
            閉じる
          </button>
        </div>
        <ol v-if="diagnostics.length">
          <li
            v-for="(entry, index) in diagnostics"
            :key="`${entry.time}-${index}`"
            :class="{ error: entry.level === 'error' }"
          >
            <time>{{ entry.time }}</time>
            <span>{{ entry.message }}</span>
            <code v-if="entry.details">{{ entry.details }}</code>
          </li>
        </ol>
        <p v-else class="muted">
          ログはまだありません。
        </p>
        <div class="diagnostics-dialog-actions">
          <button
            type="button"
            :disabled="diagnostics.length === 0"
            @click="diagnostics = []"
          >
            ログを消去
          </button>
        </div>
      </section>
    </div>
    <DataPrivacyFooter />
  </div>
  <UnsavedChangesDialog :open="leaveConfirmationOpen" @resolve="resolveLeave" />
  <div v-if="projectBusy" class="project-operation-status" role="status">
    {{ savingProject ? 'プロジェクトを保存しています…' : openingProject ? 'プロジェクトを開いています…' : 'カードを処理しています…' }}
  </div>
</template>

<style scoped>
.batch-translation-actions {
  display: grid;
  justify-items: start;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.batch-translation-actions button {
  padding: 0.4rem 0.5rem;
  font-size: 0.75rem;
}

.batch-translation-actions small {
  color: #6b7688;
  font-size: 0.7rem;
}

.project-operation-status {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: 8px;
  background: #1e293b;
  color: white;
  z-index: 100;
}
</style>
