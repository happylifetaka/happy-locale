import type { Ref } from 'vue'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { FolderProjectDocument } from '~/types/editor'
import { onBeforeUnmount } from 'vue'
import {
  loadFolderProjectCardImage,
  loadFolderProjectCardThumbnail,
  writeFolderProjectCardThumbnail,
} from '~/services/project/folder'
import {
  createCardThumbnailBlob,
  createCardThumbnailBlobFromFile,
} from '~/utils/card-thumbnail'

interface CardThumbnailOptions {
  directory: Ref<FileSystemDirectoryHandle | null>
  document: Ref<FolderProjectDocument | null>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'cardThumbnails' | 'setCardThumbnail' | 'resetCardThumbnails' | 'removeCardThumbnail'>
  logDiagnostic: (message: string, details?: unknown) => void
}

/** 一覧用サムネイルのキューとキャッシュI/Oを管理し、画像資源の所有はruntimeへ委ねる。 */
export function useCardThumbnails({
  directory: projectDirectory,
  document: folderDocument,
  runtime: projectRuntime,
  logDiagnostic,
}: CardThumbnailOptions) {
  const { cardThumbnails } = projectRuntime
  /** 重複してサムネイルを要求しないための待機中カードID。 */
  const thumbnailPendingIds = new Set<string>()
  /** サムネイルを取得するカードIDと要求世代の待機列。 */
  const thumbnailQueue: Array<{ cardId: string, generation: number }> = []
  /** 現在並行して動いているサムネイル処理数。 */
  let thumbnailWorkers = 0
  /** プロジェクト切り替え前のサムネイル結果を捨てるための世代番号。 */
  let thumbnailGeneration = 0
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

  onBeforeUnmount(resetThumbnailQueue)

  return {
    setCardThumbnail,
    resetCardThumbnails,
    removeCardThumbnail,
    cacheCardThumbnail,
    persistCardThumbnail,
    requestCardThumbnail,
  }
}
