import type { useCardEditor } from '~/composables/useCardEditor'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { SourceIconOCRContext, SourceIconOCRDraft, SourceIconOCRPreview, SourceIconOCRScope } from '~/services/asset-discovery/source-ocr'
import type { OCRProgress, OCRProvider } from '~/services/ocr/types'
import type { useProjectStore } from '~/stores/project'
import type { TextRegion } from '~/types/editor'
import { computed, onScopeDispose, shallowRef, watchEffect } from 'vue'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { ASSET_DISCOVERY_LIMITS } from '~/services/asset-discovery/format'
import { prepareSourceIconOCR, recognizeSourceIconOCR, sourceIconOCRPatch, sourceIconPositionPatch } from '~/services/asset-discovery/source-ocr'
import { assertImageDimensions } from '~/utils/file-limits'

export interface DiscoverySourceOCRTarget {
  card: SourceIconOCRContext['card']
  regionId: string
  /** 初回保存前だけnull。呼出元で通常エディターのカードIDと一致させる。 */
  editorCardId: string | null
}

interface DiscoverySourceOCROptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'assets' | 'assetDiscovery'>
  runtime: Pick<ReturnType<typeof useProjectRuntime>, 'projectGeneration' | 'cardSourceFile' | 'assetFiles' | 'pendingAssetWrites'>
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'updateRegion'>
  target: () => DiscoverySourceOCRTarget | null
  /** ユーザーの再OCR操作から初期化する。共有Providerの解放は呼出元の責務。 */
  getProvider: () => Promise<OCRProvider>
  onProgress?: (progress: OCRProgress) => void
  /** 確認画面・OCR設定などの追加依存先。 */
  scope?: () => readonly unknown[]
  /** 保存・カード切替など。自身のrunningは含めない。 */
  busy?: () => boolean
}

interface OCRRequest {
  current: () => boolean
  context: () => SourceIconOCRContext
  scope: SourceIconOCRScope
  file: File
  width: number
  height: number
}

