// @vitest-environment happy-dom
import type { FolderProjectDocument } from '~/types/editor'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CardEditor from '~/components/CardEditor.vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useTranslationSettings } from '~/composables/useTranslationSettings'
import { useUnsavedChanges } from '~/composables/useUnsavedChanges'
import { folderProjectExists, loadFolderProjectCardImage, loadFolderProjectCardThumbnail, pickProjectDirectory, writeFolderProjectCardThumbnail } from '~/services/project/folder'
import { useProjectStore } from '~/stores/project'
import { createCardThumbnailBlobFromFile } from '~/utils/card-thumbnail'

// Nuxtの自動importだけを補い、編集履歴・ストア・runtimeは実装を使う。
// ルート遷移とWorkerはこの画面接続テストの対象外。
vi.mock('~/composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({
    leaveConfirmationOpen: ref(false),
    confirmLeave: vi.fn().mockResolvedValue(true),
    resolveLeave: vi.fn(),
  }),
}))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class {
    dispose = vi.fn().mockResolvedValue(undefined)
  },
}))
vi.mock('~/services/project/folder', async importOriginal => ({
  ...await importOriginal<typeof import('~/services/project/folder')>(),
  loadFolderProjectCardThumbnail: vi.fn(),
  loadFolderProjectCardImage: vi.fn(),
  writeFolderProjectCardThumbnail: vi.fn(),
  pickProjectDirectory: vi.fn(),
  folderProjectExists: vi.fn(),
}))
vi.mock('~/utils/card-thumbnail', async importOriginal => ({
  ...await importOriginal<typeof import('~/utils/card-thumbnail')>(),
  createCardThumbnailBlobFromFile: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function seedProject(ids = ['one', 'two', 'three']) {
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

describe('card editor thumbnails', () => {
  const directory = { name: 'cards' } as FileSystemDirectoryHandle
  const cached = new File(['cached'], 'cached.png')
  const generated = new File(['generated'], 'generated.png')
  const bitmap = { width: 100, height: 140, close: vi.fn() }

  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${crypto.randomUUID()}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.mocked(loadFolderProjectCardThumbnail).mockResolvedValue(cached)
    vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'card.png'))
    vi.mocked(createCardThumbnailBlobFromFile).mockResolvedValue(generated)
    vi.mocked(writeFolderProjectCardThumbnail).mockResolvedValue(true)
  })

  async function setupThumbnails() {
    const { wrapper } = await mountEditor()
    runtime.setDirectory(directory)
    seedProject()
    await nextTick()
    const list = wrapper.findComponent({ name: 'CardList' })
    return { wrapper, request: (id: string) => list.vm.$emit('request-thumbnail', id) }
  }

  it('limits concurrent reads to two and deduplicates queued and cached requests', async () => {
    const { request } = await setupThumbnails()
    const first = deferred<File | null>()
    const second = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    for (const id of ['one', 'one', 'two', 'three', 'three', 'missing'])
      request(id)
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(2)
    expect(runtime.cardThumbnails.value.size).toBe(0)
    first.resolve(cached)
    await flushPromises()
    expect(vi.mocked(loadFolderProjectCardThumbnail).mock.calls.map(([, id]) => id)).toEqual(['one', 'two', 'three'])
    second.resolve(cached)
    await flushPromises()
    expect([...runtime.cardThumbnails.value.keys()].sort()).toEqual(['one', 'three', 'two'])
    request('one')
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(3)
    expect(loadFolderProjectCardImage).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledTimes(3)
  })

  it.each(['missing', 'decode error', 'oversized', 'empty'] as const)('regenerates a %s cache and publishes and persists the result', async (kind) => {
    const { request } = await setupThumbnails()
    const close = vi.fn()
    if (kind === 'missing')
      vi.mocked(loadFolderProjectCardThumbnail).mockResolvedValueOnce(null)
    else if (kind === 'decode error')
      vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('broken cache'))
    else
      vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: kind === 'empty' ? 0 : 145, height: 140, close } as unknown as ImageBitmap)
    request('one')
    await flushPromises()
    expect(loadFolderProjectCardImage).toHaveBeenCalledWith(directory, expect.objectContaining({ id: 'one' }))
    expect(createCardThumbnailBlobFromFile).toHaveBeenCalledWith(expect.any(File), 100, 140)
    expect(writeFolderProjectCardThumbnail).toHaveBeenCalledWith(directory, 'one', generated)
    expect(URL.createObjectURL).toHaveBeenCalledWith(generated)
    expect(runtime.cardThumbnails.value.has('one')).toBe(true)
    if (kind === 'oversized' || kind === 'empty')
      expect(close).toHaveBeenCalledOnce()
  })

  it('continues the queue after a read fails and lets that card be retried', async () => {
    const { request } = await setupThumbnails()
    const failed = deferred<File | null>()
    const busy = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(failed.promise).mockReturnValueOnce(busy.promise)
    request('one')
    request('two')
    request('three')
    failed.reject(new Error('read failed'))
    await flushPromises()
    expect(runtime.cardThumbnails.value.has('one')).toBe(false)
    expect(runtime.cardThumbnails.value.has('three')).toBe(true)
    request('one')
    busy.resolve(cached)
    await flushPromises()
    expect(runtime.cardThumbnails.value.size).toBe(3)
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(4)
  })

  it.each(['directory', 'card removed', 'unmount'] as const)('discards late results after %s', async (change) => {
    const { request, wrapper: mounted } = await setupThumbnails()
    const result = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(result.promise)
    request('one')
    if (change === 'directory') {
      runtime.setDirectory({ name: 'other' } as FileSystemDirectoryHandle)
    }
    else if (change === 'card removed') {
      seedProject(['two'])
    }
    else {
      mounted.unmount()
      wrapper = undefined
    }
    result.resolve(cached)
    await flushPromises()
    expect(runtime.cardThumbnails.value.size).toBe(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(writeFolderProjectCardThumbnail).not.toHaveBeenCalled()
  })

  it('resets queued requests and ignores old generations even when reopening the same directory', async () => {
    const { request, wrapper } = await setupThumbnails()
    const first = deferred<File | null>()
    const second = deferred<File | null>()
    const current = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(current.promise)
    request('one')
    request('two')
    request('three')
    vi.mocked(pickProjectDirectory).mockResolvedValue(directory)
    vi.mocked(folderProjectExists).mockResolvedValue(false)
    wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('open-project')
    await flushPromises()
    seedProject()
    await nextTick()
    const newList = wrapper.findComponent({ name: 'CardList' })
    newList.vm.$emit('request-thumbnail', 'one')
    first.resolve(cached)
    await flushPromises()
    expect(runtime.cardThumbnails.value.size).toBe(0)
    expect(vi.mocked(loadFolderProjectCardThumbnail).mock.calls.map(([, id]) => id)).toEqual(['one', 'two', 'one'])
    newList.vm.$emit('request-thumbnail', 'one')
    second.resolve(cached)
    await flushPromises()
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(3)
    current.resolve(generated)
    await flushPromises()
    expect([...runtime.cardThumbnails.value.keys()]).toEqual(['one'])
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(generated)
  })
})

