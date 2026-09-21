import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { RuntimeLoadedImage, useProjectRuntime } from '~/composables/useProjectRuntime'
import type { OpenedFolderProject } from '~/composables/useProjectSession'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectCard, FontReference } from '~/types/editor'
import type { EditorView } from '~/types/editor-view'
import { nextTick } from 'vue'

interface ProjectAdoptionOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'loadImageProject' | 'loadSavedProject'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'clearProject' | 'replaceProject'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'setDirectory' | 'replaceAssetImages' | 'replaceAssetFiles' | 'clearPendingAssetWrites' | 'replaceLoadedFonts'>
  currentImageId: Ref<string>
  currentView: Ref<EditorView>
  pendingCardDeletionIds: Ref<Set<string>>
  cardPendingDeletionConfirmation: Ref<FolderProjectCard | null>
  cachedFontIds: Ref<Set<string>>
  pendingFontCacheDeletionIds: Ref<Set<string>>
  fontPendingDeletionConfirmation: Ref<{ font: FontReference, usageCount: number } | null>
  lastSavedProjectSignature: Ref<string | null>
  isDemo: Readonly<Ref<boolean>>
  isActive: () => boolean
  projectSignature: () => string | null
  resetBatchOCR: () => void
  resetCardThumbnails: () => void
  clearLoadedCardImage: () => void
  clearAssetSourceImage: () => void
  applyLoadedImage: (loaded: RuntimeLoadedImage) => void
  switchInspectorTab: (tab: 'ocr') => void
  showBatchOCRCandidates: (cardId: string) => boolean
}

/** sessionで準備を終えた資源だけを採用する。I/Oや未採用資源の解放はsessionに残す。 */
export function useProjectAdoption({
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
  isActive,
  projectSignature,
  resetBatchOCR,
  resetCardThumbnails,
  clearLoadedCardImage,
  clearAssetSourceImage,
  applyLoadedImage,
  switchInspectorTab,
  showBatchOCRCandidates,
}: ProjectAdoptionOptions) {
  let adoptionGeneration = 0

  /** project.jsonのないフォルダでは空の下書きから開始し、旧文書と履歴を残さない。 */
  function startNewFolderProject(directory: FileSystemDirectoryHandle) {
    const generation = ++adoptionGeneration
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
      if (!isActive() || generation !== adoptionGeneration)
        return
      lastSavedProjectSignature.value = projectSignature()
    })
  }

  /** 新規フォルダと順序を混同せず、復元したカードIDと実画像寸法で履歴を初期化する。 */
  function adoptOpenedProject(opened: OpenedFolderProject, loaded: RuntimeLoadedImage, images: Map<string, ImageBitmap>) {
    adoptionGeneration++
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
    projectRuntime.replaceAssetImages(images)
    projectRuntime.replaceAssetFiles(opened.assetFiles)
    applyLoadedImage(loaded)
    projectRuntime.clearPendingAssetWrites()
    projectRuntime.replaceLoadedFonts(new Map())
    cachedFontIds.value = new Set()
    pendingFontCacheDeletionIds.value = new Set()
    fontPendingDeletionConfirmation.value = null
  }

  /** フォント・DPI等の後処理が終わってから候補と未保存判定を同期する。 */
  async function finishOpeningProject() {
    const generation = adoptionGeneration
    const cardId = currentImageId.value
    currentView.value = 'card'
    if (isDemo.value)
      switchInspectorTab('ocr')
    showBatchOCRCandidates(cardId)
    await nextTick()
    if (!isActive() || generation !== adoptionGeneration || currentImageId.value !== cardId)
      return
    lastSavedProjectSignature.value = projectSignature()
  }

  return { startNewFolderProject, adoptOpenedProject, finishOpeningProject }
}
