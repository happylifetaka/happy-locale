// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useProjectStore } from '~/stores/project'
import { readImageDpi } from '~/utils/image-dpi'
import { baselineProject } from '../../../tests/fixtures/refactoring-baseline'
import { useEditorImageAdoption } from './useEditorImageAdoption'

vi.mock('~/utils/image-dpi', () => ({ readImageDpi: vi.fn() }))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function setup() {
  const projectStore = useProjectStore()
  const projectRuntime = useProjectRuntime()
  const editor = useCardEditor((cardId, project) => projectStore.updateCard(cardId, project))
  const element = document.createElement('img')
  Object.defineProperties(element, { naturalWidth: { value: 200 }, naturalHeight: { value: 240 } })
  const loaded = { element, file: new File([], 'first.png'), url: 'blob:first' }
  const options: Parameters<typeof useEditorImageAdoption>[0] = {
    editor,
    projectStore,
    projectRuntime,
    currentImageId: ref('draft'),
    assetSourceImageId: ref('asset-source'),
    assetEditing: ref(true),
    assetCreationDraft: ref(null),
    assetRecropId: ref('old-asset'),
    addingCards: ref(false),
    loadingCardId: ref(null),
    clearRegionCandidates: vi.fn(),
    loadImage: vi.fn().mockResolvedValue(loaded),
    cacheCardThumbnail: vi.fn().mockResolvedValue(new Blob(['thumbnail'])),
    updateCardPrintDpi: vi.fn(),
    setMessage: vi.fn(),
    logDiagnostic: vi.fn(),
  }
  return { options, loaded, projectStore, projectRuntime, editor, images: useEditorImageAdoption(options) }
}

it('keeps first-image loading separate from missing folders, existing projects and busy card operations', async () => {
  const { options, loaded, projectStore, projectRuntime, images } = setup()
  await images.openCardImage(loaded.file)
  expect(options.setMessage).toHaveBeenLastCalledWith('先にプロジェクトフォルダを選択してください。')
  projectRuntime.setDirectory({ name: 'folder' } as FileSystemDirectoryHandle)
  projectStore.replaceProject(baselineProject())
  await images.openCardImage(loaded.file)
  expect(options.setMessage).toHaveBeenLastCalledWith('既存プロジェクトへの追加はカード一覧の＋を使用してください。')
  const busyImages = useEditorImageAdoption({ ...options, addingCards: ref(true) })
  await busyImages.openCardImage(loaded.file)
  expect(options.setMessage).toHaveBeenLastCalledWith('カードの処理が完了してから画像を開いてください。')
  expect(options.loadImage).not.toHaveBeenCalled()
})

it('adopts the draft first image and stages its thumbnail using the same draft identity', async () => {
  const { options, loaded, projectStore, projectRuntime, editor, images } = setup()
  projectRuntime.setDirectory({ name: 'folder' } as FileSystemDirectoryHandle)
  editor.loadImageProject('previous.png', 100, 100)
  editor.addRegion({ x: 1, y: 2, width: 10, height: 10 }, '#ffffff')
  await images.openCardImage(loaded.file)
  expect(editor.project.value).toEqual({ imageName: 'first.png', imageWidth: 200, imageHeight: 240, regions: [] })
  expect(editor.canUndo.value).toBe(false)
  expect(projectStore.document).toBeNull()
  expect(projectRuntime.cardImage.value).toBe(loaded.element)
  expect(projectRuntime.cardSourceFile.value).toBe(loaded.file)
  expect(options.clearRegionCandidates).toHaveBeenCalledOnce()
  expect(options.cacheCardThumbnail).toHaveBeenCalledWith('draft', loaded.element)
  expect(projectRuntime.pendingCardThumbnailBlobs.value.has('draft')).toBe(true)
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(loaded.url)
  images.clearLoadedCardImage()
  expect(projectRuntime.cardImage.value).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(loaded.url)
})

it('keeps current images untouched when the loader returns no decoded image', async () => {
  const { options, loaded, projectRuntime, images } = setup()
  projectRuntime.setDirectory({ name: 'folder' } as FileSystemDirectoryHandle)
  projectRuntime.replaceCardImage(loaded)
  vi.mocked(options.loadImage).mockResolvedValue(null)
  await images.openCardImage(loaded.file)
  await images.openAssetSourceImage(loaded.file)
  expect(projectRuntime.cardImage.value).toBe(loaded.element)
  expect(projectRuntime.assetSourceImage.value).toBeNull()
  expect(options.clearRegionCandidates).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
})

it('adopts and clears an independent asset source without resetting the card', async () => {
  const { options, loaded, projectRuntime, images } = setup()
  await images.openAssetSourceImage(loaded.file)
  expect(projectRuntime.assetSourceImage.value).toBe(loaded.element)
  expect(projectRuntime.cardImage.value).toBeNull()
  expect(options.assetSourceImageId.value).not.toBe('asset-source')
  expect(options.assetEditing.value).toBe(false)
  expect(options.assetRecropId.value).toBeNull()
  expect(options.assetCreationDraft.value).toBeNull()
  const adoptedId = options.assetSourceImageId.value
  images.clearAssetSourceImage()
  expect(options.assetSourceImageId.value).not.toBe(adoptedId)
  expect(projectRuntime.assetSourceImage.value).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(loaded.url)
  expect(options.clearRegionCandidates).not.toHaveBeenCalled()
})

it('reads DPI only for an existing card whose DPI is not already set', async () => {
  const { options, loaded, projectStore, images } = setup()
  projectStore.replaceProject(baselineProject())
  await images.detectAndApplyCardDpi('missing', loaded.file)
  await images.detectAndApplyCardDpi('synthetic-1', loaded.file)
  expect(readImageDpi).not.toHaveBeenCalled()
  projectStore.document!.cards[0]!.sourceDpi = null
  vi.mocked(readImageDpi).mockResolvedValueOnce({ x: 144, y: 144 })
  await images.detectAndApplyCardDpi('synthetic-1', loaded.file)
  expect(options.updateCardPrintDpi).toHaveBeenCalledWith('synthetic-1', { x: 144, y: 144 })
})