/** 画像照合→独立コピー→原文候補を制御し、明示適用だけを通常編集へ渡す。 */
export function useDiscoverySourceOCR({ store, runtime, editor, target, getProvider, onProgress, scope = () => [], busy = () => false }: DiscoverySourceOCROptions) {
  const active = shallowRef<OCRRequest | null>(null)
  const prepared = shallowRef<SourceIconOCRDraft | null>(null)
  const result = shallowRef<SourceIconOCRPreview | null>(null)
  const running = shallowRef(false)
  const digests = createImageDigestCache()
  let disposed = false
  let revision = 0

  function cancel() {
    revision++
    active.value = null
    prepared.value = null
    result.value = null
    running.value = false
  }
  watchEffect(() => {
    if (active.value && !active.value.current())
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancel()
    digests.clear()
  })

  async function decode(request: OCRRequest): Promise<ImageBitmap> {
    if (typeof globalThis.createImageBitmap !== 'function')
      throw new Error('この環境では元画像を読み込めません。対応ブラウザで開いてください。')
    const bitmap = await createImageBitmap(request.file)
    try {
      assertImageDimensions(bitmap.width, bitmap.height)
      if (bitmap.width !== request.width || bitmap.height !== request.height)
        throw new Error('元画像の寸法が変わりました。カードを開き直してください。')
      return bitmap
    }
    catch (error) {
      bitmap.close()
      throw error
    }
  }

  async function prepare(occurrenceIds: readonly string[]): Promise<SourceIconOCRDraft | null> {
    if (disposed || busy() || running.value)
      return null
    cancel()
    const start = target()
    if (!start)
      return null
    const file = runtime.cardSourceFile.value
    if (!file)
      throw new Error('元画像を読み込んでからアイコンを適用してください。')
    const ids = [...occurrenceIds]
    if (!ids.length || ids.length > ASSET_DISCOVERY_LIMITS.perCard || new Set(ids).size !== ids.length)
      throw new Error('適用するアイコン候補を選び直してください。')
    const originalProject = editor.project.value
    const region = start.card.regions.find(item => item.id === start.regionId)
    if ((start.editorCardId !== null && start.editorCardId !== start.card.id) || !region
      || originalProject.imageWidth !== start.card.imageWidth || originalProject.imageHeight !== start.card.imageHeight
      || JSON.stringify(originalProject.regions) !== JSON.stringify(start.card.regions)) {
      throw new Error('再OCR対象と現在の編集領域が一致していません。領域を選び直してください。')
    }
    assertImageDimensions(start.card.imageWidth, start.card.imageHeight)
    const chosen = () => store.assetDiscovery?.occurrences.filter(item => ids.includes(item.id)) ?? []
    if (chosen().length !== ids.length)
      throw new Error('選択したアイコン候補が見つかりません。')
    const snapshot = () => {
      const value = target()
      return JSON.stringify([value?.editorCardId, value?.regionId, value?.card, chosen(), store.assets])
    }
    const initial = snapshot()
    const usedIds = new Set([...(region.sourceIcons ?? []).map(icon => icon.assetId), ...chosen().flatMap(item => item.assetId ? [item.assetId] : [])])
    const sources = [...usedIds].map(id => ({ id, blob: runtime.pendingAssetWrites.value.get(id) ?? runtime.assetFiles.value.get(id) }))
    const generation = runtime.projectGeneration.value
    const dependencies = [...scope()]
    let imageDigest = ''
    const assetDigests = new Map<string, string>()
    let invalidated = false
    const requestRevision = revision
    const request: OCRRequest = {
      file,
      width: start.card.imageWidth,
      height: start.card.imageHeight,
      scope: { session: Symbol('source-icon-ocr'), revision: requestRevision },
      current: () => {
        const currentDependencies = scope()
        invalidated ||= disposed || busy() || active.value !== request || revision !== requestRevision
          || generation !== runtime.projectGeneration.value || file !== runtime.cardSourceFile.value
          || originalProject !== editor.project.value || initial !== snapshot()
          || sources.some(source => source.blob !== (runtime.pendingAssetWrites.value.get(source.id) ?? runtime.assetFiles.value.get(source.id)))
          || dependencies.length !== currentDependencies.length || dependencies.some((value, i) => value !== currentDependencies[i])
        return !invalidated
      },
      context: () => ({ card: target()!.card, occurrences: chosen(), assets: store.assets, imageDigest, assetDigests }),
    }
    active.value = request
    running.value = true
    let bitmap: ImageBitmap | undefined
    try {
      imageDigest = await digests.digest(file)
      if (!request.current())
        return null
      for (const source of sources) {
        if (!source.blob)
          throw new Error('指定したアイコンの画像が未読込です。読み込んでからやり直してください。')
        assetDigests.set(source.id, await digests.digest(source.blob))
        if (!request.current())
          return null
      }
      // 位置だけの適用でも実画像寸法を確認。確認画面の待機中はBitmapを保持しない。
      bitmap = await decode(request)
      if (!request.current())
        return null
      const draft = prepareSourceIconOCR(request.context(), start.regionId, ids, request.scope)
      prepared.value = draft
      return draft
    }
    catch (error) {
      if (!request.current())
        return null
      throw error
    }
    finally {
      bitmap?.close()
      if (active.value === request) {
        running.value = false
        if (!prepared.value)
          cancel()
      }
    }
  }

  function requireDraft(draft: SourceIconOCRDraft): OCRRequest {
    const request = active.value
    if (running.value || !request?.current() || prepared.value !== draft)
      throw new Error('アイコンの確認結果が古いか対象が変わりました。現在の内容でやり直してください。')
    return request
  }

  async function recognize(draft: SourceIconOCRDraft): Promise<SourceIconOCRPreview | null> {
    const request = requireDraft(draft)
    result.value = null
    running.value = true
    let bitmap: ImageBitmap | undefined
    try {
      const provider = await getProvider()
      if (!request.current())
        return null
      bitmap = await decode(request)
      if (!request.current())
        return null
      const preview = await recognizeSourceIconOCR(draft, {
        image: bitmap,
        provider,
        onProgress,
        current: () => request.current() ? { context: request.context(), scope: request.scope } : null,
      })
      if (!preview || !request.current())
        return null
      result.value = preview
      return preview
    }
    catch (error) {
      if (!request.current())
        return null
      throw error
    }
    finally {
      bitmap?.close()
      if (active.value === request)
        running.value = false
    }
  }

  function applyPatch(draft: SourceIconOCRDraft, patch: Partial<TextRegion>): boolean {
    const current = target()!.card.regions.find(item => item.id === draft.regionId)!
    const changed = JSON.stringify(current.sourceIcons ?? []) !== JSON.stringify(patch.sourceIcons ?? [])
      || (patch.originalText !== undefined && patch.originalText !== current.originalText)
    if (changed)
      editor.updateRegion(draft.regionId, patch, target()!.editorCardId)
    cancel()
    return changed
  }

  function applyPositions(draft: SourceIconOCRDraft): boolean {
    const request = requireDraft(draft)
    return applyPatch(draft, sourceIconPositionPatch(request.context(), draft, request.scope))
  }

  function apply(preview: SourceIconOCRPreview): boolean {
    const request = requireDraft(preview.draft)
    if (result.value !== preview)
      throw new Error('現在の確認画面で作成した原文候補を選んでください。')
    return applyPatch(preview.draft, sourceIconOCRPatch(request.context(), preview, request.scope))
  }

  return {
    running: computed(() => running.value),
    draft: computed(() => active.value?.current() ? prepared.value : null),
    preview: computed(() => active.value?.current() ? result.value : null),
    prepare,
    recognize,
    applyPositions,
    apply,
    cancel,
  }
}
