import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { CardApplyIssues, RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { CardProject, FolderProjectCard, ImageAsset } from '~/types/editor'
import { computed, onScopeDispose, ref, shallowRef, watch, watchEffect } from 'vue'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const projectOf = (card: CardProject): CardProject => ({ imageName: card.imageName, imageWidth: card.imageWidth, imageHeight: card.imageHeight, regions: card.regions })

/** 確実な対応は確認ダイアログなしで適用する。失敗箇所は保持し、各カードのUndoで戻す。 */
export function useQuickRegionApply(options: DiscoveryWorkspaceOptions, setMessage: (message: string) => void) {
  const { store, runtime, editor } = options
  const running = ref(false)
  const cancelled = ref(false)
  const completed = ref(0)
  const total = ref(0)
  const status = ref('')
  const states = shallowRef(new Map<string, OCRQueueCardState>())
  const issues = shallowRef<CardApplyIssues[]>([])
  const digestCache = createImageDigestCache()
  let disposed = false
  let applying = false
  const activeRequest = shallowRef<(() => boolean) | null>(null)
  watchEffect(() => {
    const request = activeRequest.value
    if (!applying)
      request?.()
  }, { flush: 'sync' })
  const cards = computed<FolderProjectCard[]>(() => store.document?.cards ?? [{ ...store.draftCard, id: options.currentImageId.value, imagePath: '', sourceDpi: null, printArea: null, ocrCandidates: store.draftOCRCandidates }])
  const eligible = computed(() => cards.value.filter(card => !options.pendingDeletionIds.value.has(card.id)))
  const state = (id: string, value: OCRQueueCardState) => states.value = new Map(states.value).set(id, value)
  function cancel() {
    cancelled.value = true
  }
  watch(runtime.projectGeneration, () => {
    cancel()
    states.value = new Map()
    issues.value = []
    completed.value = total.value = 0
    digestCache.clear()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancel()
    digestCache.clear()
  })

  async function start(ids: readonly string[]) {
    if (disposed || running.value || options.ocrRunning.value || options.busy.value)
      return
    const targets = clone(eligible.value.filter(card => ids.includes(card.id)))
    if (!targets.length)
      return
    const generation = runtime.projectGeneration.value
    const directory = runtime.directory.value
    const selectedCard = options.currentImageId.value
    const selectedFile = runtime.cardSourceFile.value
    const previousStates = states.value
    const shared = JSON.stringify(store.assets)
    const assets = clone(store.assets) as ImageAsset[]
    const sources = new Map(assets.map(asset => [asset.id, runtime.pendingAssetWrites.value.get(asset.id) ?? runtime.assetFiles.value.get(asset.id)]))
    const validRun = () => !disposed && !cancelled.value && generation === runtime.projectGeneration.value
      && directory === runtime.directory.value && selectedCard === options.currentImageId.value
      && selectedFile === runtime.cardSourceFile.value && !options.busy.value
    running.value = options.ocrRunning.value = true
    cancelled.value = false
    completed.value = 0
    total.value = targets.length
    status.value = '領域とアイコンを解析しています…'
    states.value = new Map([...previousStates, ...targets.map(card => [card.id, { status: 'queued' }] as const)])
    try {
      for (const target of targets) {
        if (!validRun())
          break
        state(target.id, { status: 'processing' })
        const discovery = clone(store.assetDiscovery ?? { occurrences: [], groups: [] }) as AssetDiscoveryState
        const signature = () => JSON.stringify([store.assets, store.assetDiscovery, cards.value.find(card => card.id === target.id)])
        const initial = signature()
        let stale = false
        const current = () => {
          stale ||= !validRun() || options.pendingDeletionIds.value.has(target.id) || signature() !== initial
            || shared !== JSON.stringify(store.assets)
            || [...sources].some(([id, file]) => file !== (runtime.pendingAssetWrites.value.get(id) ?? runtime.assetFiles.value.get(id)))
          return !stale
        }
        activeRequest.value = current
        let bitmap: ImageBitmap | undefined
        try {
          if (JSON.stringify(cards.value.find(card => card.id === target.id)) !== JSON.stringify(target))
            throw new Error('実行開始後にカードが変更されたためスキップしました。')
          const file = target.id === selectedCard ? selectedFile : directory ? await loadFolderProjectCardImage(directory, target) : null
          if (!file)
            throw new Error('元画像を読み込めません。')
          assertFileSize(file, FILE_LIMITS.imageBytes, target.imageName)
          const imageDigest = await digestCache.digest(file)
          const assetDigests = new Map<string, string>()
          const used = new Set([...discovery.occurrences.filter(item => item.cardId === target.id).flatMap(item => item.assetId ? [item.assetId] : []), ...target.regions.flatMap(region => (region.sourceIcons ?? []).map(icon => icon.assetId))])
          for (const id of used) {
            const file = sources.get(id)
            if (file)
              assetDigests.set(id, await digestCache.digest(file))
            if (!current())
              break
          }
          if (!current())
            throw new Error('処理中に対象が変更されたため反映していません。')
          bitmap = await createImageBitmap(file)
          assertImageDimensions(bitmap.width, bitmap.height)
          if (bitmap.width !== target.imageWidth || bitmap.height !== target.imageHeight)
            throw new Error('元画像の寸法が変わっています。')
          const result = await analyzeIconRegions({ card: target, discovery, assets, image: bitmap, imageDigest, assetDigests, provider: options.provider, preserveEditedText: true, isCurrent: current, status: (value) => {
            if (current())
              status.value = `${completed.value + 1}/${targets.length} ${target.imageName}: ${value}`
          } })
          if (!current())
            throw new Error('処理中に対象が変更されたため反映していません。')
          // 新規領域のアイコンOCRだけ失敗した場合は、検出時の原文・枠で追加する。
          // 既存領域で対応が曖昧な場合は、原文・枠・手動アイコンを一切変更しない。
          const chosen = result.rows.filter(row => !row.error || !row.before).map(row => row.error
            ? { ...row, region: { ...row.region, ...row.boundsBefore, sourceIcons: [] }, iconCount: 0 }
            : row)
          const consumed = new Set(chosen.flatMap(row => row.candidateId ? [row.candidateId] : []))
          const beforeCandidates = target.ocrCandidates ?? []
          applying = true
          try {
            if (chosen.length || JSON.stringify(result.candidates) !== JSON.stringify(beforeCandidates))
              editor.applyIconAnalysisToCard(projectOf(target), chosen.map(row => row.region), beforeCandidates, result.candidates.filter(candidate => !consumed.has(candidate.id)), store.document ? target.id : null)
          }
          finally { applying = false }
          const details: RegionApplyIssue[] = [
            ...result.issues ?? result.warnings.map(message => ({ message })),
            ...result.rows.filter(row => row.error).map(row => ({ message: `${row.region.displayName}: ${row.error}`, regionId: row.region.id, preview: row.needsTextReview })),
          ]
          const messages = details.map(issue => issue.message)
          issues.value = [
            ...issues.value.filter(issue => issue.cardId !== target.id),
            ...messages.length ? [{ cardId: target.id, cardName: target.imageName, messages, details }] : [],
          ]
          state(target.id, { status: 'applied', regions: chosen.length, icons: chosen.reduce((sum, row) => sum + row.iconCount, 0), issues: messages.length })
        }
        catch (error) {
          if (!validRun())
            break
          const message = error instanceof Error ? error.message : String(error)
          state(target.id, { status: 'error', message })
          issues.value = [...issues.value.filter(issue => issue.cardId !== target.id), { cardId: target.id, cardName: target.imageName, messages: [message] }]
        }
        finally {
          activeRequest.value = null
          bitmap?.close()
        }
        completed.value++
      }
    }
    finally {
      running.value = false
      options.ocrRunning.value = false
      if (!disposed && generation === runtime.projectGeneration.value) {
        states.value = new Map([...states.value].flatMap(([id, value]) => {
          const retained = value.status === 'queued' || value.status === 'processing' ? previousStates.get(id) : value
          return retained ? [[id, retained] as const] : []
        }))
        status.value = `${completed.value}/${total.value}枚処理${completed.value < total.value ? '（中止）' : '完了'}${issues.value.length ? `・要確認${issues.value.length}枚` : ''}。各領域で修正できます。`
        setMessage(status.value)
      }
    }
  }
  return { running, cancelled, completed, total, status, states, issues, eligible, start, cancel }
}
