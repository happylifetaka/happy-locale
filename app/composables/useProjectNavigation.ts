import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useCardThumbnails } from '~/composables/useCardThumbnails'
import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import { activateProjectCard } from '~/services/project/cards'
import { loadFolderProjectCardImage } from '~/services/project/folder'

interface ProjectNavigationOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegionId' | 'switchSavedProject'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'activeCard' | 'replaceProject'>
  projectDirectory: Ref<FileSystemDirectoryHandle | null>
  projectBusy: Ref<boolean>
  translationRunning: Ref<boolean>
  ocrRunning: Ref<boolean>
  currentImageId: Ref<string>
  loadingCardId: Ref<string | null>
  pendingCardDeletionIds: Ref<Set<string>>
  currentView: Ref<'card' | 'assets' | 'print'>
  clearOCRCandidate: () => void
  resetCardSelection: () => void
  isActive: () => boolean
  loadImage: (file: File) => Promise<RuntimeLoadedImage | null>
  applyLoadedImage: (loaded: RuntimeLoadedImage) => void
  detectAndApplyCardDpi: (cardId: string, file: File) => Promise<void>
  cacheCardThumbnail: ReturnType<typeof useCardThumbnails>['cacheCardThumbnail']
  persistCardThumbnail: ReturnType<typeof useCardThumbnails>['persistCardThumbnail']
  showBatchOCRCandidates: (cardId: string) => boolean
  switchInspectorTab: (tab: 'text') => void
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 画像を取得してから編集カードを切り替え、カードごとの履歴と候補を復元する。 */
export function useProjectNavigation({
  editor,
  projectStore,
  projectDirectory,
  projectBusy,
  translationRunning,
  ocrRunning,
  currentImageId,
  loadingCardId,
  pendingCardDeletionIds,
  currentView,
  resetCardSelection,
  clearOCRCandidate,
  isActive,
  loadImage,
  applyLoadedImage,
  detectAndApplyCardDpi,
  cacheCardThumbnail,
  persistCardThumbnail,
  showBatchOCRCandidates,
  switchInspectorTab,
  setMessage,
  logDiagnostic,
}: ProjectNavigationOptions) {
  /** 対象画像を読めてからカードと履歴を切り替え、そのカードの一括OCR候補も復元する。 */
  async function selectProjectCard(cardId: string) {
    if (!isActive() || projectBusy.value)
      return
    const directory = projectDirectory.value
    const documentValue = projectStore.document
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
        setMessage(`${projectStore.activeCard.imageName} のOCR候補を確認してください。`)
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
      if (!isActive())
        return
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
          ...projectStore.document!,
          cards: projectStore.document!.cards.map(card =>
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
      resetCardSelection()
      clearOCRCandidate()
      applyLoadedImage(loaded)
      await detectAndApplyCardDpi(cardId, file)
      if (!isActive())
        return
      const hasBatchCandidates = showBatchOCRCandidates(cardId)
      const thumbnail = await cacheCardThumbnail(cardId, loaded.element)
      if (!isActive())
        return
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
      if (!isActive())
        return
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
    if (!isActive() || currentImageId.value !== cardId)
      return
    const region = editor.project.value.regions.find(item => item.id === regionId)
    if (!region)
      return
    editor.selectedRegionId.value = region.id
    switchInspectorTab('text')
    currentView.value = 'card'
  }

  return { selectProjectCard, selectProjectRegion }
}
