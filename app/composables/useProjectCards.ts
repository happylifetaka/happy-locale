import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useCardThumbnails } from '~/composables/useCardThumbnails'
import type { RuntimeLoadedImage, useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectCard } from '~/types/editor'
import { shallowRef } from 'vue'
import { moveProjectCard, renameProjectCard } from '~/services/project/cards'
import { addFolderProjectCards, listImageFiles, pickImageDirectory } from '~/services/project/folder'
import { createCardThumbnailBlob } from '~/utils/card-thumbnail'

interface ProjectCardsOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'renameImage'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'replaceProject' | 'acceptSavedProject'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'directory' | 'pendingAssetWrites' | 'acknowledgeAssetWrites'>
  currentImageId: Ref<string>
  loadingCardId: Ref<string | null>
  addingCards: Ref<boolean>
  projectBusy: Ref<boolean>
  ocrRunning: Ref<boolean>
  isDemo: Ref<boolean>
  pendingCardDeletionIds: Ref<Set<string>>
  isActive: () => boolean
  loadImage: (file: File) => Promise<RuntimeLoadedImage | null>
  selectProjectCard: (cardId: string) => Promise<void>
  setCardThumbnail: ReturnType<typeof useCardThumbnails>['setCardThumbnail']
  persistCardThumbnail: ReturnType<typeof useCardThumbnails>['persistCardThumbnail']
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** カード一覧の操作と追加保存、保存前に取り消せる削除予定を管理する。 */
export function useProjectCards({
  editor,
  projectStore,
  projectRuntime,
  currentImageId,
  loadingCardId,
  addingCards,
  projectBusy,
  ocrRunning,
  isDemo,
  pendingCardDeletionIds,
  isActive,
  loadImage,
  selectProjectCard,
  setCardThumbnail,
  persistCardThumbnail,
  setMessage,
  logDiagnostic,
}: ProjectCardsOptions) {
  const { directory: projectDirectory, pendingAssetWrites } = projectRuntime
  /** 削除確認を待っているカード。 */
  const cardPendingDeletionConfirmation = shallowRef<FolderProjectCard | null>(
    null,
  )
  /** カード名と編集中の画像名を更新する。 */
  function renameCard(cardId: string, imageName: string) {
    const name = imageName.trim()
    if (!name)
      return
    if (projectStore.document) {
      projectStore.replaceProject(renameProjectCard(
        projectStore.document,
        cardId,
        name,
      ))
    }
    if (currentImageId.value === cardId || projectStore.document?.activeCardId === cardId)
      editor.renameImage(name)
    setMessage(`カード名を「${name}」へ変更しました。`)
  }

  /** カード一覧の順序を一つ前または後へ移す。 */
  function moveCard(cardId: string, direction: -1 | 1) {
    if (!projectStore.document || pendingCardDeletionIds.value.size > 0)
      return
    projectStore.replaceProject(moveProjectCard(
      projectStore.document,
      cardId,
      direction,
    ))
  }

  /** 削除対象のカードを確認ダイアログへ渡す。 */
  function requestProjectCardDeletion(cardId: string) {
    const documentValue = projectStore.document
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
    const card = documentValue.cards.find(item => item.id === cardId)
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

    const documentValue = projectStore.document
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
      if (projectStore.document?.activeCardId !== nextCard.id)
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
    const card = projectStore.document?.cards.find(item => item.id === cardId)
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
    if (!isActive() || projectBusy.value)
      return
    const directory = projectDirectory.value
    const documentValue = projectStore.document
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
        if (!isActive())
          return
        const loaded = await loadImage(file)
        if (!loaded)
          continue
        try {
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
          if (!isActive())
            return
          if (thumbnail)
            thumbnails.set(id, thumbnail)
        }
        finally {
          URL.revokeObjectURL(loaded.url)
          loaded.element.removeAttribute('src')
        }
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
      if (!isActive())
        return
      const previousIds = new Set(documentValue.cards.map(card => card.id))
      projectStore.replaceProject({
        ...projectStore.document!,
        cards: [
          ...projectStore.document!.cards,
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
      if (!isActive())
        return
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
      if (error instanceof DOMException && error.name === 'AbortError')
        return
      logDiagnostic('フォルダからカード画像を追加できませんでした', error, 'error')
      setMessage(
        error instanceof Error
          ? error.message
          : 'フォルダからカード画像を追加できませんでした。',
      )
    }
  }

  return {
    cardPendingDeletionConfirmation,
    renameCard,
    moveCard,
    requestProjectCardDeletion,
    cancelProjectCardDeletion,
    confirmProjectCardDeletion,
    cancelProjectCardDeletionRequest,
    addProjectCards,
    addProjectCardsFromFolder,
  }
}
