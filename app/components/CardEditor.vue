<script setup lang="ts">
import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import type { LocalFontData } from '~/services/fonts/local-font'
import type {
  OCRCorrectionChange,
} from '~/services/ocr/correction-types'
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type {
  OCRLayout,
  OCRProvider,
  RegionCandidate,
} from '~/services/ocr/types'
import type {
  AssetCreationDraft,
  ExclusionArea,
  FolderProjectCard,
  FolderProjectDocument,
  FontReference,
  GlossaryEntry,
  ImageAsset,
  LayoutTemplate,
  MaskStroke,
  RegionDraft,
  SourceIcon,
  TextRegion,
} from '~/types/editor'
import type { TranslationMatchResult } from '~/utils/csv'
import type { SplitAxis, SplitText } from '~/utils/split-region'
import type { ReusableTranslation } from '~/utils/translation-reuse'
import type { TranslationReviewRow } from '~/utils/translation-review'
import { storeToRefs } from 'pinia'
import { usePreviewDeferral } from '~/composables/usePreviewDeferral'
import {
  cacheFont,
  loadCachedFont,
  removeCachedFont,
} from '~/services/fonts/cache'
import { loadLocalFont } from '~/services/fonts/local-font'
import { loadUserFont } from '~/services/fonts/user-font'
import {
  createRegionCandidates,
  splitRegionCandidate,
} from '~/services/ocr/candidates'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { LocalOCRCorrector } from '~/services/ocr/local-corrector'
import { runSequentialOCRQueue } from '~/services/ocr/queue'
import { TesseractOCRProvider } from '~/services/ocr/tesseract'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import {
  activateProjectCard,
  countCardFontUsage,
  countProjectFontUsage,
  finalizeProjectCardDeletions,
  moveProjectCard,
  removeCardFontReferences,
  removeProjectFont,
  renameProjectAssetTokens,
  renameProjectCard,
} from '~/services/project/cards'
import {
  addFolderProjectCards,
  createFolderProject,
  folderProjectExists,
  listImageFiles,
  loadFolderProjectCardImage,
  loadFolderProjectCardThumbnail,
  openFolderProject,
  pickImageDirectory,
  pickProjectDirectory,
  saveFolderProject,
  supportsFolderProjects,
  writeFolderProjectCardThumbnail,
} from '~/services/project/folder'
import { loadProjectAssetImages } from '~/services/project/resources'
import { createSampleProjectCopy, resolveSampleCandidates, sampleRegionCandidates } from '~/services/project/sample'
import {
  LocalTranslationProvider,
  translationErrorMessage,
} from '~/services/translator/local'
import { SampleTranslationProvider } from '~/services/translator/sample'
import { useProjectStore } from '~/stores/project'
import { updateRecroppedAsset, validateAssetName } from '~/utils/assets'
import { renderAssetCrop } from '~/utils/canvas/asset'
import {
  createCardThumbnailBlob,
  createCardThumbnailBlobFromFile,
} from '~/utils/card-thumbnail'
import {
  matchProjectTranslationRows,
  parseTranslationCsv,
  serializeProjectTranslationCsv,
  serializeTranslationCsv,
} from '~/utils/csv'
import { downloadBlob, downloadText } from '~/utils/download'
import {
  assertCsvTextLimits,
  assertFileSize,
  assertImageDimensions,
  FILE_LIMITS,
} from '~/utils/file-limits'
import { glossaryKey } from '~/utils/glossary'
import { readImageDpi } from '~/utils/image-dpi'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { historyShortcut } from '~/utils/keyboard'
import { fitsImage } from '~/utils/layout-template'
import { savedProjectSignature } from '~/utils/project-save'
import { regionTextLayout } from '~/utils/region-text-layout'
import { transformRegionContents } from '~/utils/regions'
import { sourceIconProblems, textWithSourceIcons } from '~/utils/source-icons'
import { reconcileTextStyles } from '~/utils/text-styles'
import { findReusableTranslations } from '~/utils/translation-reuse'
import { reviewRowsAreCurrent } from '~/utils/translation-review'
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
  cardSourceFile: sourceImageFile,
  assetSourceImage,
  directory: projectDirectory,
  cardThumbnails,
  pendingCardThumbnailBlobs,
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
/** 重複してサムネイルを要求しないための待機中カードID。 */
const thumbnailPendingIds = new Set<string>()
/** サムネイルを取得するカードIDと要求世代の待機列。 */
const thumbnailQueue: Array<{ cardId: string, generation: number }> = []
/** 現在並行して動いているサムネイル処理数。 */
let thumbnailWorkers = 0
/** プロジェクト切り替え前のサムネイル結果を捨てるための世代番号。 */
let thumbnailGeneration = 0
/** 次回保存時に削除するカードID。保存前なら取り消せる。 */
const pendingCardDeletionIds = shallowRef(new Set<string>())
/** 削除確認を待っているカード。 */
const cardPendingDeletionConfirmation = shallowRef<FolderProjectCard | null>(
  null,
)
/** 削除確認を待っている翻訳領域。 */
const regionPendingDeletionConfirmation = shallowRef<TextRegion | null>(null)
/** 登録・再切り出しを確定する前のアセット設定。 */
const assetCreationDraft = ref<AssetCreationDraft | null>(null)
/** 再切り出し対象の既存アセットID。 */
const assetRecropId = ref<string | null>(null)
/** このブラウザに保存できたフォントのID一覧。 */
const cachedFontIds = shallowRef(new Set<string>())
/** プロジェクト保存後にキャッシュから削除するフォントID。 */
const pendingFontCacheDeletionIds = shallowRef(new Set<string>())
/** 削除確認中のフォントと、その使用箇所数。 */
const fontPendingDeletionConfirmation = shallowRef<{
  font: FontReference
  usageCount: number
} | null>(null)
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
/** OCRの誤認識を辞書とローカル規則で補正する処理。 */
const ocrCorrector = new LocalOCRCorrector()
/** OCR処理を実行しているか。 */
const ocrRunning = ref(false)
/** OCRエンジンから通知された進捗値。 */
const ocrProgress = ref<number | null>(null)
/** OCRエンジンが現在実行している処理の説明。 */
const ocrStatus = ref('')
/** 領域未選択時に使用するOCRの読み取りモード。 */
const defaultOCRLayout = ref<OCRLayout>('text-block')
/** 選択領域のOCRモード。未選択時は共通の初期値を使用する。 */
const ocrLayout = computed<OCRLayout>({
  get: () => editor.selectedRegion.value ? regionTextLayout(editor.selectedRegion.value) : defaultOCRLayout.value,
  set: (layout) => {
    if (editor.selectedRegion.value)
      editor.updateRegion(editor.selectedRegion.value.id, { ocrLayout: layout })
    else
      defaultOCRLayout.value = layout
  },
})
/** 認識後、原文への反映を待っているOCR結果。 */
const ocrCandidate = ref('')
/** 現在のOCR結果の信頼度。値がなければnull。 */
const ocrConfidence = ref<number | null>(null)
/** OCR候補を取得した対象領域のID。 */
const ocrCandidateRegionId = ref<string | null>(null)
/** OCR開始時のカードIDと内容の照合情報。 */
const ocrCandidateSource = shallowRef<{ cardId: string, signature: string } | null>(null)
/** ローカル補正後の原文候補。 */
const ocrCorrectionCandidate = ref('')
/** 辞書や文字補正により提案された変更箇所。 */
const ocrCorrectionChanges = ref<OCRCorrectionChange[]>([])
/** 現在のカードで確認・調整している領域候補。 */
const regionCandidates = ref<RegionCandidate[]>([])
/** 移動や分割の操作対象として選択中の領域候補ID。 */
const selectedCandidateId = ref<string | null>(null)
/** 領域候補の位置変更や分割を戻すための履歴。 */
const regionCandidateEditHistory = ref<RegionCandidate[][]>([])
/** 複数カードの領域検出キューを実行中か。 */
const batchOCRRunning = ref(false)
/** 次のカードへ進む前に一括OCRを中止する要求。 */
const batchOCRCancelRequested = ref(false)
/** 一括OCRで処理を終えたカード数。 */
const batchOCRCompleted = ref(0)
/** 現在の一括OCRで処理するカードの総数。 */
const batchOCRTotal = ref(0)
/** カードIDごとの待機・処理中・確認待ち・失敗の状態。 */
const batchOCRStates = shallowRef(new Map<string, OCRQueueCardState>())
/** カードIDごとに退避した確認前の領域候補。 */
const batchOCRResults = shallowRef(new Map<string, RegionCandidate[]>())
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
/** 翻訳候補の取得処理中か。 */
const translationRunning = ref(false)
/** 送信確認に表示する原文・接続先・対象領域。 */
const translationRequest = shallowRef<{
  cardId: string
  regionId: string
  originalText: string
  endpoint: string
} | null>(null)
/** 反映前の翻訳候補と、取得時の原文・訳文の比較基準。 */
const translationPreview = shallowRef<{
  cardId: string
  regionId: string
  originalText: string
  currentTranslation: string
  proposedTranslation: string
} | null>(null)
/** まとめて確認するカードの複製と初期表示の条件。 */
const translationReview = shallowRef<{
  cards: FolderProjectCard[]
  initialImport?: TranslationMatchResult
  autoTranslate?: boolean
} | null>(null)
/** まとめて確認した訳文を反映できなかった理由。 */
const translationReviewError = ref('')
/** 親側で反映を終え、確認画面へ通知する行と訳文。 */
const translationReviewApplied = ref<{ key: string, translation: string }[]>([])
/** 現在のカードにある、原文付きで訳文が空の領域。 */
const batchTranslationRegions = computed(() => editor.project.value.regions.filter(
  region => region.originalText.trim() && !region.translatedText.trim(),
))

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
/** 削除予定を除いた翻訳確認用のカード一覧。 */
const translationReviewCards = computed(() => projectCards.value
  .filter(card => !pendingCardDeletionIds.value.has(card.id))
  .map(card => card.id === currentImageId.value ? { ...card, regions: editor.project.value.regions } : card))
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
/** 削除予定や現在の処理状態を考慮した一括OCRの対象カード。 */
const batchOCREligibleCards = computed(() => projectCards.value.filter((card) => {
  const state = batchOCRStates.value.get(card.id)
  return card.regions.length === 0
    && !pendingCardDeletionIds.value.has(card.id)
    && state?.status !== 'review'
    && state?.status !== 'processing'
    && state?.status !== 'queued'
}))

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
  window.removeEventListener('keydown', handleEditorKeydown)
  resetThumbnailQueue()
  projectRuntime.dispose()
  projectStore.clearProject()
  void ocrProvider.dispose?.().catch(error =>
    logDiagnostic('OCR Workerの終了に失敗しました', error, 'error'),
  )
})

