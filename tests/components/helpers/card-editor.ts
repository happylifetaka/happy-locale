import type { FolderProjectDocument, TextRegion } from '~/types/editor'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CardEditor from '~/components/CardEditor.vue'
import RegionInspector from '~/components/RegionInspector.vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useTranslationSettings } from '~/composables/useTranslationSettings'
import { useUnsavedChanges } from '~/composables/useUnsavedChanges'
import { useProjectStore } from '~/stores/project'

// Nuxtの自動importだけを補い、編集履歴・ストア・runtimeは実装を使う。
// ルート遷移とWorkerはこの画面接続テストの対象外。
vi.mock('~/composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({
    leaveConfirmationOpen: ref(false),
    confirmLeave: vi.fn().mockResolvedValue(true),
    resolveLeave: vi.fn(),
  }),
}))
const ocrMocks = vi.hoisted(() => ({
  recognize: vi.fn<import('~/services/ocr/types').OCRProvider['recognize']>(),
  dispose: vi.fn<() => Promise<void>>(),
  prepareRegionForOCR: vi.fn<typeof import('~/services/ocr/image').prepareRegionForOCR>(),
}))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class {
    recognize = ocrMocks.recognize
    dispose = ocrMocks.dispose
  },
}))
vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: ocrMocks.prepareRegionForOCR }))
const folderIO = vi.hoisted(() => ({
  addFolderProjectCards: vi.fn<typeof import('~/services/project/folder').addFolderProjectCards>(),
  saveFolderProject: vi.fn<typeof import('~/services/project/folder').saveFolderProject>(),
  createFolderProject: vi.fn<typeof import('~/services/project/folder').createFolderProject>(),
  loadFolderProjectCardThumbnail: vi.fn<typeof import('~/services/project/folder').loadFolderProjectCardThumbnail>(),
  loadFolderProjectCardImage: vi.fn<typeof import('~/services/project/folder').loadFolderProjectCardImage>(),
  writeFolderProjectCardThumbnail: vi.fn<typeof import('~/services/project/folder').writeFolderProjectCardThumbnail>(),
  pickProjectDirectory: vi.fn<typeof import('~/services/project/folder').pickProjectDirectory>(),
  folderProjectExists: vi.fn<typeof import('~/services/project/folder').folderProjectExists>(),
  openFolderProject: vi.fn<typeof import('~/services/project/folder').openFolderProject>(),
}))
const thumbnailIO = vi.hoisted(() => ({
  createCardThumbnailBlobFromFile: vi.fn<typeof import('~/utils/card-thumbnail').createCardThumbnailBlobFromFile>(),
  createCardThumbnailBlob: vi.fn<typeof import('~/utils/card-thumbnail').createCardThumbnailBlob>(),
}))
vi.mock('~/services/project/folder', async importOriginal => ({
  ...await importOriginal<typeof import('~/services/project/folder')>(),
  ...folderIO,
}))
vi.mock('~/utils/card-thumbnail', async importOriginal => ({
  ...await importOriginal<typeof import('~/utils/card-thumbnail')>(),
  ...thumbnailIO,
}))
const canvasIO = vi.hoisted(() => ({
  exportPng: vi.fn<() => Promise<Blob | null>>(),
  exportJpeg: vi.fn<() => Promise<Blob | null>>(),
}))
const downloadIO = vi.hoisted(() => ({
  downloadBlob: vi.fn<typeof import('~/utils/download').downloadBlob>(),
  downloadText: vi.fn<typeof import('~/utils/download').downloadText>(),
}))
vi.mock('~/utils/download', async importOriginal => ({
  ...await importOriginal<typeof import('~/utils/download')>(),
  ...downloadIO,
}))

const childNames = [
  'EditorToolbar',
  'GlossaryDialog',
  'TranslationSettingsDialog',
  'TranslationReviewDialog',
  'TranslationReuseDialog',
  'TranslationPreviewDialog',
  'LayoutTemplateDialog',
  'RegionSplitDialog',
  'SourceIconsDialog',
  'TranslationRequestDialog',
  'CardList',
  'RegionList',
  'RegionCandidatePanel',
  'PrintAreaInspector',
  'FontLibrary',
  'AssetEditor',
  'PrintLayoutWorkspace',
  'DataPrivacyFooter',
  'UnsavedChangesDialog',
]

let wrapper: ReturnType<typeof shallowMount<typeof CardEditor>> | undefined
let runtime: ReturnType<typeof useProjectRuntime>

