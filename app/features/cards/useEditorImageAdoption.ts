import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { RuntimeLoadedImage, useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import type { AssetCreationDraft, FolderProjectCard } from '~/types/editor'
import { readImageDpi } from '~/utils/image-dpi'

interface EditorImageAdoptionOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'loadImageProject'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'setCardOCRCandidates' | 'invalidateAssetDiscoveryImage'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'directory' | 'replaceCardImage' | 'clearCardImage' | 'replaceAssetSourceImage' | 'clearAssetSourceImage' | 'setPendingCardThumbnail'>
  currentImageId: Ref<string>
  assetSourceImageId: Ref<string>
  assetEditing: Ref<boolean>
  assetCreationDraft: Ref<AssetCreationDraft | null>
  assetRecropId: Ref<string | null>
  addingCards: Readonly<Ref<boolean>>
  loadingCardId: Readonly<Ref<string | null>>
  isActive: () => boolean
  clearRegionCandidates: () => void
  saveProject: () => Promise<void>
  addProjectCards: (files: File[]) => Promise<void>
  loadImage: (file: File) => Promise<RuntimeLoadedImage | null>
  cacheCardThumbnail: (cardId: string, image: HTMLImageElement, isCurrent?: () => boolean) => Promise<Blob | null>
  updateCardPrintDpi: (cardId: string, dpi: FolderProjectCard['sourceDpi']) => void
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 読込済み画像を編集状態へ反映する。デコードはloader、採用後の資源所有はruntimeに残す。 */
export function useEditorImageAdoption({
  editor,
  projectStore,
  projectRuntime,
  currentImageId,
  assetSourceImageId,
  assetEditing,
  assetCreationDraft,
  assetRecropId,
  addingCards,
  loadingCardId,
  isActive,
  clearRegionCandidates,
  loadImage,
  saveProject,
  addProjectCards,
  cacheCardThumbnail,
  updateCardPrintDpi,
  setMessage,
  logDiagnostic,
}: EditorImageAdoptionOptions) {
  let cardRequest = 0
  let assetRequest = 0

  function applyLoadedImage(loaded: RuntimeLoadedImage) {
    clearRegionCandidates()
    projectRuntime.replaceCardImage(loaded)
    logDiagnostic('画像をエディターへ反映しました', {
      width: loaded.element.naturalWidth,
      height: loaded.element.naturalHeight,
    })
  }

  async function detectAndApplyCardDpi(cardId: string, file: File) {
    const directory = projectRuntime.directory.value
    const card = projectStore.document?.cards.find(item => item.id === cardId)
    if (!isActive() || !card || card.sourceDpi)
      return
    const dpi = await readImageDpi(file)
    if (!dpi || !isActive() || projectRuntime.directory.value !== directory
      || projectStore.document?.cards.find(item => item.id === cardId) !== card || card.sourceDpi) {
      return
    }
    updateCardPrintDpi(cardId, dpi)
    logDiagnostic('元画像のDPIメタデータを読み込みました', {
      cardId,
      x: dpi.x,
      y: dpi.y,
    })
  }

  function clearLoadedCardImage() {
    cardRequest++
    clearRegionCandidates()
    projectRuntime.clearCardImage()
  }

  function applyAssetSourceImage(loaded: RuntimeLoadedImage) {
    projectRuntime.replaceAssetSourceImage(loaded)
    assetSourceImageId.value = crypto.randomUUID()
    logDiagnostic('アイコン切り出し元画像を反映しました', {
      width: loaded.element.naturalWidth,
      height: loaded.element.naturalHeight,
    })
  }

  function clearAssetSourceImage() {
    assetRequest++
    projectRuntime.clearAssetSourceImage()
    assetSourceImageId.value = crypto.randomUUID()
    assetEditing.value = false
    assetCreationDraft.value = null
    assetRecropId.value = null
  }

  /** 新規フォルダの最初の画像。既存プロジェクトへのカード追加とは別経路。 */
  async function openCardImage(file: File) {
    if (!isActive())
      return
    if (addingCards.value || loadingCardId.value) {
      setMessage('カードの処理が完了してから画像を開いてください。')
      return
    }
    if (!projectRuntime.directory.value) {
      setMessage('先にプロジェクトフォルダを選択してください。')
      return
    }
    if (projectStore.document) {
      setMessage('既存プロジェクトへの追加はカード一覧の＋を使用してください。')
      return
    }
    const request = ++cardRequest
    const directory = projectRuntime.directory.value
    const cardId = currentImageId.value
    const isCurrent = () => isActive() && request === cardRequest
      && projectRuntime.directory.value === directory && currentImageId.value === cardId && !projectStore.document
    logDiagnostic('「画像を開く」の選択を開始しました')
    const loaded = await loadImage(file)
    if (!loaded)
      return
    if (!isCurrent()) {
      URL.revokeObjectURL(loaded.url)
      loaded.element.removeAttribute('src')
      return
    }
    let adopted = false
    try {
      editor.loadImageProject(
        file.name,
        loaded.element.naturalWidth,
        loaded.element.naturalHeight,
      )
      projectStore.setCardOCRCandidates(cardId, null)
      projectStore.invalidateAssetDiscoveryImage(cardId)
      logDiagnostic('新規プロジェクトの最初のカード画像を反映しました')
      applyLoadedImage(loaded)
      adopted = true
      const thumbnail = await cacheCardThumbnail(cardId, loaded.element, isCurrent)
      if (!isCurrent())
        return
      if (thumbnail)
        projectRuntime.setPendingCardThumbnail(cardId, thumbnail)
      setMessage(`${file.name} を読み込みました。`)
      return true
    }
    catch (error) {
      if (!adopted) {
        URL.revokeObjectURL(loaded.url)
        loaded.element.removeAttribute('src')
      }
      if (!isCurrent())
        return
      if (adopted) {
        logDiagnostic('カードサムネイルを作成できませんでした', error, 'error')
        setMessage(`${file.name} を読み込みました（サムネイルの作成に失敗しました）。`)
        return true
      }
      logDiagnostic('編集プロジェクトの初期化に失敗しました', error, 'error')
      setMessage('画像の編集画面を初期化できませんでした。')
    }
  }

  /** 複数の初期画像は最初のカードを保存してから既存の一括追加経路へ渡す。 */
  async function openCardImages(files: File[]) {
    const first = files[0]
    if (!first)
      return
    const directory = projectRuntime.directory.value
    const cardId = currentImageId.value
    const request = cardRequest + 1
    if (!await openCardImage(first) || files.length === 1)
      return
    const isCurrent = () => isActive() && cardRequest === request
      && projectRuntime.directory.value === directory && currentImageId.value === cardId
    if (!isCurrent())
      return
    await saveProject()
    // 保存失敗・別の画像やプロジェクトへの切替後は残りを追加しない。
    if (!isCurrent() || !projectStore.document?.cards.some(card => card.id === cardId))
      return
    await addProjectCards(files.slice(1))
  }

  async function openAssetSourceImage(file: File) {
    if (!isActive())
      return
    const request = ++assetRequest
    logDiagnostic('アイコン切り出し元の画像選択を開始しました')
    const loaded = await loadImage(file)
    if (!loaded)
      return
    if (!isActive() || request !== assetRequest) {
      URL.revokeObjectURL(loaded.url)
      loaded.element.removeAttribute('src')
      return
    }
    applyAssetSourceImage(loaded)
    assetEditing.value = false
    assetCreationDraft.value = null
    assetRecropId.value = null
    setMessage(`${file.name} をアイコン切り出し元として読み込みました。`)
  }

  return { applyLoadedImage, clearLoadedCardImage, detectAndApplyCardDpi, clearAssetSourceImage, openCardImage, openCardImages, openAssetSourceImage }
}