/** 実際にブラウザへ読み込まれているフォントID。 */
const loadedFontIds = computed(() => new Set(loadedFonts.value.keys()))
/** 読み込み済みフォントIDと描画用family名の対応表。 */
const fontFamilies = computed(
  () =>
    new Map(
      fonts.value
        .filter(font => loadedFonts.value.has(font.id))
        .map(font => [font.id, `"${font.familyName}"`]),
    ),
)

/** 画面の操作結果メッセージを更新する。 */
function setMessage(value: string) {
  message.value = value
  window.setTimeout(() => {
    if (message.value === value)
      message.value = ''
  }, 4000)
}

/** 保存済みの参照に対応するフォントをブラウザのキャッシュから復元する。 */
async function restoreCachedFonts(references: FontReference[]) {
  const restored = new Map<string, FontFace>()
  const cached = new Set<string>()
  await Promise.all(references.map(async (reference) => {
    try {
      const face = await loadCachedFont(reference)
      if (!face)
        return
      restored.set(reference.id, face)
      cached.add(reference.id)
    }
    catch (error) {
      logDiagnostic(
        `保存済みフォント「${reference.displayName}」を復元できませんでした`,
        error,
        'error',
      )
    }
  }))
  projectRuntime.replaceLoadedFonts(restored)
  cachedFontIds.value = cached
  if (restored.size > 0) {
    logDiagnostic('ブラウザ保存済みフォントを復元しました', {
      restored: restored.size,
      requested: references.length,
    })
  }
}

/** フォントBlobをキャッシュし、保存できたフォントの一覧を更新する。 */
async function saveFontToCache(reference: FontReference, blob: Blob) {
  try {
    await cacheFont(reference.id, blob)
    cachedFontIds.value = new Set(cachedFontIds.value).add(reference.id)
    return true
  }
  catch (error) {
    logDiagnostic(
      `フォント「${reference.displayName}」をブラウザへ保存できませんでした`,
      error,
      'error',
    )
    return false
  }
}

/** OCR候補と信頼度・対象情報・補正候補を解除する。 */
function clearOCRCandidate() {
  ocrCandidate.value = ''
  ocrConfidence.value = null
  ocrCandidateRegionId.value = null
  ocrCandidateSource.value = null
  clearOCRCorrection()
}

/** 確認対象を複製し、モーダル内の下書きとカードの確定状態を分離する。 */
function openTranslationReview(initialImport?: TranslationMatchResult, currentOnly = false, autoTranslate = false) {
  translationReviewError.value = ''
  translationReviewApplied.value = []
  const cards = translationReviewCards.value.filter(card => !currentOnly || card.id === currentImageId.value)
  translationReview.value = { cards: JSON.parse(JSON.stringify(cards)), initialImport, autoTranslate }
}

/** 現在のカードの未翻訳を取得する設定で翻訳確認画面を開く。 */
function translateUntranslatedRegions() {
  openTranslationReview(undefined, true, true)
}

/** サンプル原文に対応する固定の日本語訳を取得する。 */
function sampleTranslate(text: string) {
  if (!isDemo.value)
    throw new Error('サンプル翻訳はデモでのみ使用できます。')
  return new SampleTranslationProvider().translate(text, 'EN', 'JA')
}

/** 翻訳確認に必要なカードの原画像を取得する。 */
async function loadReviewImage(cardId: string) {
  const card = translationReview.value?.cards.find(card => card.id === cardId)
  const directory = projectDirectory.value
  if (!card || !directory)
    throw new Error('カード画像が見つかりません。')
  if (!card.imagePath && cardId === currentImageId.value && image.value)
    return (await fetch(image.value.src)).blob()
  return loadFolderProjectCardImage(directory, card)
}

/** 翻訳確認画面を閉じ、指定カードの領域へ移動する。 */
async function locateReviewRegion(cardId: string, regionId: string) {
  translationReview.value = null
  await selectProjectRegion(cardId, regionId)
}

/** 対象が現在も同じ内容か照合し、選択された訳をCSVと共通の反映経路へ渡す。 */
function applyTranslationReview(rows: TranslationReviewRow[], closeAfterApply: boolean) {
  if (!rows.length)
    return
  if (!reviewRowsAreCurrent(rows, translationReviewCards.value)) {
    translationReviewError.value = '元の領域や訳文が変更されています。画面を開き直して確認してください。'
    return
  }
  const matched = matchProjectTranslationRows(translationReviewCards.value, currentImageId.value, rows.map(row => ({
    cardId: row.cardId,
    cardName: row.cardName,
    regionId: row.region.regionId,
    displayName: row.region.displayName,
    original: row.region.originalText,
    translation: row.translation,
  })), pendingCardDeletionIds.value)
  commitTranslations(matched)
  translationReviewError.value = ''
  translationReviewApplied.value = rows.map(row => ({ key: row.key, translation: row.translation }))
  if (closeAfterApply)
    translationReview.value = null
  setMessage(`${matched.applied}件の訳文を下書きとして反映しました。カード上で見た目を確認してください。`)
}

