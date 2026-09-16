import type { Ref } from 'vue'
import type { useCardThumbnails } from '~/composables/useCardThumbnails'
import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import type { ProjectActivity } from '~/features/cards/useProjectActivity'
import type { FontReference } from '~/types/editor'
import { readonly, ref } from 'vue'
import { folderProjectExists, openFolderProject, pickProjectDirectory } from '~/services/project/folder'
import { loadProjectAssetImages } from '~/services/project/resources'
import { createSampleProjectCopy } from '~/services/project/sample'

export type OpenedFolderProject = Awaited<ReturnType<typeof openFolderProject>>

interface ProjectSessionOptions {
  activity: ProjectActivity
  ocrRunning: Ref<boolean>
  isActive: () => boolean
  confirmLeave: () => Promise<boolean>
  baseURL: string
  loadImage: (file: File) => Promise<RuntimeLoadedImage | null>
  startNewFolderProject: (directory: FileSystemDirectoryHandle) => void
  adoptProject: (opened: OpenedFolderProject, loaded: RuntimeLoadedImage, images: Map<string, ImageBitmap>) => void
  restoreCachedFonts: (references: FontReference[]) => Promise<void>
  detectAndApplyCardDpi: (cardId: string, file: File) => Promise<void>
  cacheCardThumbnail: ReturnType<typeof useCardThumbnails>['cacheCardThumbnail']
  persistCardThumbnail: ReturnType<typeof useCardThumbnails>['persistCardThumbnail']
  onOpened: () => Promise<void>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 文書と画像を準備してから編集状態へ引き渡し、途中終了時は未採用の画像を解放する。 */
export function useProjectSession({
  activity,
  ocrRunning,
  isActive,
  confirmLeave,
  baseURL,
  loadImage,
  startNewFolderProject,
  adoptProject,
  restoreCachedFonts,
  detectAndApplyCardDpi,
  cacheCardThumbnail,
  persistCardThumbnail,
  onOpened,
  setMessage,
  logDiagnostic,
}: ProjectSessionOptions) {
  /** 文書読み込み中か。資源の後片付けを終えてfinallyで解除する。 */
  const openingProject = ref(false)
  const { busy: projectBusy } = activity
  activity.track(openingProject)

  /** 文書・カード画像・アセット画像の読み込みを終えてから編集画面を差し替える。 */
  async function openProject(sample = false) {
    if (!isActive() || projectBusy.value || ocrRunning.value) {
      setMessage('カードの処理が完了してからプロジェクトを開いてください。')
      return
    }
    if (!await confirmLeave())
      return
    if (!isActive() || projectBusy.value)
      return
    openingProject.value = true
    let stagedImage: RuntimeLoadedImage | null = null
    let stagedAssets: Map<string, ImageBitmap> | null = null
    logDiagnostic('「プロジェクトを開く」を開始しました')
    try {
      const directory = sample ? await createSampleProjectCopy(baseURL) : await pickProjectDirectory()
      if (!isActive())
        return
      logDiagnostic('プロジェクトフォルダの権限を取得しました')
      const exists = await folderProjectExists(directory)
      if (!isActive())
        return
      if (!exists) {
        startNewFolderProject(directory)
        logDiagnostic('新規プロジェクト用のフォルダを選択しました', {
          folderName: directory.name,
        })
        setMessage(
          `${directory.name} を選択しました。最初のカード画像を開いてください。`,
        )
        return
      }
      const opened = await openFolderProject(directory)
      if (!isActive())
        return
      logDiagnostic('project.jsonと画像ファイルを取得しました', {
        cards: opened.document.cards.length,
        imageType: opened.imageFile.type || '(未設定)',
        imageSize: opened.imageFile.size,
      })
      const loaded = await loadImage(opened.imageFile)
      if (!loaded)
        return
      stagedImage = loaded
      stagedAssets = await loadProjectAssetImages(opened.assetFiles)
      if (!isActive())
        return
      adoptProject(opened, loaded, stagedAssets)
      stagedAssets = null
      stagedImage = null
      await restoreCachedFonts(opened.document.fonts)
      if (!isActive())
        return
      await detectAndApplyCardDpi(opened.card.id, opened.imageFile)
      if (!isActive())
        return
      const thumbnail = await cacheCardThumbnail(opened.card.id, loaded.element)
      if (!isActive())
        return
      if (thumbnail) {
        void persistCardThumbnail(
          opened.directory,
          opened.card.id,
          thumbnail,
        )
      }
      await onOpened()
      if (!isActive())
        return
      logDiagnostic('保存済み編集データを反映しました', {
        regions: opened.card.regions.length,
      })
      setMessage(`${opened.document.name} を開きました。`)
    }
    catch (error) {
      if (!isActive())
        return
      if (error instanceof DOMException && error.name === 'AbortError') {
        logDiagnostic('フォルダ選択をキャンセルしました')
        return
      }
      logDiagnostic('プロジェクトを開けませんでした', error, 'error')
      setMessage(
        error instanceof Error
          ? error.message
          : 'プロジェクトを開けませんでした。',
      )
    }
    finally {
      if (stagedImage) {
        URL.revokeObjectURL(stagedImage.url)
        stagedImage.element.removeAttribute('src')
      }
      stagedAssets?.forEach(bitmap => bitmap.close())
      openingProject.value = false
    }
  }

  return { openingProject: readonly(openingProject), openProject }
}