async function mountEditor() {
  wrapper = shallowMount(CardEditor, {
    global: {
      plugins: [createPinia()],
      stubs: {
        ...Object.fromEntries(childNames.map(name => [name, true])),
        CardCanvas: { name: 'CardCanvas', props: ['previewDeferred', 'project'], template: '<div />' },
        RegionInspector: { name: 'RegionInspector', props: ['region'], template: '<div />' },
      },
    },
  })
  const canvas = wrapper.findComponent({ name: 'CardCanvas' })
  const inspector = wrapper.findComponent({ name: 'RegionInspector' })
  canvas.vm.$emit('add-region', { x: 1, y: 1, width: 50, height: 30 }, '#ffffff')
  await nextTick()
  return { wrapper, canvas, inspector }
}

describe('card editor preview deferral', () => {
  it('keeps edits live during IME composition and redraws 500ms after input ends', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', true)
    inspector.vm.$emit('update', inspector.props('region').id, { translatedText: '編集中' })
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    expect(canvas.props('project').regions[0].translatedText).toBe('編集中')
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)

    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(499)
    expect(canvas.props('previewDeferred')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(canvas.props('previewDeferred')).toBe(false)
  })

  it('restarts the delay on new input and cancels it when composition resumes', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('defer-preview', true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('flush-preview')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['region', 'view', 'tab', 'image'] as const)('flushes a pending preview when %s changes', async (change) => {
    const { wrapper, canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    if (change === 'region')
      canvas.vm.$emit('select-region', null)
    else if (change === 'view')
      wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('view', 'assets')
    else if (change === 'tab')
      await wrapper.get('#inspector-tab-text').trigger('click')
    else
      runtime.cardImage.value = document.createElement('img')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its pending timer when the editor is unmounted', async () => {
    const { inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    expect(vi.getTimerCount()).toBe(1)
    wrapper!.unmount()
    wrapper = undefined
    expect(vi.getTimerCount()).toBe(0)
  })
})