/** 選択領域の翻訳候補を取得するか、外部送信の確認を開く。 */
async function translateSelectedRegion() {
  const region = editor.selectedRegion.value
  if (
    !region
    || (!isDemo.value
      && (!translationEndpointEnabled || translationSettings.value.provider !== 'local'))
    || translationRunning.value
  ) {
    return
  }
  if (isDemo.value) {
    const cardId = currentImageId.value
    const originalText = region.originalText
    const currentTranslation = region.translatedText
    translationRunning.value = true
    try {
      const proposedTranslation = await sampleTranslate(originalText)
      if (cardId !== currentImageId.value)
        return
      translationPreview.value = { cardId, regionId: region.id, originalText, currentTranslation, proposedTranslation }
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'サンプル翻訳に失敗しました。')
    }
    finally {
      translationRunning.value = false
    }
    return
  }
  translationRequest.value = {
    cardId: currentImageId.value,
    regionId: region.id,
    originalText: region.originalText,
    endpoint: translationSettings.value.endpoint,
  }
}

/** 確認済みの送信先と原文を使う。取得結果は直接保存せず、カードに紐づく候補として提示する。 */
async function sendTranslationRequest() {
  const request = translationRequest.value
  if (!request || translationRunning.value)
    return
  translationRequest.value = null
  translationRunning.value = true
  try {
    const translatedText = await new LocalTranslationProvider(
      request.endpoint,
    ).translate(request.originalText, 'EN', 'JA')
    if (currentImageId.value !== request.cardId) {
      setMessage('カードが切り替わったため、翻訳候補を破棄しました。')
      return
    }
    const currentRegion = editor.project.value.regions.find(
      item => item.id === request.regionId,
    )
    if (!currentRegion) {
      setMessage('対象の翻訳領域が見つかりません。')
      return
    }
    translationPreview.value = {
      cardId: request.cardId,
      regionId: currentRegion.id,
      originalText: request.originalText,
      currentTranslation: currentRegion.translatedText,
      proposedTranslation: translatedText,
    }
    setMessage('翻訳候補を取得しました。反映前に内容を確認してください。')
  }
  catch (error) {
    logDiagnostic('ローカル翻訳に失敗しました', error, 'error')
    setMessage(translationErrorMessage(error))
  }
  finally {
    translationRunning.value = false
  }
}

/** 候補取得後のカード切り替えや本文変更を検出し、古い候補で最新の編集を上書きしない。 */
function applyTranslationPreview() {
  const preview = translationPreview.value
  if (!preview)
    return
  const region = editor.project.value.regions.find(
    item => item.id === preview.regionId,
  )
  if (!region || preview.cardId !== currentImageId.value
    || region.originalText !== preview.originalText || region.translatedText !== preview.currentTranslation) {
    translationPreview.value = null
    setMessage('対象が変更されたため、翻訳候補を反映しませんでした。候補を取得し直してください。')
    return
  }
  editor.updateRegion(region.id, {
    translatedText: preview.proposedTranslation,
    translationStatus: statusForTranslation(preview.proposedTranslation),
  })
  translationPreview.value = null
  setMessage('翻訳候補を日本語訳へ反映しました。')
}

/** 取得した翻訳候補を反映せず破棄する。 */
function discardTranslationPreview() {
  translationPreview.value = null
  setMessage('翻訳候補を破棄しました。')
}

/** ローカル補正の候補と変更箇所を解除する。 */
function clearOCRCorrection() {
  ocrCorrectionCandidate.value = ''
  ocrCorrectionChanges.value = []
}

/** OCRの確認用原文を更新し、古い補正候補を破棄する。 */
function updateOCRCandidate(text: string) {
  ocrCandidate.value = text
  clearOCRCorrection()
}

/** 補正候補をOCRの確認用原文に採用する。 */
function applyOCRCorrection() {
  if (!ocrCorrectionCandidate.value)
    return
  ocrCandidate.value = ocrCorrectionCandidate.value
  logDiagnostic('OCR補正候補を認識候補へ採用しました', {
    changes: ocrCorrectionChanges.value.length,
  })
  clearOCRCorrection()
}

/** 提案されたOCR補正を破棄する。 */
function discardOCRCorrection() {
  logDiagnostic('OCR補正候補を破棄しました', {
    changes: ocrCorrectionChanges.value.length,
  })
  clearOCRCorrection()
}

/** 現在のOCR候補へ辞書とローカル補正を適用し直す。 */
async function refreshOCRCorrection() {
  clearOCRCorrection()
  if (!ocrCandidate.value)
    return
  const correction = await ocrCorrector.correct(
    ocrCandidate.value,
    ocrDictionary.value,
  )
  if (correction.changes.length === 0)
    return
  ocrCorrectionCandidate.value = correction.correctedText
  ocrCorrectionChanges.value = correction.changes
}

/** 検証した置換規則をOCR補正辞書へ追加する。 */
async function addOCRDictionaryEntry(source: string, replacement: string) {
  const normalizedSource = source.trim()
  const normalizedReplacement = replacement.trim()
  if (!normalizedSource || !normalizedReplacement)
    return
  const existing = ocrDictionary.value.find(
    entry => entry.source.toLowerCase() === normalizedSource.toLowerCase(),
  )
  if (existing) {
    projectStore.setOCRDictionary(ocrDictionary.value.map(entry =>
      entry.id === existing.id
        ? { ...entry, replacement: normalizedReplacement }
        : entry))
  }
  else {
    projectStore.setOCRDictionary([
      ...ocrDictionary.value,
      {
        id: crypto.randomUUID(),
        source: normalizedSource,
        replacement: normalizedReplacement,
      },
    ])
  }
  logDiagnostic('OCRユーザー辞書を更新しました', {
    entries: ocrDictionary.value.length,
  })
  await refreshOCRCorrection()
}

/** 指定した補正規則を削除し、候補へ再適用する。 */
async function removeOCRDictionaryEntry(id: string) {
  projectStore.setOCRDictionary(
    ocrDictionary.value.filter(entry => entry.id !== id),
  )
  logDiagnostic('OCRユーザー辞書から項目を削除しました', {
    entries: ocrDictionary.value.length,
  })
  await refreshOCRCorrection()
}

/** OCR候補の確認を終え、関連する一時状態を消す。 */
function finishOCRCandidate() {
  clearOCRCandidate()
  cardPreviewMode.value = 'edited'
}

/** 現在表示している領域候補と選択・編集履歴を消す。 */
function clearRegionCandidates() {
  regionCandidates.value = []
  selectedCandidateId.value = null
  regionCandidateEditHistory.value = []
  cardPreviewMode.value = 'edited'
}

/** 一括OCRの進捗・結果・確認状態を初期化する。 */
function resetBatchOCR() {
  batchOCRCancelRequested.value = false
  batchOCRCompleted.value = 0
  batchOCRTotal.value = 0
  batchOCRStates.value = new Map()
  batchOCRResults.value = new Map()
}

/** 指定カードの一括OCR状態を更新または削除する。 */
function updateBatchOCRState(cardId: string, state: OCRQueueCardState | null) {
  const states = new Map(batchOCRStates.value)
  if (state)
    states.set(cardId, state)
  else
    states.delete(cardId)
  batchOCRStates.value = states
}

