import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { IconRegionRow, RegionOCRMode } from '~/services/asset-discovery/analyze-regions'
import type { CardApplyIssues, RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { CardProject, FolderProjectCard, ImageAsset } from '~/types/editor'
import { computed, onScopeDispose, ref, shallowRef, watch, watchEffect } from 'vue'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { applyIssueCounts } from '~/services/asset-discovery/apply-issues'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { intersectionArea } from '~/services/asset-discovery/geometry'
import { detectRegions } from '~/services/ocr/detect-regions'
import { mergeDetectedCandidates } from '~/services/ocr/merge-detected-candidates'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { resolveSampleCandidates, sampleRegionCandidates } from '~/services/project/sample'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const projectOf = (card: CardProject): CardProject => ({ imageName: card.imageName, imageWidth: card.imageWidth, imageHeight: card.imageHeight, regions: card.regions })

/** 検出は候補を保存し、明示採用と再OCRは原文保護付きで適用する。各カードのUndoを保持する。 */
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

  async function start(ids: readonly string[], mode?: RegionOCRMode, addCandidates = false) {
    if (disposed || running.value || options.ocrRunning.value || options.busy.value)
      return
    const targets = clone(eligible.value.filter(card => ids.includes(card.id) && (!addCandidates || card.ocrCandidates?.some(candidate => candidate.selected)) && (mode !== 'reocr' || card.regions.length > 0)))
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
          if (mode === 'detect' && !addCandidates) {
            const detection = store.document?.demoPreset === 'sample-v1'
              ? { candidates: sampleRegionCandidates(target) }
              : await detectRegions({ image: bitmap, imageWidth: target.imageWidth, imageHeight: target.imageHeight, provider: options.provider, isCurrent: current, onProgress: (progress) => {
                  if (current())
                    status.value = progress.status
                } })
            if (!current() || !detection)
              throw new Error('検出を中止したか、対象が変更されました。')
            const before = target.ocrCandidates ?? []
            const after = mergeDetectedCandidates(before, detection.candidates, target.regions)
            applying = true
            try {
              editor.applyIconAnalysisToCard(projectOf(target), [], before, after, store.document ? target.id : null, true)
            }
            finally { applying = false }
            issues.value = issues.value.filter(issue => issue.cardId !== target.id)
            state(target.id, { status: 'review', candidates: after.length })
            completed.value++
            continue
          }
          const selectedCandidates = (target.ocrCandidates ?? []).filter(candidate => candidate.selected)
          const demoRegions = store.document?.demoPreset === 'sample-v1' && addCandidates ? resolveSampleCandidates(target, selectedCandidates) : null
          const result = demoRegions
            ? {
                rows: demoRegions.map((region, index): IconRegionRow => ({ region, before: null, candidateId: selectedCandidates[index]!.id, iconCount: region.sourceIcons?.length ?? 0 })),
                candidates: target.ocrCandidates ?? [],
                warnings: [],
                issues: [],
              }
            : await analyzeIconRegions({ mode, card: target, discovery, assets, image: bitmap, imageDigest, assetDigests, provider: options.provider, preserveEditedText: true, isCurrent: current, status: (value) => {
                if (current())
                  status.value = `${completed.value + 1}/${targets.length} ${target.imageName}: ${value}`
              } })
          if (!current())
            throw new Error('処理中に対象が変更されたため反映していません。')
          // 新規領域のアイコンOCRだけ失敗した場合は、検出時の原文・枠で追加する。
          // 既存領域で対応が曖昧な場合は、原文・枠・手動アイコンを一切変更しない。
          const occupied = [...target.regions]
          const chosen = result.rows.filter((row) => {
            if (row.error && row.before)
              return false
            if (row.before)
              return true
            if (occupied.some(region => intersectionArea(region, row.region) > 0))
              return false
            occupied.push(row.region)
            return true
          }).map(row => row.error
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
            // 対応付けの具体的な問題がある場合、同じ領域の汎用エラーを重ねて表示しない。
            ...result.rows.filter(row => row.error && (!row.blockedByIconMapping || !result.issues?.some(issue => issue.regionId === row.region.id))).map(row => ({ message: row.error!, regionId: row.region.id, preview: row.needsTextReview, sourceProtection: row.sourceProtection })),
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
        const counts = applyIssueCounts(issues.value)
        status.value = `${completed.value}/${total.value}枚処理${completed.value < total.value ? '（中止）' : '完了'}${counts.protectedCards ? `・原文保護で保留${counts.protectedCards}枚` : ''}${counts.problemCards ? `・検出・対応付けの問題${counts.problemCards}枚` : ''}。カードごとの原画像と現在の原文を照合してください。`
        setMessage(status.value)
      }
    }
  }
  function selectCandidates(cardId: string, ids: readonly string[], selected: boolean) {
    if (running.value || options.ocrRunning.value || options.busy.value)
      return
    const card = eligible.value.find(card => card.id === cardId)
    if (!card)
      return
    const before = clone(card.ocrCandidates ?? [])
    const after = before.map(candidate => ids.includes(candidate.id) ? { ...candidate, selected } : candidate)
    store.setCardOCRCandidates(card.id, after)
  }
  return { running, cancelled, completed, total, status, states, issues, eligible, start, cancel, selectCandidates }
}
