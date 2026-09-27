<script setup lang="ts">
import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import type { DiscoveryWorkspaceOptions } from '~/features/cards/useDiscoveryWorkspace'
import type {
  OCRProvider,
} from '~/services/ocr/types'
import type { EditorTabView, EditorView } from '~/types/editor-view'
import { storeToRefs } from 'pinia'
import { useBatchOCR } from '~/composables/useBatchOCR'
import { useCardImageExport } from '~/composables/useCardImageExport'
import { useCardThumbnails } from '~/composables/useCardThumbnails'
import { useEditorAssets } from '~/composables/useEditorAssets'
import { useEditorFonts } from '~/composables/useEditorFonts'
import { useEditorGlossary } from '~/composables/useEditorGlossary'
import { useEditorImageLoading } from '~/composables/useEditorImageLoading'
import { useEditorOCR } from '~/composables/useEditorOCR'
import { useEditorPrintSettings } from '~/composables/useEditorPrintSettings'
import { useEditorTranslation } from '~/composables/useEditorTranslation'
import { useProjectCards } from '~/composables/useProjectCards'
import { useProjectNavigation } from '~/composables/useProjectNavigation'
import { useProjectPersistence } from '~/composables/useProjectPersistence'
import { useProjectSession } from '~/composables/useProjectSession'
import { useRegionCandidates } from '~/composables/useRegionCandidates'
import { useTranslationReuse } from '~/composables/useTranslationReuse'
import { useTranslationReview } from '~/composables/useTranslationReview'
import AssetDiscoveryWorkspace from '~/features/cards/AssetDiscoveryWorkspace.vue'
import { provideCardEditing, provideCardOCR, provideCardResources, provideCardTranslation } from '~/features/cards/cardEditingContext'
import CardEditingWorkspace from '~/features/cards/CardEditingWorkspace.vue'
import IconRegionAnalysisDialog from '~/features/cards/IconRegionAnalysisDialog.vue'
import RegionOCRWorkspace from '~/features/cards/RegionOCRWorkspace.vue'
import { useBatchWorkspace } from '~/features/cards/useBatchWorkspace'
import { useCandidateReview } from '~/features/cards/useCandidateReview'
import { useCardWorkspace } from '~/features/cards/useCardWorkspace'
import { useDiscoveryImageIdentity } from '~/features/cards/useDiscoveryImageIdentity'
import { useEditorDiagnostics } from '~/features/cards/useEditorDiagnostics'
import { useEditorHistoryShortcuts } from '~/features/cards/useEditorHistoryShortcuts'
import { useEditorImageAdoption } from '~/features/cards/useEditorImageAdoption'
import { useEditorNotifications } from '~/features/cards/useEditorNotifications'
import { useProjectActivity } from '~/features/cards/useProjectActivity'
import { useProjectAdoption } from '~/features/cards/useProjectAdoption'
import { useQuickRegionApply } from '~/features/cards/useQuickRegionApply'
import { useRegionApplyFlow } from '~/features/cards/useRegionApplyFlow'
import { TesseractOCRProvider } from '~/services/ocr/tesseract'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import {
  supportsFolderProjects,
} from '~/services/project/folder'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import DiagnosticsDialog from './DiagnosticsDialog.vue'
import EditorConfirmDialog from './EditorConfirmDialog.vue'
import RegionCandidatePanel from './RegionCandidatePanel.vue'

const props = defineProps<{
  openSampleOnMount?: boolean
}>()