/** 指定カードの領域候補を一括OCR結果へ保存する。 */
function updateBatchOCRResult(
  cardId: string,
  candidates: readonly RegionCandidate[] | null,
) {
  const results = new Map(batchOCRResults.value)
  if (candidates)
    results.set(cardId, cloneRegionCandidates(candidates))
  else
    results.delete(cardId)
  batchOCRResults.value = results
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

/** 指定カードを除き、次に確認する一括OCR結果を探す。 */
function nextBatchOCRReviewCard(excludeCardId?: string) {
  return projectCards.value.find(card =>
    card.id !== excludeCardId
    && batchOCRStates.value.get(card.id)?.status === 'review')
}

/** 確認待ちのカードへ移動して領域候補を表示する。 */
async function openBatchOCRReview(cardId: string) {
  if (currentImageId.value !== cardId)
    await selectProjectCard(cardId)
  if (currentImageId.value === cardId && showBatchOCRCandidates(cardId))
    setMessage('OCRで検出した領域候補を確認してください。')
}

/** カードの候補確認が済んだことを一括OCRの状態へ反映する。 */
function finishBatchOCRReview(cardId: string) {
  updateBatchOCRResult(cardId, null)
  updateBatchOCRState(cardId, null)
  const next = nextBatchOCRReviewCard(cardId)
  if (next)
    void openBatchOCRReview(next.id)
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

/** 位置調整する領域候補を選択する。 */
function selectRegionCandidate(id: string | null) {
  selectedCandidateId.value = id
  logDiagnostic(
    id
      ? '領域候補へフォーカスしました'
      : '領域候補のフォーカスを解除しました',
    id ? { candidateId: id } : undefined,
  )
}

/** 領域候補を追加対象に含めるか切り替える。 */
function toggleRegionCandidate(id: string) {
  const candidate = regionCandidates.value.find(item => item.id === id)
  if (!candidate)
    return
  regionCandidates.value = regionCandidates.value.map(candidate =>
    candidate.id === id
      ? { ...candidate, selected: !candidate.selected }
      : candidate,
  )
  logDiagnostic('領域候補の追加対象を切り替えました', {
    candidateId: id,
    selected: !candidate.selected,
  })
  persistDisplayedBatchCandidates()
}

/** 表示している領域候補の選択状態をまとめて変更する。 */
function selectAllRegionCandidates(selected: boolean) {
  regionCandidates.value = regionCandidates.value.map(candidate => ({
    ...candidate,
    selected,
  }))
  logDiagnostic('領域候補の追加対象を一括変更しました', {
    selected,
    candidates: regionCandidates.value.length,
  })
  persistDisplayedBatchCandidates()
}

/** 候補の履歴を独立して保存できるよう深く複製する。 */
function cloneRegionCandidates(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    lines: candidate.lines.map(line => ({ ...line })),
  }))
}

/** 選んだOCR候補を認識済みの行に基づいて分割する。 */
function splitCandidate(id: string) {
  const index = regionCandidates.value.findIndex(candidate => candidate.id === id)
  if (index < 0)
    return
  const parts = splitRegionCandidate(regionCandidates.value[index]!)
  if (!parts)
    return
  regionCandidateEditHistory.value = [
    ...regionCandidateEditHistory.value,
    cloneRegionCandidates(regionCandidates.value),
  ].slice(-20)
  regionCandidates.value = regionCandidates.value.toSpliced(index, 1, ...parts)
  selectedCandidateId.value = parts[0].id
  logDiagnostic('領域候補を上下に分割しました', {
    candidateId: id,
    parts: parts.map(part => part.id),
    history: regionCandidateEditHistory.value.length,
  })
  setMessage('領域候補を上下2つに分割しました。')
  persistDisplayedBatchCandidates()
}

/** 候補の範囲変更を記録し、確認用の座標を更新する。 */
function updateCandidateBounds(id: string, bounds: RegionDraft) {
  const candidate = regionCandidates.value.find(item => item.id === id)
  if (!candidate)
    return
  regionCandidateEditHistory.value = [
    ...regionCandidateEditHistory.value,
    cloneRegionCandidates(regionCandidates.value),
  ].slice(-20)
  const scaleX = bounds.width / Math.max(1, candidate.width)
  const scaleY = bounds.height / Math.max(1, candidate.height)
  regionCandidates.value = regionCandidates.value.map(item =>
    item.id === id
      ? {
          ...item,
          ...bounds,
          lines: item.lines.map(line => ({
            ...line,
            x: bounds.x + (line.x - candidate.x) * scaleX,
            y: bounds.y + (line.y - candidate.y) * scaleY,
            width: line.width * scaleX,
            height: line.height * scaleY,
          })),
        }
      : item,
  )
  logDiagnostic('領域候補の範囲を変更しました', {
    candidateId: id,
    before: {
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    },
    after: bounds,
    history: regionCandidateEditHistory.value.length,
  })
  persistDisplayedBatchCandidates()
}

/** 領域候補に対する直前の位置変更や分割を戻す。 */
function undoCandidateChange() {
  const previous = regionCandidateEditHistory.value.at(-1)
  if (!previous)
    return
  regionCandidates.value = previous
  regionCandidateEditHistory.value = regionCandidateEditHistory.value.slice(0, -1)
  if (
    selectedCandidateId.value
    && !previous.some(candidate => candidate.id === selectedCandidateId.value)
  ) {
    selectedCandidateId.value = null
  }
  logDiagnostic('領域候補の変更を戻しました', {
    candidates: previous.length,
    remainingHistory: regionCandidateEditHistory.value.length,
  })
  setMessage('直前の候補変更を戻しました。')
  persistDisplayedBatchCandidates()
}

