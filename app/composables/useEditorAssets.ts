import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import type { AssetCreationDraft, FolderProjectDocument, ImageAsset, RegionDraft } from '~/types/editor'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { renameProjectAssetTokens } from '~/services/project/cards'
import { updateRecroppedAsset, validateAssetName } from '~/utils/assets'
import { renderAssetCrop } from '~/utils/canvas/asset'

interface EditorAssetsOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'renameAssetToken'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'setAssets' | 'replaceProject'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'setAssetImage' | 'setPendingAssetWrite' | 'removeAssetImage' | 'removePendingAssetWrite'>
  assets: Ref<ImageAsset[]>
  folderDocument: Ref<FolderProjectDocument | null>
  assetSourceImage: Ref<HTMLImageElement | null>
  assetSourceImageId: Ref<string>
  assetEditing: Ref<boolean>
  maskEditing: Ref<boolean>
  exclusionEditing: Ref<boolean>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 共有アセットの下書きを画像へ変換し、定義・参照・保存待ち画像を揃える。 */
export function useEditorAssets({
  editor,
  projectStore,
  projectRuntime,
  assets,
  folderDocument,
  assetSourceImage,
  assetSourceImageId,
  assetEditing,
  maskEditing,
  exclusionEditing,
  setMessage,
  logDiagnostic,
}: EditorAssetsOptions) {
  /** 登録・再切り出しを確定する前のアセット設定。 */
  const assetCreationDraft = ref<AssetCreationDraft | null>(null)
  const assetCreationPending = shallowRef<AssetCreationDraft | null>(null)
  const assetCreationRunning = computed(() => assetCreationPending.value !== null && assetCreationPending.value === assetCreationDraft.value)
  let assetCreationDisposed = false
  /** 再切り出し対象の既存アセットID。 */
  const assetRecropId = ref<string | null>(null)

  /** カード上でのアセット範囲指定を切り替える。 */
  function toggleAssetEditing() {
    assetRecropId.value = null
    assetEditing.value = !assetEditing.value
    if (assetEditing.value) {
      maskEditing.value = false
      exclusionEditing.value = false
    }
  }

  /** 開いている元画像で再切り出しするアセットを指定し、範囲選択を開始する。 */
  function startAssetRecrop(id: string) {
    if (!assetSourceImage.value) {
      setMessage('先にアセット元画像を開いてください。')
      return
    }
    const asset = assets.value.find(item => item.id === id)
    if (!asset)
      return
    assetRecropId.value = id
    assetCreationDraft.value = null
    assetEditing.value = true
    maskEditing.value = false
    exclusionEditing.value = false
    setMessage(`元画像上でアセット「${asset.name}」の新しい範囲をドラッグしてください。`)
  }

  /** 指定範囲を元に、登録前のアセット作成下書きを開く。 */
  function addAsset(bounds: RegionDraft) {
    const editingAsset = assetRecropId.value
      ? assets.value.find(asset => asset.id === assetRecropId.value)
      : null
    const fallback = editingAsset?.name ?? `asset_${assets.value.length + 1}`
    assetCreationDraft.value = {
      editingAssetId: editingAsset?.id ?? null,
      name: fallback,
      sourceRect: bounds,
      removeBackground: true,
      backgroundColor: null,
      backgroundThreshold: 48,
      edgeFeather: 12,
      manualMaskStrokes: [],
    }
    assetRecropId.value = null
    assetEditing.value = false
  }

  /** 切り出し・透過設定の下書きを更新する。 */
  function updateAssetCreationDraft(patch: Partial<AssetCreationDraft>) {
    if (!assetCreationDraft.value)
      return
    assetCreationDraft.value = { ...assetCreationDraft.value, ...patch }
  }

  /** アセット作成の下書きを破棄して閉じる。 */
  function cancelAssetCreation() {
    assetCreationDraft.value = null
  }

  /** 透過処理後の画像を登録する。再切り出しではIDを引き継ぎ、ファイルへの書き込みは保存まで待つ。 */
  async function confirmAssetCreation() {
    const draft = assetCreationDraft.value
    const sourceImage = assetSourceImage.value
    if (!draft || !sourceImage || assetCreationRunning.value || assetCreationDisposed)
      return
    const name = draft.name.trim()
    const nameError = validateAssetName(
      name,
      assets.value,
      draft.editingAssetId ?? undefined,
    )
    if (nameError) {
      setMessage(nameError)
      return
    }
    const existingAsset = draft.editingAssetId
      ? assets.value.find(asset => asset.id === draft.editingAssetId)
      : null
    if (draft.editingAssetId && !existingAsset) {
      setMessage('更新対象のアセットが見つかりませんでした。')
      return
    }
    const sourceImageId = assetSourceImageId.value
    const isCurrent = () => !assetCreationDisposed
      && assetCreationDraft.value === draft
      && assetSourceImage.value === sourceImage
      && assetSourceImageId.value === sourceImageId
    assetCreationPending.value = draft
    try {
      const id = existingAsset?.id ?? crypto.randomUUID()
      const source = renderAssetCrop(
        sourceImage,
        draft.sourceRect,
        draft.removeBackground,
        {
          threshold: draft.backgroundThreshold,
          feather: draft.edgeFeather,
          backgroundColor: draft.backgroundColor,
        },
        draft.manualMaskStrokes,
      )
      const blob = await new Promise<Blob | null>(resolve =>
        source.toBlob(resolve, 'image/png'),
      )
      if (!isCurrent())
        return
      if (existingAsset && assets.value.find(asset => asset.id === existingAsset.id) !== existingAsset) {
        setMessage('生成中に更新対象が変更されました。再試行してください。')
        return
      }
      const currentNameError = validateAssetName(name, assets.value, draft.editingAssetId ?? undefined)
      if (currentNameError) {
        setMessage(currentNameError)
        return
      }
      if (!blob) {
        setMessage('アセット画像を作成できませんでした。')
        return
      }
      if (existingAsset && existingAsset.name !== name) {
        editor.renameAssetToken(existingAsset.id, existingAsset.name, name)
        if (folderDocument.value) {
          projectStore.replaceProject(renameProjectAssetTokens(
            folderDocument.value,
            existingAsset.name,
            name,
            existingAsset.id,
          ))
        }
      }
      const updatedAsset = existingAsset
        ? updateRecroppedAsset(
            existingAsset,
            name,
            assetSourceImageId.value,
            draft.sourceRect,
          )
        : {
            id,
            name,
            sourceImageId: assetSourceImageId.value,
            sourceRect: draft.sourceRect,
            imagePath: `assets/${id}.png`,
            scale: 1,
            baselineOffset: 0,
            inlinePadding: 0,
          }
      projectStore.setAssets(existingAsset
        ? assets.value.map(asset => asset.id === id ? updatedAsset : asset)
        : [...assets.value, updatedAsset])
      projectRuntime.setAssetImage(id, source)
      projectRuntime.setPendingAssetWrite(id, blob)
      assetCreationDraft.value = null
      setMessage(
        existingAsset
          ? `アセット「${name}」を更新しました。`
          : `アセット「${name}」を登録しました。`,
      )
    }
    catch (error) {
      if (isCurrent()) {
        logDiagnostic('アセット画像を作成できませんでした', error, 'error')
        setMessage('アセット画像を作成できませんでした。再試行してください。')
      }
    }
    finally {
      if (assetCreationPending.value === draft)
        assetCreationPending.value = null
    }
  }
  /** 共有定義・全カードのトークン・編集履歴を揃えて改名し、Undo後の参照切れを防ぐ。 */
  function renameAsset(id: string, name: string) {
    const asset = assets.value.find(item => item.id === id)
    if (!asset || !name || asset.name === name)
      return
    const nameError = validateAssetName(name, assets.value, id)
    if (nameError) {
      setMessage(nameError)
      return
    }
    editor.renameAssetToken(asset.id, asset.name, name)
    if (folderDocument.value) {
      projectStore.replaceProject(renameProjectAssetTokens(
        folderDocument.value,
        asset.name,
        name,
        asset.id,
      ))
    }
    projectStore.setAssets(assets.value.map(item =>
      item.id === id ? { ...item, name } : item,
    ))
  }

  /** アセット定義と表示画像・保存待ちの画像を取り除く。 */
  function removeAsset(id: string) {
    projectStore.setAssets(assets.value.filter(asset => asset.id !== id))
    projectRuntime.removeAssetImage(id)
    projectRuntime.removePendingAssetWrite(id)
  }

  /** 共有アセットの配置設定等を更新する。 */
  function updateAsset(id: string, patch: Partial<ImageAsset>) {
    projectStore.setAssets(assets.value.map(asset =>
      asset.id === id ? { ...asset, ...patch, id } : asset,
    ))
  }

  onBeforeUnmount(() => {
    assetCreationDisposed = true
  })

  return {
    assetCreationDraft,
    assetCreationRunning,
    assetRecropId,
    toggleAssetEditing,
    startAssetRecrop,
    addAsset,
    updateAssetCreationDraft,
    cancelAssetCreation,
    confirmAssetCreation,
    renameAsset,
    removeAsset,
    updateAsset,
  }
}