beforeEach(() => {
  vi.useFakeTimers()
  ocrMocks.dispose.mockResolvedValue(undefined)
  ocrMocks.prepareRegionForOCR.mockResolvedValue(new Blob(['processed']))
  localStorage.clear()
  for (const [name, value] of Object.entries({
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    watch,
    useCardEditor,
    useTranslationSettings,
    useUnsavedChanges,
    useProjectRuntime: () => {
      runtime = useProjectRuntime()
      return runtime
    },
    useRuntimeConfig: () => ({ app: { baseURL: '/' }, public: { translationEndpointEnabled: false } }),
  })) {
    vi.stubGlobal(name, value)
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  const unexpectedWarnings = vi.mocked(console.warn).mock.calls.filter(([message]) => !String(message).startsWith('[HappyLocale]'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  expect(unexpectedWarnings).toEqual([])
})

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

export function seedProject(ids = ['one', 'two', 'three']) {
  const project: FolderProjectDocument = {
    version: 2,
    name: 'cards',
    activeCardId: ids[0]!,
    cards: ids.map(id => ({
      id,
      imagePath: `images/${id}.png`,
      imageName: `${id}.png`,
      imageWidth: 100,
      imageHeight: 140,
      regions: [],
      printArea: null,
      sourceDpi: null,
    })),
    assets: [],
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
  }
  useProjectStore().replaceProject(project)
  return project
}

export async function mountEditor(pinia = createPinia(), realInspector = false) {
  wrapper = shallowMount(CardEditor, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      components: { RegionInspector },
      stubs: {
        ...Object.fromEntries(childNames.map(name => [name, true])),
        CardEditingWorkspace: false,
        CardRegionInspector: false,
        EditorConfirmDialog: false,
        EditorInspectorPanel: false,
        DiagnosticsDialog: false,
        EditorToolbar: { name: 'EditorToolbar', props: ['saveStatus'], template: '<div />' },
        AssetEditor: { name: 'AssetEditor', props: ['creationDraft', 'creationRunning'], template: '<div />' },
        CardCanvas: { name: 'CardCanvas', props: ['previewDeferred', 'project', 'previewMode', 'regionCandidates', 'selectedCandidateId', 'selectedExclusionId'], methods: { backgroundColorForBounds: () => '#ffffff', exportPng: canvasIO.exportPng, exportJpeg: canvasIO.exportJpeg }, template: '<div />' },
        CardList: { name: 'CardList', props: ['activeCardId', 'batchOcrStates', 'batchOcrRunning', 'batchOcrCompleted', 'batchOcrTotal', 'pendingDeletionIds'], template: '<div />' },
        AssetInsertPicker: true,
        RegionInspector: realInspector ? false : { name: 'RegionInspector', props: ['region', 'ocrCandidate', 'ocrConfidence', 'ocrCorrectionCandidate', 'ocrCorrectionChanges', 'ocrRunning', 'ocrProgress', 'ocrStatus', 'ocrLayout'], template: '<div />' },
        TranslationReuseDialog: { name: 'TranslationReuseDialog', props: ['region', 'candidates'], template: '<div />' },
        TranslationPreviewDialog: { name: 'TranslationPreviewDialog', props: ['originalText', 'currentTranslation', 'proposedTranslation'], template: '<div />' },
        TranslationRequestDialog: { name: 'TranslationRequestDialog', props: ['originalText', 'endpoint'], template: '<div />' },
        TranslationReviewDialog: { name: 'TranslationReviewDialog', props: ['cards', 'initialImport', 'error', 'appliedRows', 'loadImage'], template: '<div />' },
      },
    },
  })
  const canvas = wrapper.findComponent({ name: 'CardCanvas' })
  const inspector = wrapper.findComponent({ name: 'RegionInspector' })
  canvas.vm.$emit('add-region', { x: 1, y: 1, width: 50, height: 30 }, '#ffffff')
  await nextTick()
  return { wrapper, canvas, inspector }
}

/** テストで用意したブラウザ資源を、実際のruntimeへ設定する。 */
export function editorRuntime() {
  return runtime
}

export function unmountEditor() {
  wrapper?.unmount()
  wrapper = undefined
}

// テストは実サービスと同じ型を持つI/Oモックの完了タイミングを制御する。
export const { addFolderProjectCards, createFolderProject, saveFolderProject, folderProjectExists, loadFolderProjectCardImage, loadFolderProjectCardThumbnail, openFolderProject, pickProjectDirectory, writeFolderProjectCardThumbnail } = folderIO
export const { createCardThumbnailBlob, createCardThumbnailBlobFromFile } = thumbnailIO
export const canvasExports = canvasIO
export const { downloadBlob, downloadText } = downloadIO

export const ocrIO = ocrMocks

export async function mountSavedEditor(withRegions = true, pinia = createPinia(), realInspector = false) {
// 画像のload/decodeだけを代替し、プロジェクトを開く処理とストア同期は実装を通す。
  vi.stubGlobal('Image', class {
    naturalWidth = 100
    naturalHeight = 140
    onload: (() => void) | null = null
    source = ''
    get src() { return this.source }
    set src(value: string) {
      this.source = value
      queueMicrotask(() => this.onload?.())
    }

    decode = vi.fn().mockResolvedValue(undefined)
    removeAttribute = vi.fn()
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(createCardThumbnailBlob).mockResolvedValue(null)
  const context = await mountEditor(pinia, realInspector)
  const region: TextRegion = JSON.parse(JSON.stringify(context.inspector.props('region')))
  const project = seedProject(['one', 'two', 'three'])
  project.cards.forEach((card, index) => {
    card.regions = withRegions ? [{ ...region, id: `region-${index}`, originalText: `Source ${index}`, translatedText: `Before ${index}`, translationStatus: 'draft' }] : []
  })
  const directory = { name: 'cards' } as FileSystemDirectoryHandle
  vi.mocked(pickProjectDirectory).mockResolvedValue(directory)
  vi.mocked(folderProjectExists).mockResolvedValue(true)
  vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'two.png', { type: 'image/png' }))
  vi.mocked(openFolderProject).mockResolvedValue({
    directory,
    document: project,
    card: project.cards[0]!,
    imageFile: new File(['image'], 'one.png', { type: 'image/png' }),
    assetFiles: new Map(),
  })
  const toolbar = context.wrapper.findComponent({ name: 'EditorToolbar' })
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(context.canvas.props('project').regions).toHaveLength(withRegions ? 1 : 0)
  expect(context.wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  return { ...context, toolbar, project }
}