/** 現在のカード画像をOCRし、確認用の領域候補を作る。 */
async function detectRegionCandidates() {
  const source = image.value
  const project = editor.project.value
  if (!source || ocrRunning.value)
    return
  if (isDemo.value)
    return
  const startedAt = performance.now()
  ocrRunning.value = true
  ocrProgress.value = 0
  ocrStatus.value = '画像全体のOCRを初期化しています…'
  cardPreviewMode.value = 'original'
  editor.selectedRegionId.value = null
  clearOCRCandidate()
  regionCandidates.value = []
  selectedCandidateId.value = null
  regionCandidateEditHistory.value = []
  logDiagnostic('画像全体の領域候補検出を開始しました', {
    width: project.imageWidth,
    height: project.imageHeight,
    scale: 2,
  })
  try {
    const scale = 2
    const blob = await prepareRegionForOCR(
      source,
      {
        x: 0,
        y: 0,
        width: project.imageWidth,
        height: project.imageHeight,
      },
      { scale, padding: 0 },
    )
    const result = await ocrProvider.recognize(blob, {
      language: 'eng',
      layout: 'sparse-text',
      onProgress: (progress) => {
        ocrProgress.value = progress.progress
        ocrStatus.value = progress.status
      },
    })
    regionCandidates.value = createRegionCandidates(result.blocks, {
      scale,
      imageWidth: project.imageWidth,
      imageHeight: project.imageHeight,
      padding: 6,
    })
    logDiagnostic('画像全体の領域候補検出が完了しました', {
      detectedLines: result.blocks.length,
      candidates: regionCandidates.value.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
    if (regionCandidates.value.length === 0) {
      cardPreviewMode.value = 'edited'
      setMessage('領域候補を検出できませんでした。')
    }
    else {
      setMessage(`${regionCandidates.value.length}件の領域候補を検出しました。`)
    }
  }
  catch (error) {
    clearRegionCandidates()
    logDiagnostic('領域候補の検出に失敗しました', error, 'error')
    setMessage('領域候補を検出できませんでした。診断ログを確認してください。')
  }
  finally {
    ocrRunning.value = false
    ocrProgress.value = null
    ocrStatus.value = ''
  }
}

/** 一括OCRをカード間で中止する要求を記録する。 */
function requestBatchOCRCancellation() {
  batchOCRCancelRequested.value = true
  setMessage('現在のカードのOCR完了後に一括処理を中止します。')
}

/** 指定カードの画像から領域候補を作る。サンプルでは用意済みの候補を使う。 */
async function detectCardRegionCandidates(
  directory: FileSystemDirectoryHandle,
  card: FolderProjectCard,
  index: number,
  total: number,
) {
  if (isDemo.value) {
    const candidates = sampleRegionCandidates(card)
    ocrStatus.value = `${index + 1}/${total} ${card.imageName}: デモ候補を準備しています…`
    updateBatchOCRResult(card.id, candidates.length ? candidates : null)
    return candidates
  }
  const file = await loadFolderProjectCardImage(directory, card)
  assertFileSize(file, FILE_LIMITS.imageBytes, `${card.imageName}`)
  const bitmap = await createImageBitmap(file)
  try {
    assertImageDimensions(bitmap.width, bitmap.height, `${card.imageName}`)
    const scale = 2
    const blob = await prepareRegionForOCR(
      bitmap,
      { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      { scale, padding: 0 },
    )
    const result = await ocrProvider.recognize(blob, {
      language: 'eng',
      layout: 'sparse-text',
      onProgress: (progress) => {
        ocrProgress.value = progress.progress
        ocrStatus.value = `${index + 1}/${total} ${card.imageName}: ${progress.status}`
      },
    })
    const candidates = createRegionCandidates(result.blocks, {
      scale,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
      padding: 6,
    })
    updateBatchOCRResult(card.id, candidates.length > 0 ? candidates : null)
    return candidates
  }
  finally {
    bitmap.close()
  }
}

/** カードごとに候補を蓄え、確認待ち・失敗・空結果を一覧へ通知する。領域への追加は確認後に行う。 */
async function startBatchOCR() {
  const directory = projectDirectory.value
  const documentValue = folderDocument.value
  if (!directory || !documentValue || ocrRunning.value)
    return
  const cards = batchOCREligibleCards.value
  if (cards.length < 2) {
    setMessage('領域未作成のカードが2枚以上あるときに一括OCRを実行できます。')
    return
  }

  batchOCRCancelRequested.value = false
  batchOCRCompleted.value = 0
  const queuedStates = new Map(batchOCRStates.value)
  cards.forEach((card) => {
    queuedStates.set(card.id, { status: 'queued' })
    updateBatchOCRResult(card.id, null)
  })
  batchOCRStates.value = queuedStates
  batchOCRTotal.value = cards.length
  batchOCRRunning.value = true
  ocrRunning.value = true
  ocrProgress.value = 0
  ocrStatus.value = `1/${cards.length} OCRを初期化しています…`
  clearRegionCandidates()
  logDiagnostic('複数カードの領域候補検出を開始しました', {
    cards: cards.length,
  })

  try {
    const cardById = new Map(cards.map(card => [card.id, card]))
    const summary = await runSequentialOCRQueue(
      cards.map(card => card.id),
      async (cardId) => {
        const card = cardById.get(cardId)!
        const index = cards.findIndex(item => item.id === cardId)
        ocrProgress.value = 0
        ocrStatus.value = `${index + 1}/${cards.length} ${card.imageName}を解析しています…`
        return detectCardRegionCandidates(directory, card, index, cards.length)
      },
      {
        cancelled: () => batchOCRCancelRequested.value,
        onProgress: ({ cardId, index, state }) => {
          updateBatchOCRState(cardId, state)
          if (state.status !== 'processing')
            batchOCRCompleted.value = index + 1
          if (state.status === 'error') {
            updateBatchOCRResult(cardId, null)
            logDiagnostic('カードの一括OCRに失敗しました', {
              cardId,
              error: state.message,
            }, 'error')
          }
        },
      },
    )
    logDiagnostic('複数カードの領域候補検出が終了しました', summary)
    const result = [
      `確認待ち${summary.review}枚`,
      `候補なし${summary.empty}枚`,
      summary.errors > 0 ? `失敗${summary.errors}枚` : '',
    ].filter(Boolean).join('、')
    setMessage(
      summary.cancelled
        ? `一括OCRを中止しました（${result}）。`
        : `一括OCRが完了しました（${result}）。`,
    )
    if (summary.cancelled) {
      const remainingStates = new Map(batchOCRStates.value)
      remainingStates.forEach((state, cardId) => {
        if (state.status === 'queued')
          remainingStates.delete(cardId)
      })
      batchOCRStates.value = remainingStates
    }
  }
  finally {
    batchOCRRunning.value = false
    ocrRunning.value = false
    ocrProgress.value = null
    ocrStatus.value = ''
    const currentHasResult = batchOCRStates.value.get(currentImageId.value)
      ?.status === 'review'
    const firstReview = currentHasResult
      ? projectCards.value.find(card => card.id === currentImageId.value)
      : nextBatchOCRReviewCard()
    if (firstReview)
      await openBatchOCRReview(firstReview.id)
  }
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

/** 原文領域をOCR用に加工し、指定アイコンの位置を本文へ戻してから確認用の原文候補を作る。 */
async function recognizeSelectedRegion() {
  const region = editor.selectedRegion.value
  const source = image.value
  if (!region || !source || ocrRunning.value)
    return
  const iconProblems = sourceIconProblems(region, assets.value)
  if (iconProblems.length) {
    setMessage(iconProblems.join('\n'))
    return
  }

  const targetRegionId = region.id
  const targetCardId = currentImageId.value
  const targetSignature = JSON.stringify(region)
  const assetSnapshot = assets.value
  cardPreviewMode.value = 'original'
  ocrRunning.value = true
  ocrProgress.value = 0
  ocrStatus.value = 'OCRを初期化しています…'
  clearOCRCandidate()
  logDiagnostic('選択領域のOCRを開始しました', {
    regionId: region.regionId,
    width: region.width,
    height: region.height,
  })
  try {
    const blob = await prepareRegionForOCR(source, region, {
      exclusions: [...region.exclusionAreas, ...(region.sourceIcons ?? [])],
      scale: 3,
    })
    const result = await ocrProvider.recognize(blob, {
      language: 'eng',
      layout: ocrLayout.value,
      onProgress: (progress) => {
        ocrProgress.value = progress.progress
        ocrStatus.value = progress.status
      },
    })
    if (editor.selectedRegionId.value !== targetRegionId || currentImageId.value !== targetCardId
      || JSON.stringify(editor.selectedRegion.value) !== targetSignature || assets.value !== assetSnapshot) {
      setMessage('認識中に対象が変更されたため、OCR候補を破棄しました。')
      return
    }
    const recognizedText = textWithSourceIcons(result, region.sourceIcons ?? [], assets.value)
    ocrCandidate.value = recognizedText
    ocrConfidence.value = result.confidence
    ocrCandidateRegionId.value = targetRegionId
    ocrCandidateSource.value = { cardId: targetCardId, signature: targetSignature }
    if (recognizedText) {
      const correction = await ocrCorrector.correct(
        recognizedText,
        ocrDictionary.value,
      )
      if (correction.changes.length > 0) {
        ocrCorrectionCandidate.value = correction.correctedText
        ocrCorrectionChanges.value = correction.changes
        logDiagnostic('OCR補正候補を生成しました', {
          changes: correction.changes.length,
          characters: correction.correctedText.length,
        })
      }
      else {
        logDiagnostic('OCR補正候補はありませんでした')
      }
    }
    if (!recognizedText) {
      cardPreviewMode.value = 'edited'
      setMessage('文字を認識できませんでした。領域やレイアウトを調整してください。')
    }
    logDiagnostic('選択領域のOCRが完了しました', {
      confidence: result.confidence,
      blocks: result.blocks.length,
      characters: result.text.length,
    })
  }
  catch (error) {
    cardPreviewMode.value = 'edited'
    logDiagnostic('選択領域のOCRに失敗しました', error, 'error')
    setMessage(error instanceof Error ? error.message : 'OCRに失敗しました。診断ログを確認してください。')
  }
  finally {
    ocrRunning.value = false
    ocrProgress.value = null
    ocrStatus.value = ''
  }
}

/** 対象の整合性を確認してOCR候補を領域の原文へ反映する。 */
function applyOCRCandidate() {
  const regionId = ocrCandidateRegionId.value
  if (!regionId || !ocrCandidate.value.trim())
    return
  const region = editor.project.value.regions.find(item => item.id === regionId)
  if (ocrCandidateSource.value?.cardId !== currentImageId.value
    || ocrCandidateSource.value.signature !== JSON.stringify(region)) {
    clearOCRCandidate()
    setMessage('領域が変更されたため、OCR候補を反映しませんでした。認識し直してください。')
    return
  }
  editor.updateRegion(regionId, { originalText: ocrCandidate.value.trim() })
  finishOCRCandidate()
  setMessage('OCR候補を元テキストへ反映しました。')
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

/** カードの一覧用サムネイルを登録する。 */
function setCardThumbnail(cardId: string, thumbnail: Blob) {
  projectRuntime.setCardThumbnail(cardId, thumbnail)
}

/** サムネイル要求をリセットし、古い世代の結果を無効にする。 */
function resetThumbnailQueue() {
  thumbnailGeneration += 1
  thumbnailQueue.splice(0)
  thumbnailPendingIds.clear()
}

/** 全カードのサムネイルを解除する。 */
function resetCardThumbnails() {
  resetThumbnailQueue()
  projectRuntime.resetCardThumbnails()
}

/** 指定カードのサムネイルを取り除く。 */
function removeCardThumbnail(cardId: string) {
  projectRuntime.removeCardThumbnail(cardId)
}

/** 読み込み済みの画像から一覧用サムネイルを作る。 */
async function cacheCardThumbnail(cardId: string, source: HTMLImageElement) {
  const thumbnail = await createCardThumbnailBlob(
    source,
    source.naturalWidth,
    source.naturalHeight,
  )
  if (thumbnail)
    setCardThumbnail(cardId, thumbnail)
  return thumbnail
}

/** サムネイルを任意のキャッシュファイルとして保存する。 */
async function persistCardThumbnail(
  directory: FileSystemDirectoryHandle,
  cardId: string,
  thumbnail: Blob,
  generation = thumbnailGeneration,
) {
  if (!isCurrentThumbnailRequest(directory, cardId, generation))
    return
  try {
    await writeFolderProjectCardThumbnail(directory, cardId, thumbnail)
  }
  catch (error) {
    logDiagnostic('サムネイルキャッシュを保存できませんでした', error)
  }
}

/** サムネイル要求が現在のプロジェクトと世代に属するか照合する。 */
function isCurrentThumbnailRequest(
  directory: FileSystemDirectoryHandle,
  cardId: string,
  generation: number,
) {
  return generation === thumbnailGeneration
    && directory === projectDirectory.value
    && Boolean(folderDocument.value?.cards.some(card => card.id === cardId))
}

/** 保存済みサムネイルを画像として利用できるか検証する。 */
async function isUsableCardThumbnail(thumbnail: Blob) {
  try {
    const bitmap = await createImageBitmap(thumbnail)
    const usable = bitmap.width > 0
      && bitmap.height > 0
      && bitmap.width <= 144
      && bitmap.height <= 180
    bitmap.close()
    return usable
  }
  catch {
    return false
  }
}

/** キャッシュを読み、必要なら元画像からサムネイルを再生成する。 */
async function loadRequestedCardThumbnail(
  cardId: string,
  generation: number,
) {
  const directory = projectDirectory.value
  const card = folderDocument.value?.cards.find(item => item.id === cardId)
  if (
    !directory
    || !card
    || !isCurrentThumbnailRequest(directory, cardId, generation)
  ) {
    return
  }
  let thumbnail: Blob | null = await loadFolderProjectCardThumbnail(
    directory,
    cardId,
  )
  if (thumbnail && !(await isUsableCardThumbnail(thumbnail))) {
    logDiagnostic('破損したサムネイルキャッシュを再生成します', { cardId })
    thumbnail = null
  }
  if (!thumbnail) {
    const source = await loadFolderProjectCardImage(directory, card)
    thumbnail = await createCardThumbnailBlobFromFile(
      source,
      card.imageWidth,
      card.imageHeight,
    )
    if (thumbnail && isCurrentThumbnailRequest(directory, cardId, generation))
      void persistCardThumbnail(directory, cardId, thumbnail, generation)
  }
  if (thumbnail && isCurrentThumbnailRequest(directory, cardId, generation))
    setCardThumbnail(cardId, thumbnail)
}

/** サムネイルの読み込み数を制限し、プロジェクト切り替え前の要求は世代番号で無効にする。 */
function drainThumbnailQueue() {
  while (thumbnailWorkers < 2 && thumbnailQueue.length > 0) {
    const request = thumbnailQueue.shift()!
    thumbnailWorkers += 1
    void loadRequestedCardThumbnail(request.cardId, request.generation)
      .catch(error =>
        logDiagnostic('カードサムネイルを読み込めませんでした', error))
      .finally(() => {
        thumbnailWorkers -= 1
        if (request.generation === thumbnailGeneration)
          thumbnailPendingIds.delete(request.cardId)
        drainThumbnailQueue()
      })
  }
}

/** カードのサムネイル読み込みを待機列へ追加する。 */
function requestCardThumbnail(cardId: string) {
  if (
    cardThumbnails.value.has(cardId)
    || thumbnailPendingIds.has(cardId)
    || !folderDocument.value?.cards.some(card => card.id === cardId)
  ) {
    return
  }
  thumbnailPendingIds.add(cardId)
  thumbnailQueue.push({ cardId, generation: thumbnailGeneration })
  drainThumbnailQueue()
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

/** 保存対象の画像更新・削除予定を控え、成功したスナップショットだけを保存済みとして扱う。 */
async function saveProject() {
  if (isDemo.value) {
    setMessage('デモではプロジェクトを保存できません。')
    return
  }
  if (projectBusy.value || ocrRunning.value) {
    setMessage('カードの処理が完了してから保存してください。')
    return
  }
  if (!image.value || !sourceImageFile.value)
    return
  savingProject.value = true
  const savedWrites = new Map(pendingAssetWrites.value)
  const savedDeletionIds = new Set(pendingCardDeletionIds.value)
  const wasDraft = !folderDocument.value
  try {
    let savedDocument: FolderProjectDocument
    logDiagnostic('プロジェクト保存を開始しました', {
      existingProject: Boolean(folderDocument.value),
      projectFolderSelected: Boolean(projectDirectory.value),
      regions: editor.project.value.regions.length,
      pendingAssetWrites: pendingAssetWrites.value.size,
    })
    if (projectDirectory.value && folderDocument.value) {
      const finalized = finalizeProjectCardDeletions(
        folderDocument.value,
        pendingCardDeletionIds.value,
      )
      savedDocument = await saveFolderProject(
        projectDirectory.value,
        finalized.document,
        storedCard.value,
        assets.value,
        fonts.value,
        ocrDictionary.value,
        savedWrites,
        finalized.deletedCards,
        glossary.value,
      )
      projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
      pendingCardDeletionIds.value = new Set([...pendingCardDeletionIds.value].filter(id => !savedDeletionIds.has(id)))
      if (finalized.deletedCards.length > 0) {
        for (const card of finalized.deletedCards)
          removeCardThumbnail(card.id)
        logDiagnostic('削除予定のカードをファイルから削除しました', {
          deleted: finalized.deletedCards.length,
        })
      }
    }
    else {
      const directory = projectDirectory.value
      if (!directory) {
        setMessage('先にプロジェクトフォルダを選択してください。')
        return
      }
      savedDocument = await createFolderProject(
        directory,
        storedCard.value,
        sourceImageFile.value,
        currentImageId.value,
        assets.value,
        fonts.value,
        ocrDictionary.value,
        savedWrites,
        glossary.value,
      )
      projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
      if (wasDraft)
        editor.bindSavedCard(savedDocument.activeCardId)
    }
    const thumbnailDirectory = projectDirectory.value
    if (thumbnailDirectory && pendingCardThumbnailBlobs.value.size > 0) {
      pendingCardThumbnailBlobs.value.forEach((thumbnail, cardId) => {
        void persistCardThumbnail(thumbnailDirectory, cardId, thumbnail)
      })
      projectRuntime.clearPendingCardThumbnails()
    }
    projectRuntime.acknowledgeAssetWrites(savedWrites)
    await finalizeFontCacheDeletions()
    await nextTick()
    lastSavedProjectSignature.value = savedProjectSignature(savedDocument)
    logDiagnostic('プロジェクト保存が完了しました')
    setMessage(`${savedDocument.name} を保存しました。`)
  }
  catch (error) {
    if (isPickerCancellation(error)) {
      logDiagnostic('保存先の選択をキャンセルしました')
      return
    }
    logDiagnostic('プロジェクトを保存できませんでした', error, 'error')
    setMessage(
      error instanceof Error
        ? error.message
        : 'プロジェクトを保存できませんでした。',
    )
  }
  finally {
    savingProject.value = false
  }
}

/** カード上でのアセット範囲指定を切り替える。 */
function toggleAssetEditing() {
  assetRecropId.value = null
  assetEditing.value = !assetEditing.value
  if (assetEditing.value) {
    maskEditing.value = false
    exclusionEditing.value = false
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

/** 開いている元画像で再切り出しするアセットを指定し、範囲選択を開始する。 */
function startAssetRecrop(id: string) {
  if (!assetSourceImage.value) {
    setMessage('先にアセット元画像を開いてください。')
    return
  }
  const asset = assets.value.find(item => item.id === id)
  if (!asset)
    return
  assetRecropId.value = id
  assetCreationDraft.value = null
  assetEditing.value = true
  maskEditing.value = false
  exclusionEditing.value = false
  setMessage(`元画像上でアセット「${asset.name}」の新しい範囲をドラッグしてください。`)
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

/** 指定範囲を元に、登録前のアセット作成下書きを開く。 */
function addAsset(bounds: RegionDraft) {
  const editingAsset = assetRecropId.value
    ? assets.value.find(asset => asset.id === assetRecropId.value)
    : null
  const fallback = editingAsset?.name ?? `asset_${assets.value.length + 1}`
  assetCreationDraft.value = {
    editingAssetId: editingAsset?.id ?? null,
    name: fallback,
    sourceRect: bounds,
    removeBackground: true,
    backgroundColor: null,
    backgroundThreshold: 48,
    edgeFeather: 12,
    manualMaskStrokes: [],
  }
  assetRecropId.value = null
  assetEditing.value = false
}

/** 切り出し・透過設定の下書きを更新する。 */
function updateAssetCreationDraft(patch: Partial<AssetCreationDraft>) {
  if (!assetCreationDraft.value)
    return
  assetCreationDraft.value = { ...assetCreationDraft.value, ...patch }
}

/** アセット作成の下書きを破棄して閉じる。 */
function cancelAssetCreation() {
  assetCreationDraft.value = null
}

/** 透過処理後の画像を登録する。再切り出しではIDを引き継ぎ、ファイルへの書き込みは保存まで待つ。 */
async function confirmAssetCreation() {
  const draft = assetCreationDraft.value
  const sourceImage = assetSourceImage.value
  if (!draft || !sourceImage)
    return
  const name = draft.name.trim()
  const nameError = validateAssetName(
    name,
    assets.value,
    draft.editingAssetId ?? undefined,
  )
  if (nameError) {
    setMessage(nameError)
    return
  }
  const existingAsset = draft.editingAssetId
    ? assets.value.find(asset => asset.id === draft.editingAssetId)
    : null
  if (draft.editingAssetId && !existingAsset) {
    setMessage('更新対象のアセットが見つかりませんでした。')
    return
  }
  const id = existingAsset?.id ?? crypto.randomUUID()
  const source = renderAssetCrop(
    sourceImage,
    draft.sourceRect,
    draft.removeBackground,
    {
      threshold: draft.backgroundThreshold,
      feather: draft.edgeFeather,
      backgroundColor: draft.backgroundColor,
    },
    draft.manualMaskStrokes,
  )
  const blob = await new Promise<Blob | null>(resolve =>
    source.toBlob(resolve, 'image/png'),
  )
  if (!blob) {
    setMessage('アセット画像を作成できませんでした。')
    return
  }
  if (existingAsset && existingAsset.name !== name) {
    editor.renameAssetToken(existingAsset.id, existingAsset.name, name)
    if (folderDocument.value) {
      projectStore.replaceProject(renameProjectAssetTokens(
        folderDocument.value,
        existingAsset.name,
        name,
        existingAsset.id,
      ))
    }
  }
  const updatedAsset = existingAsset
    ? updateRecroppedAsset(
        existingAsset,
        name,
        assetSourceImageId.value,
        draft.sourceRect,
      )
    : {
        id,
        name,
        sourceImageId: assetSourceImageId.value,
        sourceRect: draft.sourceRect,
        imagePath: `assets/${id}.png`,
        scale: 1,
        baselineOffset: 0,
        inlinePadding: 0,
      }
  projectStore.setAssets(existingAsset
    ? assets.value.map(asset => asset.id === id ? updatedAsset : asset)
    : [...assets.value, updatedAsset])
  projectRuntime.setAssetImage(id, source)
  projectRuntime.setPendingAssetWrite(id, blob)
  assetCreationDraft.value = null
  setMessage(
    existingAsset
      ? `アセット「${name}」を更新しました。`
      : `アセット「${name}」を登録しました。`,
  )
}

/** 共有定義・全カードのトークン・編集履歴を揃えて改名し、Undo後の参照切れを防ぐ。 */
function renameAsset(id: string, name: string) {
  const asset = assets.value.find(item => item.id === id)
  if (!asset || !name || asset.name === name)
    return
  const nameError = validateAssetName(name, assets.value, id)
  if (nameError) {
    setMessage(nameError)
    return
  }
  editor.renameAssetToken(asset.id, asset.name, name)
  if (folderDocument.value) {
    projectStore.replaceProject(renameProjectAssetTokens(
      folderDocument.value,
      asset.name,
      name,
      asset.id,
    ))
  }
  projectStore.setAssets(assets.value.map(item =>
    item.id === id ? { ...item, name } : item,
  ))
}

/** アセット定義と表示画像・保存待ちの画像を取り除く。 */
function removeAsset(id: string) {
  projectStore.setAssets(assets.value.filter(asset => asset.id !== id))
  projectRuntime.removeAssetImage(id)
  projectRuntime.removePendingAssetWrite(id)
}

/** 共有アセットの配置設定等を更新する。 */
function updateAsset(id: string, patch: Partial<ImageAsset>) {
  projectStore.setAssets(assets.value.map(asset =>
    asset.id === id ? { ...asset, ...patch, id } : asset,
  ))
}

/** 選択フォントを読み込み、表示用と保存用の情報を登録する。 */
async function loadFont(file: File, fontId: string | null) {
  try {
    const existing = fontId
      ? fonts.value.find(font => font.id === fontId)
      : fonts.value.find(font =>
          font.source === 'user' && font.fileName === file.name,
        )
    const loaded = await loadUserFont(file, existing)
    if (!existing)
      projectStore.setFonts([...fonts.value, loaded.reference])
    projectRuntime.setLoadedFont(loaded.reference.id, loaded.face)
    const cached = await saveFontToCache(loaded.reference, loaded.blob)
    setMessage(
      cached
        ? `フォント「${loaded.reference.displayName}」を読み込み、ブラウザへ保存しました。`
        : `フォント「${loaded.reference.displayName}」を読み込みました。次回は再選択が必要です。`,
    )
  }
  catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : 'フォントを読み込めませんでした。',
    )
  }
}

/** 選択したOSフォントを編集用に登録し、キャッシュへ保存する。 */
async function loadSystemFont(font: LocalFontData, fontId: string | null) {
  try {
    const existing = fontId
      ? fonts.value.find(reference => reference.id === fontId)
      : fonts.value.find(reference =>
          reference.source === 'system'
          && reference.postscriptName === font.postscriptName,
        )
    const loaded = await loadLocalFont(font, existing)
    if (!existing)
      projectStore.setFonts([...fonts.value, loaded.reference])
    projectRuntime.setLoadedFont(loaded.reference.id, loaded.face)
    const cached = await saveFontToCache(loaded.reference, loaded.blob)
    setMessage(
      cached
        ? `${loaded.reference.displayName} を読み込み、ブラウザへ保存しました。`
        : `${loaded.reference.displayName} を読み込みました。次回は再選択が必要です。`,
    )
  }
  catch (error) {
    logDiagnostic('PCフォントを読み込めませんでした', error, 'error')
    setMessage(
      error instanceof Error ? error.message : 'PCフォントを読み込めませんでした。',
    )
  }
}

/** 使用箇所を数えてフォント削除の確認を開く。 */
function requestFontDeletion(id: string) {
  const font = fonts.value.find(item => item.id === id)
  if (!font)
    return
  const documentValue = folderDocument.value
    ? folderDocument.value
    : null
  const usageCount = documentValue
    ? countProjectFontUsage(documentValue, id)
    : countCardFontUsage(editor.project.value, id)
  if (usageCount > 0) {
    fontPendingDeletionConfirmation.value = { font, usageCount }
    return
  }
  deleteFont(font)
}

/** フォント削除の確認を閉じる。 */
function cancelFontDeletion() {
  fontPendingDeletionConfirmation.value = null
}

/** 確認中のフォントの削除を実行する。 */
function confirmFontDeletion() {
  const pending = fontPendingDeletionConfirmation.value
  fontPendingDeletionConfirmation.value = null
  if (pending)
    deleteFont(pending.font)
}

/** カードの参照を標準フォントへ戻す。永続キャッシュの削除はプロジェクト保存後へ回す。 */
function deleteFont(font: FontReference) {
  const selectedRegionId = editor.selectedRegionId.value
  if (folderDocument.value) {
    const updated = removeProjectFont(
      folderDocument.value,
      font.id,
    )
    projectStore.replaceProject(updated)
    const activeCard = updated.cards.find(
      card => card.id === updated.activeCardId,
    )
    if (activeCard) {
      editor.loadSavedProject({
        imageName: activeCard.imageName,
        imageWidth: activeCard.imageWidth,
        imageHeight: activeCard.imageHeight,
        regions: activeCard.regions,
      }, activeCard.id)
    }
  }
  else {
    editor.loadSavedProject(
      removeCardFontReferences(editor.project.value, font.id),
    )
  }
  if (selectedRegionId && editor.project.value.regions.some(
    region => region.id === selectedRegionId,
  )) {
    editor.selectedRegionId.value = selectedRegionId
  }

  projectRuntime.removeLoadedFont(font.id)
  if (!folderDocument.value)
    projectStore.setFonts(fonts.value.filter(item => item.id !== font.id))

  pendingFontCacheDeletionIds.value = new Set(
    pendingFontCacheDeletionIds.value,
  ).add(font.id)
  const nextCachedIds = new Set(cachedFontIds.value)
  nextCachedIds.delete(font.id)
  cachedFontIds.value = nextCachedIds
  setMessage(`フォント「${font.displayName}」を削除しました。プロジェクト保存時に確定します。`)
}

/** 保存後に削除予定のフォントキャッシュを取り除く。 */
async function finalizeFontCacheDeletions() {
  const failed = new Set<string>()
  for (const id of pendingFontCacheDeletionIds.value) {
    try {
      await removeCachedFont(id)
    }
    catch (error) {
      failed.add(id)
      logDiagnostic(
        '削除したフォントのブラウザ保存を消去できませんでした',
        error,
        'error',
      )
    }
  }
  pendingFontCacheDeletionIds.value = failed
}

/** フォントの表示名を変更する。 */
function renameFont(id: string, displayName: string) {
  if (!displayName)
    return
  projectStore.setFonts(fonts.value.map(font =>
    font.id === id ? { ...font, displayName } : font,
  ))
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

/** CSVを現在のカード群へ照合し、未一致や原文差異を確認できる状態にしてから反映へ進む。 */
async function importCsv(file: File) {
  try {
    assertFileSize(file, FILE_LIMITS.textBytes, 'CSV')
    const csv = await file.text()
    assertCsvTextLimits(csv)
    const rows = parseTranslationCsv(csv)
    const documentValue = folderDocument.value
      ? folderDocument.value
      : null
    const cards = documentValue?.cards ?? projectCards.value
    const activeId = documentValue?.activeCardId ?? currentImageId.value
    const matched = matchProjectTranslationRows(
      cards,
      activeId,
      rows,
      pendingCardDeletionIds.value,
    )

    openTranslationReview(matched)
    logDiagnostic('翻訳CSVの照合が完了しました', {
      rows: rows.length,
      applied: matched.applied,
      issues: matched.issues.length,
    })
  }
  catch (error) {
    setMessage(
      error instanceof Error ? error.message : 'CSVを読み込めませんでした。',
    )
  }
}

/** カード別の照合結果をまとめて反映し、編集中カードでは履歴とストアを同期する。 */
function commitTranslations(matched: TranslationMatchResult) {
  const documentValue = folderDocument.value
    ? folderDocument.value
    : null
  const activeId = documentValue?.activeCardId ?? currentImageId.value

  if (documentValue) {
    projectStore.replaceProject({
      ...documentValue,
      cards: documentValue.cards.map((card) => {
        const translations = matched.translationsByCard.get(card.id)
        if (!translations || card.id === activeId)
          return card
        return {
          ...card,
          regions: card.regions.map((region) => {
            const translation = translations.get(region.regionId)
            return translation === undefined
              ? region
              : {
                  ...region,
                  translatedText: translation,
                  translationStatus: statusForTranslation(translation),
                  textStyles: reconcileTextStyles(
                    region.translatedText,
                    translation,
                    region.textStyles,
                  ),
                  inlineAssetStyles: reconcileInlineAssetStyles(
                    region.translatedText,
                    translation,
                    region.inlineAssetStyles,
                  ),
                }
          }),
        }
      }),
    })
  }
  const activeTranslations = matched.translationsByCard.get(activeId)
  if (activeTranslations)
    editor.applyTranslations(activeTranslations)
  logDiagnostic('翻訳候補をプロジェクトへ反映しました', { applied: matched.applied })
}

/** 削除予定を除いた全カードの原文・訳文をCSVとして書き出す。 */
function exportCsv() {
  const documentValue = folderDocument.value
    ? folderDocument.value
    : null
  const cards = (documentValue?.cards ?? projectCards.value).filter(
    card => !pendingCardDeletionIds.value.has(card.id),
  )
  const name = documentValue?.name || projectDirectory.value?.name || 'project'
  downloadText(
    serializeProjectTranslationCsv(cards),
    `${name}-translations.csv`,
    'text/csv;charset=utf-8',
  )
  logDiagnostic('プロジェクト翻訳CSVを書き出しました', {
    cards: cards.length,
    regions: cards.reduce((total, card) => total + card.regions.length, 0),
  })
}

/** 指定カードの原文・訳文をCSVとして書き出す。 */
function exportCardCsv(cardId: string) {
  const card = projectCards.value.find(item => item.id === cardId)
  if (!card || pendingCardDeletionIds.value.has(cardId))
    return
  const name = card.imageName.replace(/\.(?:png|jpe?g)$/iu, '') || 'card'
  downloadText(
    `\uFEFF${serializeTranslationCsv(card.regions)}`,
    `${name}-translations.csv`,
    'text/csv;charset=utf-8',
  )
  logDiagnostic('カード翻訳CSVを書き出しました', {
    cardId,
    regions: card.regions.length,
  })
}

/** 指定カードの編集画像をPNGまたはJPEGとして書き出す。 */
async function exportCardImage(
  cardId: string,
  format: 'png' | 'jpeg',
) {
  if (pendingCardDeletionIds.value.has(cardId))
    return
  if (currentImageId.value !== cardId) {
    await selectProjectCard(cardId)
    if (currentImageId.value !== cardId)
      return
    await nextTick()
  }
  const blob
    = format === 'png'
      ? await canvasApi.value?.exportPng()
      : await canvasApi.value?.exportJpeg()
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
  if (exportingCards.value || addingCards.value || loadingCardId.value)
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
      if (currentImageId.value !== card.id) {
        await selectProjectCard(card.id)
        if (currentImageId.value !== card.id)
          continue
        await nextTick()
      }
      const blob = format === 'png'
        ? await canvasApi.value?.exportPng()
        : await canvasApi.value?.exportJpeg()
      if (!blob)
        continue
      const base = editor.project.value.imageName.replace(/\.[^.]+$/u, '')
        || 'card'
      const sequence = String(index + 1).padStart(3, '0')
      downloadBlob(blob, `${sequence}-${base}-ja.${extension}`)
      exported += 1
    }
    setMessage(`${exported}枚のカードを${format.toUpperCase()}で書き出しました。`)
  }
  finally {
    if (currentImageId.value !== originalCardId)
      await selectProjectCard(originalCardId)
    exportingCards.value = false
  }
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
