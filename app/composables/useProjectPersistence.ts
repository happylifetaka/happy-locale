import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useCardThumbnails } from '~/composables/useCardThumbnails'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { ProjectActivity } from '~/features/cards/useProjectActivity'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectDocument } from '~/types/editor'
import { nextTick, readonly, ref } from 'vue'
import { createFolderProject, saveFolderProject } from '~/services/project/folder'
import { captureProjectSave } from '~/services/project/save-snapshot'
import { savedProjectSignature } from '~/utils/project-save'

interface ProjectPersistenceOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'bindSavedCard'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'activeCard' | 'assets' | 'fonts' | 'ocrDictionary' | 'glossary' | 'acceptSavedProject' | 'draftOCRCandidates'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'directory' | 'cardImage' | 'cardSourceFile' | 'pendingAssetWrites' | 'pendingCardThumbnailBlobs' | 'acknowledgeAssetWrites' | 'clearPendingCardThumbnails'>
  isDemo: Ref<boolean>
  activity: ProjectActivity
  ocrRunning: Ref<boolean>
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
  activity,
  ocrRunning,
  currentImageId,
  pendingCardDeletionIds,
  lastSavedProjectSignature,
  removeCardThumbnail,
  persistCardThumbnail,
  finalizeFontCacheDeletions,
  setMessage,
  logDiagnostic,
}: ProjectPersistenceOptions) {
  /** 保存処理中か。途中のreturnや失敗でもfinallyで解除する。 */
  const savingProject = ref(false)
  const { busy: projectBusy } = activity
  activity.track(savingProject)

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
    try {
      const snapshot = captureProjectSave({
        document: projectStore.document,
        card: projectStore.activeCard,
        cardId: currentImageId.value,
        assets: projectStore.assets,
        fonts: projectStore.fonts,
        ocrDictionary: projectStore.ocrDictionary,
        glossary: projectStore.glossary,
        draftOCRCandidates: projectStore.draftOCRCandidates,
      }, pendingAssetWrites.value, pendingCardDeletionIds.value)
      const { assetWrites: savedWrites, deletionIds: savedDeletionIds } = snapshot
      let savedDocument: FolderProjectDocument
      logDiagnostic('プロジェクト保存を開始しました', {
        existingProject: Boolean(projectStore.document),
        projectFolderSelected: Boolean(projectDirectory.value),
        regions: editor.project.value.regions.length,
        pendingAssetWrites: pendingAssetWrites.value.size,
      })
      if (projectDirectory.value && snapshot.document) {
        savedDocument = await saveFolderProject(
          projectDirectory.value,
          snapshot.document,
          snapshot.card,
          snapshot.assets,
          snapshot.fonts,
          snapshot.ocrDictionary,
          savedWrites,
          snapshot.deletedCards,
          snapshot.glossary,
        )
        projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
        pendingCardDeletionIds.value = new Set([...pendingCardDeletionIds.value].filter(id => !savedDeletionIds.has(id)))
        if (snapshot.deletedCards.length > 0) {
          for (const card of snapshot.deletedCards)
            removeCardThumbnail(card.id)
          logDiagnostic('削除予定のカードをファイルから削除しました', {
            deleted: snapshot.deletedCards.length,
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
          snapshot.card,
          sourceImageFile.value,
          snapshot.cardId,
          snapshot.assets,
          snapshot.fonts,
          snapshot.ocrDictionary,
          savedWrites,
          snapshot.glossary,
          snapshot.draftOCRCandidates,
        )
        projectStore.acceptSavedProject(savedDocument, savedDeletionIds)
        if (!snapshot.document)
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

  return { savingProject: readonly(savingProject), saveProject }
}
