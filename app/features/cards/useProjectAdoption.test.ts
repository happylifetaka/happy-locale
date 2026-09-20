import type { OpenedFolderProject } from '~/composables/useProjectSession'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectStore } from '~/stores/project'
import { baselineProject } from '../../../tests/fixtures/refactoring-baseline'
import { useProjectAdoption } from './useProjectAdoption'

beforeEach(() => setActivePinia(createPinia()))

function setup(demo = false) {
  const projectStore = useProjectStore()
  projectStore.replaceProject(baselineProject())
  const editor = useCardEditor((cardId, card) => projectStore.updateCard(cardId, card))
  editor.loadSavedProject(projectStore.document!.cards[0]!, 'synthetic-1')
  editor.addRegion({ x: 1, y: 2, width: 30, height: 40 }, '#ffffff')
  const options: Parameters<typeof useProjectAdoption>[0] = {
    editor,
    projectStore,
    projectRuntime: {
      setDirectory: vi.fn(),
      replaceAssetImages: vi.fn(),
      clearPendingAssetWrites: vi.fn(),
      replaceLoadedFonts: vi.fn(),
    },
    currentImageId: ref('synthetic-1'),
    currentView: ref('assets'),
    pendingCardDeletionIds: shallowRef(new Set(['old-card'])),
    cardPendingDeletionConfirmation: shallowRef(projectStore.document!.cards[0]!),
    cachedFontIds: shallowRef(new Set(['old-font'])),
    pendingFontCacheDeletionIds: shallowRef(new Set(['old-font'])),
    fontPendingDeletionConfirmation: ref({
      font: { id: 'old-font', displayName: 'Synthetic', familyName: 'Synthetic', fileName: 'synthetic.ttf', source: 'user' },
      usageCount: 1,
    }),
    lastSavedProjectSignature: ref('old-signature'),
    isDemo: ref(demo),
    isActive: vi.fn(() => true),
    projectSignature: vi.fn(() => 'new-signature'),
    resetBatchOCR: vi.fn(),
    resetCardThumbnails: vi.fn(),
    clearLoadedCardImage: vi.fn(),
    clearAssetSourceImage: vi.fn(),
    applyLoadedImage: vi.fn(),
    switchInspectorTab: vi.fn(),
    showBatchOCRCandidates: vi.fn(() => true),
  }
  return { options, editor, projectStore, adoption: useProjectAdoption(options) }
}

function expectTransientStateReset(options: Parameters<typeof useProjectAdoption>[0]) {
  expect(options.pendingCardDeletionIds.value.size).toBe(0)
  expect(options.cardPendingDeletionConfirmation.value).toBeNull()
  expect(options.cachedFontIds.value.size).toBe(0)
  expect(options.pendingFontCacheDeletionIds.value.size).toBe(0)
  expect(options.fontPendingDeletionConfirmation.value).toBeNull()
  expect(options.resetCardThumbnails).toHaveBeenCalledOnce()
  expect(options.resetBatchOCR).toHaveBeenCalledOnce()
  expect(options.clearAssetSourceImage).toHaveBeenCalledOnce()
  expect(options.projectRuntime.clearPendingAssetWrites).toHaveBeenCalledOnce()
  expect(options.projectRuntime.replaceLoadedFonts).toHaveBeenCalledWith(new Map())
}

it('starts an empty folder with a new draft identity, resetting history and transient resources', async () => {
  const { options, editor, projectStore, adoption } = setup()
  const directory = { name: 'empty' } as FileSystemDirectoryHandle
  adoption.startNewFolderProject(directory)
  expect(projectStore.document).toBeNull()
  expect(editor.project.value).toEqual({ imageName: '', imageWidth: 0, imageHeight: 0, regions: [] })
  expect(editor.canUndo.value).toBe(false)
  expect(options.currentImageId.value).not.toBe('synthetic-1')
  expect(options.currentView.value).toBe('card')
  expect(options.clearLoadedCardImage).toHaveBeenCalledOnce()
  expect(options.projectRuntime.setDirectory).toHaveBeenCalledWith(directory)
  expect(options.projectRuntime.replaceAssetImages).toHaveBeenCalledWith(new Map())
  expectTransientStateReset(options)
  expect(options.lastSavedProjectSignature.value).toBe('old-signature')
  await nextTick()
  expect(options.lastSavedProjectSignature.value).toBe('new-signature')
})

it('adopts a fully prepared project before publishing the loaded card and defers the saved signature', async () => {
  const { options, editor, projectStore, adoption } = setup()
  const document = baselineProject()
  document.activeCardId = 'replacement'
  document.cards[0]!.id = 'replacement'
  const opened: OpenedFolderProject = {
    directory: { name: 'saved' } as FileSystemDirectoryHandle,
    document,
    card: document.cards[0]!,
    imageFile: new File([], 'new.png'),
    assetFiles: new Map(),
  }
  const loaded = {
    element: { naturalWidth: 220, naturalHeight: 260 } as HTMLImageElement,
    file: opened.imageFile,
    url: 'blob:new-card',
  }
  const images = new Map<string, ImageBitmap>()
  adoption.adoptOpenedProject(opened, loaded, images)
  expect(projectStore.document?.activeCardId).toBe('replacement')
  expect(projectStore.document?.cards[0]).toMatchObject({ imageWidth: 220, imageHeight: 260, regions: [] })
  expect(options.currentImageId.value).toBe('replacement')
  expect(editor.canUndo.value).toBe(false)
  expect(options.clearLoadedCardImage).not.toHaveBeenCalled()
  expect(options.applyLoadedImage).toHaveBeenCalledWith(loaded)
  expect(options.projectRuntime.replaceAssetImages).toHaveBeenCalledWith(images)
  expectTransientStateReset(options)
  expect(options.lastSavedProjectSignature.value).toBe('old-signature')
  expect(options.showBatchOCRCandidates).not.toHaveBeenCalled()
  await adoption.finishOpeningProject()
  expect(options.currentView.value).toBe('card')
  expect(options.showBatchOCRCandidates).toHaveBeenCalledWith('replacement')
  expect(options.switchInspectorTab).not.toHaveBeenCalled()
  expect(options.lastSavedProjectSignature.value).toBe('new-signature')
  editor.addRegion({ x: 1, y: 2, width: 10, height: 10 }, '#000000')
  expect(projectStore.document?.cards[0]?.regions).toHaveLength(1)
})

it('opens demo OCR review but does not acknowledge the signature after disposal', async () => {
  const { options, adoption } = setup(true)
  const finishing = adoption.finishOpeningProject()
  vi.mocked(options.isActive).mockReturnValue(false)
  await finishing
  expect(options.switchInspectorTab).toHaveBeenCalledWith('ocr')
  expect(options.showBatchOCRCandidates).toHaveBeenCalledWith('synthetic-1')
  expect(options.projectSignature).not.toHaveBeenCalled()
  expect(options.lastSavedProjectSignature.value).toBe('old-signature')
})
