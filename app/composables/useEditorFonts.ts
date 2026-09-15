import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { LocalFontData } from '~/services/fonts/local-font'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectDocument, FontReference } from '~/types/editor'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { cacheFont, loadCachedFont, removeCachedFont } from '~/services/fonts/cache'
import { loadLocalFont } from '~/services/fonts/local-font'
import { loadUserFont } from '~/services/fonts/user-font'
import { countCardFontUsage, countProjectFontUsage, removeCardFontReferences, removeProjectFont } from '~/services/project/cards'

interface EditorFontsOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegionId' | 'loadSavedProject'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'setFonts' | 'replaceProject'>
  projectRuntime: Pick<ReturnType<typeof useProjectRuntime>, 'replaceLoadedFonts' | 'setLoadedFont' | 'removeLoadedFont'>
  projectDirectory: Ref<FileSystemDirectoryHandle | null>
  folderDocument: Ref<FolderProjectDocument | null>
  fonts: Ref<FontReference[]>
  loadedFonts: Ref<Map<string, FontFace>>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** フォントの読込とキャッシュ、共有参照の削除を管理する。FontFaceの所有はruntimeが担う。 */
export function useEditorFonts({
  editor,
  projectStore,
  projectRuntime,
  projectDirectory,
  folderDocument,
  fonts,
  loadedFonts,
  setMessage,
  logDiagnostic,
}: EditorFontsOptions) {
  /** このブラウザに保存できたフォントのID一覧。 */
  const cachedFontIds = shallowRef(new Set<string>())
  let fontLoadGeneration = 0
  let fontLoadingDisposed = false
  watch(projectDirectory, () => {
    fontLoadGeneration += 1
  }, { flush: 'sync' })
  /** プロジェクト保存後にキャッシュから削除するフォントID。 */
  const pendingFontCacheDeletionIds = shallowRef(new Set<string>())
  /** 削除確認中のフォントと、その使用箇所数。 */
  const fontPendingDeletionConfirmation = shallowRef<{
    font: FontReference
    usageCount: number
  } | null>(null)

  /** 実際にブラウザへ読み込まれているフォントID。 */
  const loadedFontIds = computed(() => new Set(loadedFonts.value.keys()))
  /** 読み込み済みフォントIDと描画用family名の対応表。 */
  const fontFamilies = computed(
    () =>
      new Map(
        fonts.value
          .filter(font => loadedFonts.value.has(font.id))
          .map(font => [font.id, `"${font.familyName}"`]),
      ),
  )

  /** 保存済みの参照に対応するフォントをブラウザのキャッシュから復元する。 */
  async function restoreCachedFonts(references: FontReference[]) {
    if (fontLoadingDisposed)
      return
    const generation = ++fontLoadGeneration
    const restored = new Map<string, FontFace>()
    const cached = new Set<string>()
    await Promise.all(references.map(async (reference) => {
      try {
        const face = await loadCachedFont(reference)
        if (!face)
          return
        if (fontLoadingDisposed || generation !== fontLoadGeneration) {
          document.fonts.delete(face)
          return
        }
        restored.set(reference.id, face)
        cached.add(reference.id)
      }
      catch (error) {
        if (fontLoadingDisposed || generation !== fontLoadGeneration)
          return
        logDiagnostic(
          `保存済みフォント「${reference.displayName}」を復元できませんでした`,
          error,
          'error',
        )
      }
    }))
    if (fontLoadingDisposed || generation !== fontLoadGeneration) {
      restored.forEach(face => document.fonts.delete(face))
      return
    }
    projectRuntime.replaceLoadedFonts(restored)
    cachedFontIds.value = cached
    if (restored.size > 0) {
      logDiagnostic('ブラウザ保存済みフォントを復元しました', {
        restored: restored.size,
        requested: references.length,
      })
    }
  }

  /** フォントBlobをキャッシュし、保存できたフォントの一覧を更新する。 */
  async function saveFontToCache(reference: FontReference, blob: Blob, generation: number) {
    try {
      await cacheFont(reference.id, blob)
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return false
      cachedFontIds.value = new Set(cachedFontIds.value).add(reference.id)
      return true
    }
    catch (error) {
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return false
      logDiagnostic(
        `フォント「${reference.displayName}」をブラウザへ保存できませんでした`,
        error,
        'error',
      )
      return false
    }
  }

  /** 選択フォントを読み込み、表示用と保存用の情報を登録する。 */
  async function loadFont(file: File, fontId: string | null) {
    if (fontLoadingDisposed)
      return
    const generation = fontLoadGeneration
    try {
      const existing = fontId
        ? fonts.value.find(font => font.id === fontId)
        : fonts.value.find(font =>
            font.source === 'user' && font.fileName === file.name,
          )
      const loaded = await loadUserFont(file, existing)
      if (fontLoadingDisposed || generation !== fontLoadGeneration) {
        document.fonts.delete(loaded.face)
        return
      }
      if (!existing)
        projectStore.setFonts([...fonts.value, loaded.reference])
      projectRuntime.setLoadedFont(loaded.reference.id, loaded.face)
      const cached = await saveFontToCache(loaded.reference, loaded.blob, generation)
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return
      setMessage(
        cached
          ? `フォント「${loaded.reference.displayName}」を読み込み、ブラウザへ保存しました。`
          : `フォント「${loaded.reference.displayName}」を読み込みました。次回は再選択が必要です。`,
      )
    }
    catch (error) {
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return
      setMessage(
        error instanceof Error
          ? error.message
          : 'フォントを読み込めませんでした。',
      )
    }
  }

  /** 選択したOSフォントを編集用に登録し、キャッシュへ保存する。 */
  async function loadSystemFont(font: LocalFontData, fontId: string | null) {
    if (fontLoadingDisposed)
      return
    const generation = fontLoadGeneration
    try {
      const existing = fontId
        ? fonts.value.find(reference => reference.id === fontId)
        : fonts.value.find(reference =>
            reference.source === 'system'
            && reference.postscriptName === font.postscriptName,
          )
      const loaded = await loadLocalFont(font, existing)
      if (fontLoadingDisposed || generation !== fontLoadGeneration) {
        document.fonts.delete(loaded.face)
        return
      }
      if (!existing)
        projectStore.setFonts([...fonts.value, loaded.reference])
      projectRuntime.setLoadedFont(loaded.reference.id, loaded.face)
      const cached = await saveFontToCache(loaded.reference, loaded.blob, generation)
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return
      setMessage(
        cached
          ? `${loaded.reference.displayName} を読み込み、ブラウザへ保存しました。`
          : `${loaded.reference.displayName} を読み込みました。次回は再選択が必要です。`,
      )
    }
    catch (error) {
      if (fontLoadingDisposed || generation !== fontLoadGeneration)
        return
      logDiagnostic('PCフォントを読み込めませんでした', error, 'error')
      setMessage(
        error instanceof Error ? error.message : 'PCフォントを読み込めませんでした。',
      )
    }
  }

  /** 使用箇所を数えてフォント削除の確認を開く。 */
  function requestFontDeletion(id: string) {
    const font = fonts.value.find(item => item.id === id)
    if (!font)
      return
    const documentValue = folderDocument.value
      ? folderDocument.value
      : null
    const usageCount = documentValue
      ? countProjectFontUsage(documentValue, id)
      : countCardFontUsage(editor.project.value, id)
    if (usageCount > 0) {
      fontPendingDeletionConfirmation.value = { font, usageCount }
      return
    }
    deleteFont(font)
  }

  /** フォント削除の確認を閉じる。 */
  function cancelFontDeletion() {
    fontPendingDeletionConfirmation.value = null
  }

  /** 確認中のフォントの削除を実行する。 */
  function confirmFontDeletion() {
    const pending = fontPendingDeletionConfirmation.value
    fontPendingDeletionConfirmation.value = null
    if (pending)
      deleteFont(pending.font)
  }

  /** カードの参照を標準フォントへ戻す。永続キャッシュの削除はプロジェクト保存後へ回す。 */
  function deleteFont(font: FontReference) {
    const selectedRegionId = editor.selectedRegionId.value
    if (folderDocument.value) {
      const updated = removeProjectFont(
        folderDocument.value,
        font.id,
      )
      projectStore.replaceProject(updated)
      const activeCard = updated.cards.find(
        card => card.id === updated.activeCardId,
      )
      if (activeCard) {
        editor.loadSavedProject({
          imageName: activeCard.imageName,
          imageWidth: activeCard.imageWidth,
          imageHeight: activeCard.imageHeight,
          regions: activeCard.regions,
        }, activeCard.id)
      }
    }
    else {
      editor.loadSavedProject(
        removeCardFontReferences(editor.project.value, font.id),
      )
    }
    if (selectedRegionId && editor.project.value.regions.some(
      region => region.id === selectedRegionId,
    )) {
      editor.selectedRegionId.value = selectedRegionId
    }

    projectRuntime.removeLoadedFont(font.id)
    if (!folderDocument.value)
      projectStore.setFonts(fonts.value.filter(item => item.id !== font.id))

    pendingFontCacheDeletionIds.value = new Set(
      pendingFontCacheDeletionIds.value,
    ).add(font.id)
    const nextCachedIds = new Set(cachedFontIds.value)
    nextCachedIds.delete(font.id)
    cachedFontIds.value = nextCachedIds
    setMessage(`フォント「${font.displayName}」を削除しました。プロジェクト保存時に確定します。`)
  }

  /** 保存後に削除予定のフォントキャッシュを取り除く。 */
  async function finalizeFontCacheDeletions() {
    const failed = new Set<string>()
    for (const id of pendingFontCacheDeletionIds.value) {
      try {
        await removeCachedFont(id)
      }
      catch (error) {
        failed.add(id)
        logDiagnostic(
          '削除したフォントのブラウザ保存を消去できませんでした',
          error,
          'error',
        )
      }
    }
    pendingFontCacheDeletionIds.value = failed
  }

  /** フォントの表示名を変更する。 */
  function renameFont(id: string, displayName: string) {
    if (!displayName)
      return
    projectStore.setFonts(fonts.value.map(font =>
      font.id === id ? { ...font, displayName } : font,
    ))
  }

  onBeforeUnmount(() => {
    fontLoadingDisposed = true
    fontLoadGeneration += 1
  })

  return {
    cachedFontIds,
    pendingFontCacheDeletionIds,
    fontPendingDeletionConfirmation,
    loadedFontIds,
    fontFamilies,
    restoreCachedFonts,
    loadFont,
    loadSystemFont,
    requestFontDeletion,
    cancelFontDeletion,
    confirmFontDeletion,
    finalizeFontCacheDeletions,
    renameFont,
  }
}
