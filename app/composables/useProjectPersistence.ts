import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useCardThumbnails } from '~/composables/useCardThumbnails'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectDocument } from '~/types/editor'
import { nextTick } from 'vue'
import { finalizeProjectCardDeletions } from '~/services/project/cards'
import { createFolderProject, saveFolderProject } from '~/services/project/folder'
import { savedProjectSignature } from '~/utils/project-save'

interface ProjectPersistenceOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'bindSavedCard'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'activeCard' | 'assets' | 'fonts' | 'ocrDictionary' | 'glossary' | 'acceptSavedProject'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'directory' | 'cardImage' | 'cardSourceFile' | 'pendingAssetWrites' | 'pendingCardThumbnailBlobs' | 'acknowledgeAssetWrites' | 'clearPendingCardThumbnails'>
  isDemo: Ref<boolean>
  projectBusy: Ref<boolean>
  ocrRunning: Ref<boolean>
  savingProject: Ref<boolean>
  currentImageId: Ref<string>
  pendingCardDeletionIds: Ref<Set<string>>
  lastSavedProjectSignature: Ref<string | null>
  removeCardThumbnail: ReturnType<typeof useCardThumbnails>['removeCardThumbnail']
  persistCardThumbnail: ReturnType<typeof useCardThumbnails>['persistCardThumbnail']
  finalizeFontCacheDeletions: () => Promise<void>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 保存した版だけを承認し、保存中に加わった編集や画像は未保存のまま保持する。 */
export function useProjectPersistence({
  editor,
  projectStore,
  projectRuntime,
  isDemo,
  projectBusy,
  ocrRunning,
  savingProject,
  currentImageId,
  pendingCardDeletionIds,
  lastSavedProjectSignature,
  removeCardThumbnail,
  persistCardThumbnail,
  finalizeFontCacheDeletions,
  setMessage,
  logDiagnostic,
}: ProjectPersistenceOptions) {
  const {
    directory: projectDirectory,
    cardImage: image,
    cardSourceFile: sourceImageFile,
    pendingAssetWrites,
    pendingCardThumbnailBlobs,
  } = projectRuntime

  /** 保存対象の画像更新・削除予定を控え、成功したスナップショットだけを保存済みとして扱う。 */
  async function saveProject() {
    if (isDemo.value) {
      setMessage('デモではプロジェクトを保存できません。')
      return
    }
    if (projectBusy.value || ocrRunning.value) {
      setMessage('カードの処理が完了してから保存してください。')
      return
    }
    if (!image.value || !sourceImageFile.value)
      return
    savingProject.value = true
    const savedWrites = new Map(pendingAssetWrites.value)
    const savedDeletionIds = new Set(pendingCardDeletionIds.value)
    const wasDraft = !projectStore.document
    try {
      let savedDocument: FolderProjectDocument
      logDiagnostic('プロジェクト保存を開始しました', {
        existingProject: Boolean(projectStore.document),
        projectFolderSelected: Boolean(projectDirectory.value),
        regions: editor.project.value.regions.length,
        pendingAssetWrites: pendingAssetWrites.value.size,
      })
      if (projectDirectory.value && projectStore.document) {
        const finalized = finalizeProjectCardDeletions(
          projectStore.document,
          pendingCardDeletionIds.value,
        )
        savedDocument = await saveFolderProject(
          projectDirectory.value,
          finalized.document,
          projectStore.activeCard,
          projectStore.assets,
          projectStore.fonts,
          projectStore.ocrDictionary,
          savedWrites,
          finalized.deletedCards,
          projectStore.glossary,
        )
        projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
        pendingCardDeletionIds.value = new Set([...pendingCardDeletionIds.value].filter(id => !savedDeletionIds.has(id)))
        if (finalized.deletedCards.length > 0) {
          for (const card of finalized.deletedCards)
            removeCardThumbnail(card.id)
          logDiagnostic('削除予定のカードをファイルから削除しました', {
            deleted: finalized.deletedCards.length,
          })
        }
      }
      else {
        const directory = projectDirectory.value
        if (!directory) {
          setMessage('先にプロジェクトフォルダを選択してください。')
          return
        }
        savedDocument = await createFolderProject(
          directory,
          projectStore.activeCard,
          sourceImageFile.value,
          currentImageId.value,
          projectStore.assets,
          projectStore.fonts,
          projectStore.ocrDictionary,
          savedWrites,
          projectStore.glossary,
        )
        projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
        if (wasDraft)
          editor.bindSavedCard(savedDocument.activeCardId)
      }
      const thumbnailDirectory = projectDirectory.value
      if (thumbnailDirectory && pendingCardThumbnailBlobs.value.size > 0) {
        pendingCardThumbnailBlobs.value.forEach((thumbnail, cardId) => {
          void persistCardThumbnail(thumbnailDirectory, cardId, thumbnail)
        })
        projectRuntime.clearPendingCardThumbnails()
      }
      projectRuntime.acknowledgeAssetWrites(savedWrites)
      await finalizeFontCacheDeletions()
      await nextTick()
      lastSavedProjectSignature.value = savedProjectSignature(savedDocument)
      logDiagnostic('プロジェクト保存が完了しました')
      setMessage(`${savedDocument.name} を保存しました。`)
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logDiagnostic('保存先の選択をキャンセルしました')
        return
      }
      logDiagnostic('プロジェクトを保存できませんでした', error, 'error')
      setMessage(
        error instanceof Error
          ? error.message
          : 'プロジェクトを保存できませんでした。',
      )
    }
    finally {
      savingProject.value = false
    }
  }

  return { saveProject }
}
