import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { IconRegionRow } from '~/services/asset-discovery/analyze-regions'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { CardProject, FolderProjectCard, ImageAsset } from '~/types/editor'
import { computed, onScopeDispose, ref, shallowRef, watchEffect } from 'vue'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { assertImageDimensions } from '~/utils/file-limits'

/** 領域検出→元画像座標の再対応付け→OCR案→カード単位の明示適用。 */
export function useIconRegionAnalysis(options: DiscoveryWorkspaceOptions) {
  const { store, runtime, editor, currentImageId } = options
  const running = ref(false)
  const cancelled = ref(false)
  const error = ref('')
  const status = ref('')
  const rows = shallowRef<IconRegionRow[]>([])
  const warnings = ref<string[]>([])
  const cache = createImageDigestCache()
  const card = computed<FolderProjectCard>(() => store.document?.cards.find(card => card.id === currentImageId.value)
    ?? { ...store.draftCard, id: currentImageId.value, imagePath: '', sourceDpi: null, printArea: null, ocrCandidates: store.draftOCRCandidates })
  let disposed = false
  let ownsOCR = false
  let applying = false
  interface Request { current: () => boolean, apply: (ids: string[]) => void }
  let request: Request | null = null
  const active = shallowRef<Request | null>(null)
  const externalBusy = () => options.busy.value || (options.ocrRunning.value && !ownsOCR)

  function invalidate() {
    cancelled.value = true
    request = null
    active.value = null
    rows.value = []
    warnings.value = []
    error.value = ''
  }
  function cancel() {
    invalidate()
    status.value = '中止しました。実行中のOCRが終了するまでお待ちください。'
  }
  watchEffect(() => {
    if (active.value && !applying && !active.value.current()) {
      invalidate()
      status.value = '対象が変更されました。現在の領域で再解析してください。'
    }
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    invalidate()
    cache.clear()
  })

  async function analyze() {
    if (disposed || running.value || externalBusy())
      return
    invalidate()
    cancelled.value = false
    error.value = ''
    warnings.value = []
    const file = runtime.cardSourceFile.value
    if (!file) {
      error.value = '元画像を開いてください。'
      return
    }
    const id = currentImageId.value
    const generation = runtime.projectGeneration.value
    const originalProject = editor.project.value
    const before = JSON.parse(JSON.stringify(originalProject)) as CardProject
    const sourceCard = JSON.parse(JSON.stringify({ ...card.value, regions: before.regions })) as FolderProjectCard
    const discovery = JSON.parse(JSON.stringify(store.assetDiscovery ?? { occurrences: [], groups: [] })) as AssetDiscoveryState
    const assets = JSON.parse(JSON.stringify(store.assets)) as ImageAsset[]
    const candidateSnapshot = JSON.stringify(sourceCard.ocrCandidates ?? [])
    const signature = () => JSON.stringify([store.assetDiscovery, store.assets, card.value])
    const initial = signature()
    const used = new Set([...discovery.occurrences.filter((item: { cardId: string }) => item.cardId === id).flatMap((item: { assetId: string | null }) => item.assetId ? [item.assetId] : []), ...before.regions.flatMap(region => (region.sourceIcons ?? []).map(icon => icon.assetId))])
    const sources = [...used].map(assetId => ({ id: assetId, blob: runtime.pendingAssetWrites.value.get(assetId) ?? runtime.assetFiles.value.get(assetId) }))
    let stale = false
    const current = () => {
      stale ||= disposed || cancelled.value || externalBusy() || runtime.projectGeneration.value !== generation
        || currentImageId.value !== id || runtime.cardSourceFile.value !== file || editor.project.value !== originalProject
        || JSON.stringify(editor.project.value) !== JSON.stringify(before) || signature() !== initial
        || sources.some(source => source.blob !== (runtime.pendingAssetWrites.value.get(source.id) ?? runtime.assetFiles.value.get(source.id)))
        || options.pendingDeletionIds.value.has(id)
      return !stale
    }
    const pending = {
      current,
      apply(ids: string[]) {
        if (!current() || new Set(ids).size !== ids.length || !ids.length)
          throw new Error('確認結果が古いか、選択が不正です。再解析してください。')
        const chosen = rows.value.filter(row => ids.includes(row.region.id))
        if (chosen.length !== ids.length || chosen.some(row => row.error))
          throw new Error('反映できる領域だけを選択してください。')
        const beforeCandidates = JSON.parse(candidateSnapshot)
        const removed = new Set(chosen.flatMap(row => row.candidateId ? [row.candidateId] : []))
        const afterCandidates = beforeCandidates.filter((candidate: { id: string }) => !removed.has(candidate.id))
        applying = true
        try {
          editor.applyIconAnalysis(before, chosen.map(row => row.region), beforeCandidates, afterCandidates, store.document ? id : null)
        }
        finally { applying = false }
      },
    }
    request = pending
    active.value = pending
    running.value = true
    ownsOCR = true
    options.ocrRunning.value = true
    status.value = '元画像とアセットを照合しています…'
    let bitmap: ImageBitmap | undefined
    try {
      const imageDigest = await cache.digest(file)
      if (!current())
        return
      const assetDigests = new Map<string, string>()
      for (const source of sources) {
        if (source.blob)
          assetDigests.set(source.id, await cache.digest(source.blob))
        if (!current())
          return
      }
      bitmap = await createImageBitmap(file)
      if (!current())
        return
      assertImageDimensions(bitmap.width, bitmap.height)
      if (bitmap.width !== sourceCard.imageWidth || bitmap.height !== sourceCard.imageHeight)
        throw new Error('元画像の寸法が変わっています。画像を開き直してください。')
      const result = await analyzeIconRegions({ card: sourceCard, discovery, assets, image: bitmap, imageDigest, assetDigests, provider: options.provider, isCurrent: current, status: (value) => {
        if (current())
          status.value = value
      } })
      if (!current())
        return
      rows.value = result.rows
      warnings.value = result.warnings
      status.value = result.rows.length ? '変更案を確認してください。小さなはみ出しは枠の拡張案に含めます。訳文は保持します。反映するまで編集内容は変わりません。' : '反映する変更案はありません。必要ならアイコン候補の収集・割当や領域を確認してください。'
    }
    catch (cause) {
      if (current())
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      bitmap?.close()
      options.ocrRunning.value = false
      ownsOCR = false
      running.value = false
    }
  }
  function apply(ids: string[]) {
    if (running.value || externalBusy())
      return false
    error.value = ''
    try {
      if (!request)
        throw new Error('解析し直してください。')
      request.apply(ids)
      invalidate()
      status.value = '位置と原文を反映しました。プロジェクト保存後、まとめて翻訳へ進めます。通常の「元に戻す」1回で戻せます。'
      return true
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    }
  }
  return { card, running, cancelled, error, status, rows, warnings, analyze, apply, cancel }
}
