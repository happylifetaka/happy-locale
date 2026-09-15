import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { FolderProjectCard } from '~/types/editor'
import { nextTick, onBeforeUnmount } from 'vue'
import { downloadBlob } from '~/utils/download'

interface CardImageExportOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project'>
  canvasApi: Ref<{ exportPng: () => Promise<Blob | null>, exportJpeg: () => Promise<Blob | null> } | null>
  currentImageId: Ref<string>
  projectCards: Ref<FolderProjectCard[]>
  pendingCardDeletionIds: Ref<Set<string>>
  exportingCards: Ref<boolean>
  addingCards: Ref<boolean>
  loadingCardId: Ref<string | null>
  selectProjectCard: (cardId: string) => Promise<void>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** カードの描画結果を順次書き出し、元の編集カードへ戻す。 */
export function useCardImageExport({
  editor,
  canvasApi,
  currentImageId,
  projectCards,
  pendingCardDeletionIds,
  exportingCards,
  addingCards,
  loadingCardId,
  selectProjectCard,
  setMessage,
  logDiagnostic,
}: CardImageExportOptions) {
  let exportDisposed = false
  onBeforeUnmount(() => {
    exportDisposed = true
  })

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

  return { exportCardImage, exportAllCardImages }
}