/** JSONに保存できるカード・共有設定を管理するストア。 */
const projectStore = useProjectStore()
/** カード単位の編集履歴を管理し、確定した変更をストアへ通知する。 */
const editor = useCardEditor((cardId, project) => {
  projectStore.updateCard(cardId, project)
}, {
  read: projectStore.readCardCandidateEdit,
  apply: projectStore.applyCardCandidateEdit,
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
let editorDisposed = false
/** 通知と診断はエディター単位で所有し、保存データへ混ぜない。 */
const { message, setMessage } = useEditorNotifications()
const { diagnostics, logDiagnostic, clearDiagnostics } = useEditorDiagnostics()
/** 画像の検証・デコード・未採用資源の解放。 */
const { loadImage } = useEditorImageLoading({
  isActive: () => !editorDisposed,
  setMessage,
  logDiagnostic,
})
/** 各機能が所有する保存・読込・追加・切替状態をエディター単位で集約する。 */
const activity = useProjectActivity()
const projectBusy = activity.busy
const discoveryIdentity = useDiscoveryImageIdentity({
  store: projectStore,
  runtime: projectRuntime,
  currentImageId,
  busy: projectBusy,
  logDiagnostic,
})
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
/** カード上でアセットの切り出し範囲を指定しているか。 */
const assetEditing = ref(false)
/** カード・アセット編集・アセット検出・印刷のうち現在表示する作業画面。 */
const currentView = ref<EditorView>('card')
/** 単一・全体・一括OCRで共有する実行状態。 */
const ocrRunning = ref(false)
/** カード画面の表示状態・選択・領域操作は同一の窓口を使う。 */
const workspace = useCardWorkspace({
  editor,
  image,
  hasProject: computed(() => Boolean(folderDocument.value)),
  currentImageId,
  currentView,
  projectBusy,
  ocrRunning,
  assetEditing,
  setMessage,
})
const { canvasApi, inspectorTab, switchInspectorTab, maskEditing, exclusionEditing, cardPreviewMode } = workspace
/** アセット編集画面の表示倍率。100が等倍。 */
const assetZoom = ref(100)
/** ブラウザがフォルダへの読み書きに対応しているか。 */
const folderProjectsSupported = ref(false)
/** 診断ログの表示欄を開いているか。 */
const diagnosticsOpen = ref(false)
/** ブラウザ内で英語OCRを実行するWorkerの管理窓口。 */
const ocrProvider: OCRProvider = new TesseractOCRProvider(
  useRuntimeConfig().app.baseURL,
)
/** OCRエンジンから通知された進捗値。 */
const ocrProgress = ref<number | null>(null)
/** OCRエンジンが現在実行している処理の説明。 */
const ocrStatus = ref('')
/** 単一領域の認識と補正。実行状態とWorkerは全体・一括OCRと共有する。 */
const regionOCR = useEditorOCR({
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
const { clearOCRCandidate } = regionOCR
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
const { savingProject, saveProject } = useProjectPersistence({
  editor,
  projectStore,
  projectRuntime,
  isDemo,
  activity,
  ocrRunning,
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
  createSourceIconAsset,
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
const candidateEditing = useRegionCandidates({
  editor,
  image,
  currentImageId,
  provider: ocrProvider,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  isDemo,
  cardPreviewMode,
  clearOCRCandidate,
  persistDisplayedBatchCandidates,
  setMessage,
  logDiagnostic,
})
const {
  regionCandidates,
  selectedCandidateId,
  regionCandidateEditHistory,
  clearRegionCandidates,
  toggleRegionCandidate,
  selectAllRegionCandidates,
  splitCandidate,
  undoCandidateChange,
  detectRegionCandidates: detectPlainRegionCandidates,
} = candidateEditing
/** 現在の翻訳設定と、ブラウザへの保存を伴う更新操作。 */
const { settings: translationSettings, configured: translationConfigured, updateSettings: updateTranslationSettings }
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
  browserProgress,
  cancelBrowserTranslation,
  browserTranslate,
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
        ...(projectStore.draftOCRCandidates.length ? { ocrCandidates: projectStore.draftOCRCandidates } : {}),
      },
    ]
  }
  return documentValue.cards
})
/** カード画像・編集履歴の切替と、切替後の領域への移動。 */
const { loadingCardId, selectProjectCard: navigateToCard, selectProjectRegion: navigateToRegion } = useProjectNavigation({
  editor,
  projectStore,
  projectDirectory,
  activity,
  translationRunning,
  ocrRunning,
  currentImageId,
  pendingCardDeletionIds,
  currentView,
  resetCardSelection: workspace.resetCardSelection,
  clearOCRCandidate,
  isActive: () => !editorDisposed,
  loadImage,
  applyLoadedImage,
  detectAndApplyCardDpi,
  cacheCardThumbnail,
  persistCardThumbnail,
  showBatchOCRCandidates,
  switchInspectorTab,
  setMessage,
  logDiagnostic,
})

/** カード一覧の改名・並べ替え・追加・削除予定。 */
const {
  addingCards,
  cardPendingDeletionConfirmation,
  renameCard,
  moveCard,
  requestProjectCardDeletion,
  cancelProjectCardDeletion,
  confirmProjectCardDeletion,
  cancelProjectCardDeletionRequest,
  addProjectCards,
  addProjectCardsFromFolder,
} = useProjectCards({
  editor,
  projectStore,
  projectRuntime,
  currentImageId,
  lastSavedProjectSignature,
  loadingCardId,
  activity,
  ocrRunning,
  isDemo,
  pendingCardDeletionIds,
  isActive: () => !editorDisposed,
  loadImage,
  selectProjectCard,
  setCardThumbnail,
  persistCardThumbnail,
  setMessage,
  logDiagnostic,
})
/** 単体・一括の画像書き出しと元カードへの復帰。 */
const { exportingCards, exportCardImage, exportAllCardImages } = useCardImageExport({
  editor,
  canvasApi,
  currentImageId,
  projectCards,
  pendingCardDeletionIds,
  addingCards,
  loadingCardId,
  selectProjectCard,
  setMessage,
  logDiagnostic,
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
  setCardOCRCandidates: projectStore.setCardOCRCandidates,
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
  setMessage,
  logDiagnostic,
})
/** 用語集の編集と、既存訳候補の確認・適用。 */
const { addGlossaryEntry, updateGlossaryEntry, removeGlossaryEntry } = useEditorGlossary({ projectStore, setMessage })
const { reusableTranslations, reuseRequest, requestTranslationReuse, applyReusedTranslation } = useTranslationReuse({ editor, currentImageId, projectCards, glossary, setMessage })
/** 保存済み文書または下書きで現在有効なカードID。 */
const activeCardId = computed(
  () => folderDocument.value?.activeCardId ?? currentImageId.value,
)
/** 現在のカードIDに対応する保存用メタデータ。 */
const activeProjectCard = computed(() => folderDocument.value?.cards.find(
  card => card.id === activeCardId.value,
) ?? null)
/** 印刷範囲・DPI・用紙設定の更新と未設定カードへの一括適用。 */
const {
  updatePrintSettings,
  updateCardPrintDpi,
  updatePrintArea,
  clearPrintArea,
  updatePrintDpi,
  applyPrintAreaToUnconfiguredCards,
} = useEditorPrintSettings({ projectStore, activeCardId, setMessage })

/** 読込済み画像の反映。URL等の所有・解放は共有runtimeを使う。 */
const imageAdoption = useEditorImageAdoption({
  isActive: () => !editorDisposed,
  editor,
  projectStore,
  projectRuntime,
  currentImageId,
  assetSourceImageId,
  assetEditing,
  assetCreationDraft,
  assetRecropId,
  addingCards,
  loadingCardId,
  clearRegionCandidates,
  loadImage,
  cacheCardThumbnail,
  updateCardPrintDpi,
  saveProject,
  addProjectCards,
  setMessage,
  logDiagnostic,
})
const { openCardImages, openAssetSourceImage } = imageAdoption

const candidateReview = useCandidateReview({
  currentImageId,
  activeProjectCard,
  regionCandidates,
  selectedCandidateId,
  regionCandidateEditHistory,
  cardPreviewMode,
  batchOCRResults,
  batchOCRStates,
  editor,
  updateBatchOCRResult,
  finishBatchOCRReview,
  clearRegionCandidates,
  promoteDiscoveryOwners: projectStore.reconcileDiscoveryOwners,
  switchInspectorTab,
  backgroundColorForBounds: bounds => canvasApi.value?.backgroundColorForBounds(bounds) ?? '#ffffff',
  setMessage,
  logDiagnostic,
})
const { discardRegionCandidates, confirmRegionCandidates } = candidateReview

const discoveryVisited = ref(false)
const discoveryWorking = ref(false)
watch(projectRuntime.projectGeneration, () => {
  discoveryVisited.value = false
  discoveryWorking.value = false
})
const iconAnalysisOpen = ref(false)
function detectRegionCandidates() {
  void detectPlainRegionCandidates()
}
function editAnalysisRegions() {
  iconAnalysisOpen.value = false
  switchView('card')
  if (editor.project.value.regions.length) {
    switchInspectorTab('list')
    return
  }
  switchInspectorTab('ocr')
  if (batchOCRResults.value.get(currentImageId.value)?.length)
    candidateReview.showBatchOCRCandidates(currentImageId.value)
  else
    void detectPlainRegionCandidates()
}
const discoveryOptions: DiscoveryWorkspaceOptions = {
  store: projectStore,
  runtime: projectRuntime,
  identity: discoveryIdentity,
  editor,
  currentImageId,
  ocrRunning,
  busy: computed(() => projectBusy.value || translationRunning.value || assetCreationRunning.value),
  pendingDeletionIds: pendingCardDeletionIds,
  provider: ocrProvider,
  createAsset: createSourceIconAsset,
  selectCard: selectProjectCard,
}
const quickRegionApply = useQuickRegionApply(discoveryOptions, setMessage)
const regionOCRFlow = useRegionApplyFlow({
  discovery: discoveryOptions,
  quickApply: quickRegionApply,
  discoveryWorking,
  iconAnalysisOpen,
  switchView,
  selectRegion: selectProjectRegion,
  setMessage,
})
const { iconAnalysisRegionId, discoveryFocus, returningToResults, batchAutoApply, openApplyTargets, openApplyResults, applyTargetCards } = regionOCRFlow
const { batchTranslationBusy, batchTranslationTargets, batchTranslationFocus, translationReturn, openBatchTranslation, batchSelection, selectBatchTargets, browseBatchCard, editTranslationCard } = useBatchWorkspace({
  currentView,
  projectGeneration: projectRuntime.projectGeneration,
  ocrRunning,
  projectBusy,
  isDemo,
  translationReview,
  translationReviewCards,
  openTranslationReview,
  regionOCRFlow,
  quickRegionApply,
  switchView,
  selectProjectCard,
  selectProjectRegion,
})
const reflectCandidateIcons = ref(true)
const autoApplyEnabled = computed(() => batchAutoApply.value)
const canReflectCandidateIcons = computed(() => !isDemo.value && Boolean(projectStore.assetDiscovery?.occurrences.some(item => item.cardId === currentImageId.value && item.assetId && item.decision !== 'excluded')))
const combinedBatchStates = computed(() => autoApplyEnabled.value ? new Map([...batchOCRStates.value, ...quickRegionApply.states.value]) : batchOCRStates.value)
async function startRegionBatch() {
  if (autoApplyEnabled.value)
    openApplyTargets()
  else
    await startBatchOCR()
}
async function confirmCandidatesWithIcons() {
  if (!canReflectCandidateIcons.value || !reflectCandidateIcons.value) {
    confirmRegionCandidates()
    return
  }
  regionOCRFlow.operation.value = 'detect'
  await applyTargetCards([currentImageId.value], true)
  if (!regionCandidates.value.length)
    switchInspectorTab('text')
}

useEditorHistoryShortcuts({
  enabled: () => !projectBusy.value && !ocrRunning.value && currentView.value === 'card',
  undo: editor.undo,
  redo: editor.redo,
})

// ブラウザ機能を確認し、必要ならサンプルを開く。
onMounted(() => {
  folderProjectsSupported.value = supportsFolderProjects()
  logDiagnostic('アプリを初期化しました', {
    folderProjectsSupported: folderProjectsSupported.value,
    secureContext: window.isSecureContext,
  })
  if (props.openSampleOnMount)
    void openProject(true)
  else if (!translationConfigured.value)
    translationSettingsOpen.value = true
})

// 通知・キーイベントは各composableが解放し、ここでは共有runtimeとOCRを終了する。
onBeforeUnmount(() => {
  editorDisposed = true
  projectRuntime.dispose()
  projectStore.clearProject()
  void ocrProvider.dispose?.().catch(error =>
    logDiagnostic('OCR Workerの終了に失敗しました', error, 'error'),
  )
})

/** 初期化時に相互参照する操作は、実行時に同じレビューインスタンスへ渡す。 */
function persistDisplayedBatchCandidates() {
  candidateReview.persistDisplayedBatchCandidates()
}

function showBatchOCRCandidates(cardId: string) {
  return candidateReview.showBatchOCRCandidates(cardId)
}

/** navigation等の初期化時には同じ画像採用インスタンスへの遅延委譲を渡す。 */
function applyLoadedImage(loaded: RuntimeLoadedImage) {
  imageAdoption.applyLoadedImage(loaded)
}

function detectAndApplyCardDpi(cardId: string, file: File) {
  return imageAdoption.detectAndApplyCardDpi(cardId, file)
}

/** 未保存判定に使用する現在の保存対象の比較値を作る。 */
function projectSignature() {
  if (!projectDirectory.value)
    return null
  const documentValue = folderDocument.value
  const cards = documentValue
    ? documentValue.cards
    : image.value
      ? [{ id: currentImageId.value, imagePath: '', printArea: null, sourceDpi: null, ...storedCard.value, ...(projectStore.draftOCRCandidates.length ? { ocrCandidates: projectStore.draftOCRCandidates } : {}) }]
      : []
  return savedProjectSignature({
    cards,
    assets: assets.value,
    fonts: fonts.value,
    ocrDictionary: ocrDictionary.value,
    glossary: glossary.value,
    assetDiscovery: projectStore.assetDiscovery,
    printSettings: documentValue?.printSettings ?? { ...DEFAULT_PRINT_SETTINGS },
  }, pendingCardDeletionIds.value, pendingAssetWrites.value.keys(), pendingFontCacheDeletionIds.value)
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

// 他機能の初期化時にも渡せるよう、切替操作の入口を関数宣言として保つ。
async function selectProjectCard(cardId: string) {
  await navigateToCard(cardId)
}

async function selectProjectRegion(cardId: string, regionId: string) {
  await navigateToRegion(cardId, regionId)
}

/** 文書と画像の準備が終わった後の、Store・履歴・runtimeへの採用。 */
const { startNewFolderProject, adoptOpenedProject, finishOpeningProject } = useProjectAdoption({
  editor,
  projectStore,
  projectRuntime,
  currentImageId,
  currentView,
  pendingCardDeletionIds,
  cardPendingDeletionConfirmation,
  cachedFontIds,
  pendingFontCacheDeletionIds,
  fontPendingDeletionConfirmation,
  lastSavedProjectSignature,
  isDemo,
  isActive: () => !editorDisposed,
  projectSignature,
  resetBatchOCR,
  resetCardThumbnails,
  clearLoadedCardImage: imageAdoption.clearLoadedCardImage,
  clearAssetSourceImage: imageAdoption.clearAssetSourceImage,
  applyLoadedImage,
  switchInspectorTab,
  showBatchOCRCandidates,
})

/** フォルダ選択と文書・画像の準備、未採用リソースの解放。 */
const { openingProject, openProject: openProjectSession } = useProjectSession({
  activity,
  ocrRunning,
  isActive: () => !editorDisposed,
  confirmLeave,
  baseURL: useRuntimeConfig().app.baseURL,
  loadImage,
  startNewFolderProject,
  adoptProject: adoptOpenedProject,
  restoreCachedFonts,
  detectAndApplyCardDpi,
  cacheCardThumbnail,
  persistCardThumbnail,
  onOpened: finishOpeningProject,
  setMessage,
  logDiagnostic,
})

// マウント時のサンプル読込からも使う操作の入口。
async function openProject(sample = false) {
  await openProjectSession(sample)
}

/** 同一プロジェクト内ではアセット検出の選択・比較案を保持して切り替える。 */
function switchView(view: EditorTabView) {
  if (batchTranslationBusy.value || discoveryWorking.value || quickRegionApply.running.value || (view === 'discovery' && (isDemo.value || !image.value)))
    return
  if (view === 'discovery')
    discoveryVisited.value = true
  currentView.value = view
  workspace.stopEditing()
  assetEditing.value = false
  assetRecropId.value = null
}

/** フォルダプロジェクトの印刷レイアウト画面を開く。 */
function openPrintLayout() {
  if (!folderDocument.value || !projectDirectory.value)
    return
  currentView.value = 'print'
  workspace.stopEditing()
}

// 既存インスタンスを責務別に共有する。資源解放・保存操作は全体側に残す。
provideCardEditing({ editor, workspace, cardId: currentImageId, notify: setMessage })
provideCardResources({
  createSourceIconAsset,
  image,
  projectSelected: computed(() => Boolean(projectDirectory.value)),
  assets,
  assetImages,
  fontFamilies,
  fonts,
  loadedFontIds,
})
provideCardOCR({
  region: regionOCR,
  execution: { running: ocrRunning, progress: ocrProgress, status: ocrStatus },
  dictionary: ocrDictionary,
  candidates: candidateEditing,
})
provideCardTranslation({
  enabled: computed(() => isDemo.value || translationSettings.value.provider === 'browser' || (translationEndpointEnabled && translationSettings.value.provider === 'local')),
  running: translationRunning,
  glossary,
  reusableCount: computed(() => reusableTranslations.value.length),
  requestReuse: requestTranslationReuse,
  translate: translateSelectedRegion,
})
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
      :discovery-available="!isDemo && Boolean(image)"
      :discovery-working="discoveryWorking || quickRegionApply.running.value || batchTranslationBusy"
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
    <IconRegionAnalysisDialog v-if="iconAnalysisOpen" :options="discoveryOptions" :initial-region-id="iconAnalysisRegionId" mode="reocr" @close="iconAnalysisOpen = false" @edit-regions="editAnalysisRegions" />
    <div v-if="returningToResults && currentView !== 'ocr'" class="ocr-return-bar">
      <button type="button" :disabled="ocrRunning || discoveryWorking" @click="openApplyResults">
        OCR結果に戻る
      </button>
      <span>修正後は、対象カードを「まとめて再OCR」で読み直してください。</span>
    </div>
    <div v-if="translationReturn && currentView === 'card'" class="ocr-return-bar">
      <button type="button" @click="switchView('translation')">
        翻訳確認に戻る
      </button>
    </div>
    <GlossaryDialog
      :open="glossaryOpen"
      :entries="glossary"
      @close="glossaryOpen = false"
      @add="addGlossaryEntry"
      @update="updateGlossaryEntry"
      @remove="removeGlossaryEntry"
    />
    <div v-if="browserProgress" class="notice" role="status">
      {{ browserProgress }}
      <button type="button" @click="cancelBrowserTranslation">
        翻訳を中止
      </button>
    </div>
    <TranslationSettingsDialog
      :initial-setup="!translationConfigured"
      :endpoint-enabled="translationEndpointEnabled"
      :open="translationSettingsOpen"
      :settings="translationSettings"
      @close="translationSettingsOpen = false"
      @save="
        updateTranslationSettings($event);
        translationSettingsOpen = false
      "
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
    <EditorConfirmDialog
      v-if="cardPendingDeletionConfirmation"
      id="card-delete"
      title="カードを削除しますか？"
      @cancel="cancelProjectCardDeletion"
      @confirm="confirmProjectCardDeletion"
    >
      「{{ cardPendingDeletionConfirmation.imageName }}」と翻訳領域
      {{ cardPendingDeletionConfirmation.regions.length }}件を一覧から削除します。
      この変更はプロジェクト保存時に確定します。
    </EditorConfirmDialog>
    <EditorConfirmDialog
      v-if="fontPendingDeletionConfirmation"
      id="font-delete"
      title="フォントを削除しますか？"
      @cancel="cancelFontDeletion"
      @confirm="confirmFontDeletion"
    >
      「{{ fontPendingDeletionConfirmation.font.displayName }}」は
      {{ fontPendingDeletionConfirmation.usageCount }}件の領域で使用されています。
      削除すると、そのフォント指定は標準フォントへ戻ります。
      この変更はプロジェクト保存時に確定します。
    </EditorConfirmDialog>
    <CardEditingWorkspace
      :visible="['card', 'ocr', 'translation'].includes(currentView)"
      :batch="currentView === 'ocr' || currentView === 'translation'"
      :has-card-list="projectCards.length > 0"
      :print-area="activeProjectCard?.printArea ?? null"
      @image="openCardImages"
      @diagnostic="logDiagnostic"
      @update-print-area="updatePrintArea"
    >
      <template #batch>
        <TranslationReviewDialog
          v-if="translationReview"
          v-show="currentView === 'translation'"
          :key="projectRuntime.projectGeneration.value"
          embedded
          :target-ids="batchTranslationTargets"
          :focused-card-id="batchTranslationFocus"
          :cards="translationReviewCards"
          :active-card-id="currentImageId"
          :assets="assets"
          :asset-images="assetImages"
          :glossary="glossary"
          :initial-import="translationReview.initialImport"
          :auto-translate="translationReview.autoTranslate"
          :load-image="loadReviewImage"
          :translate="isDemo ? sampleTranslate : translationSettings.provider === 'browser' ? browserTranslate : undefined"
          :browser-translation="!isDemo && translationSettings.provider === 'browser'"
          :error="translationReviewError"
          :applied-rows="translationReviewApplied"
          @apply="applyTranslationReview"
          @working="batchTranslationBusy = $event"
          @edit-card="editTranslationCard"
          @close="switchView('card')"
        />
        <RegionOCRWorkspace v-show="currentView === 'ocr'" :key="projectRuntime.projectGeneration.value" :options="discoveryOptions" :flow="regionOCRFlow" :runner="quickRegionApply" :thumbnails="cardThumbnails" @translate="openBatchTranslation" @request-thumbnail="requestCardThumbnail" @close="switchView('card')" />
      </template>
      <template #cards>
        <CardList
          v-if="projectCards.length > 0"
          :cards="projectCards"
          :batch-selection="batchSelection"
          :active-card-id="activeCardId"
          :loading-card-id="loadingCardId"
          :adding-cards="addingCards"
          :exporting-cards="exportingCards || batchTranslationBusy"
          :can-add-cards="Boolean(folderDocument) && !isDemo"
          :add-cards-disabled-reason="isDemo ? 'デモではサンプルカードのみ編集できます。' : undefined"
          :thumbnails="cardThumbnails"
          :pending-deletion-ids="pendingCardDeletionIds"
          :batch-ocr-running="batchOCRRunning || quickRegionApply.running.value"
          :batch-ocr-completed="autoApplyEnabled ? quickRegionApply.completed.value : batchOCRCompleted"
          :batch-ocr-total="autoApplyEnabled ? quickRegionApply.total.value : batchOCRTotal"
          :batch-ocr-eligible-count="autoApplyEnabled ? quickRegionApply.eligible.value.length : batchOCREligibleCards.length"
          :batch-ocr-states="combinedBatchStates"
          :batch-auto-apply-available="true"
          :reocr-available="!isDemo"
          :batch-auto-apply="autoApplyEnabled"
          :batch-apply-issues="quickRegionApply.issues.value"
          :batch-translation-available="true"
          :batch-translation-count="translationReviewCards.filter(card => card.regions.length).length"
          :translation-running="translationRunning || batchTranslationBusy"
          @select-batch-targets="selectBatchTargets"
          @update:batch-auto-apply="batchAutoApply = $event"
          @start-batch-reocr="openApplyTargets(undefined, 'reocr')"
          @start-batch-translation="openBatchTranslation"
          @select="browseBatchCard"
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
          @start-batch-ocr="startRegionBatch"
          @cancel-batch-ocr="quickRegionApply.running.value ? quickRegionApply.cancel() : requestBatchOCRCancellation()"
          @open-print-layout="openPrintLayout"
        />
      </template>
      <template #header>
        <p v-if="isDemo" class="muted">
          「領域検出」で対象カードを選んで実行し、候補を選択して追加します。「翻訳」で訳文候補を確認・反映した後、「PDF(A4)作成」から書き出せます。<br>
          デモでは用意済みの領域・原文・訳文候補と登録済みのアイコンを使います。実際のOCR認識や外部サービスへの翻訳依頼は行いません。
        </p>
        <div v-if="(isDemo || translationSettings.provider === 'browser') && editor.project.value.regions.length" class="batch-translation-actions">
          <button
            type="button"
            :disabled="translationRunning || !batchTranslationRegions.length"
            @click="translateUntranslatedRegions"
          >
            {{ translationRunning ? '翻訳候補を取得中…' : `未翻訳をまとめて取得（${batchTranslationRegions.length}件）` }}
          </button>
          <small>このカードの原文がある未翻訳領域が対象です。</small>
        </div>
      </template>
      <template #candidates>
        <RegionCandidatePanel
          v-show="inspectorTab === 'ocr'"
          :detection-disabled-reason="isDemo ? 'デモでは使用できません。左側の「領域検出」を使ってください。' : undefined"
          :has-image="Boolean(image)"
          :running="ocrRunning"
          :progress="ocrProgress"
          :status="quickRegionApply.running.value ? quickRegionApply.status.value : ocrStatus"
          :candidates="regionCandidates"
          :selected-candidate-id="selectedCandidateId"
          :can-undo-change="regionCandidateEditHistory.length > 0"
          :icon-reflection-available="canReflectCandidateIcons"
          :reflect-icons="reflectCandidateIcons"
          :cancellable="quickRegionApply.running.value"
          @update:reflect-icons="reflectCandidateIcons = $event"
          @stop="quickRegionApply.cancel"
          @detect="detectRegionCandidates"
          @toggle="toggleRegionCandidate"
          @split="splitCandidate"
          @undo-change="undoCandidateChange"
          @select-all="selectAllRegionCandidates"
          @confirm="confirmCandidatesWithIcons"
          @cancel="discardRegionCandidates"
        />
      </template>
      <template #print>
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
      </template>
      <template #fonts>
        <FontLibrary
          v-show="inspectorTab === 'text'"
          :fonts="fonts"
          :loaded-font-ids="loadedFontIds"
          @load="loadFont"
          @load-system="loadSystemFont"
          @rename="renameFont"
          @remove="requestFontDeletion"
        />
      </template>
    </CardEditingWorkspace>
    <AssetDiscoveryWorkspace
      v-if="discoveryVisited && projectDirectory && !isDemo"
      v-show="currentView === 'discovery'"
      :key="projectRuntime.projectGeneration.value"
      :options="discoveryOptions"
      :active="currentView === 'discovery'"
      :focus-occurrence="discoveryFocus"
      @working="discoveryWorking = $event"
      @open-ocr="(ids, mode) => openApplyTargets(ids, mode)"
    />
    <AssetEditor
      v-show="currentView === 'assets'"
      v-model:zoom="assetZoom"
      :image="assetSourceImage"
      :assets="assets"
      :asset-images="assetImages"
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
    <DiagnosticsDialog
      v-if="diagnosticsOpen"
      :entries="diagnostics"
      @close="diagnosticsOpen = false"
      @clear="clearDiagnostics"
    />
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
