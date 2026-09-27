import type { Ref } from 'vue'
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { useQuickRegionApply } from './useQuickRegionApply'
import type { RegionOCRMode } from '~/services/asset-discovery/analyze-regions'
import type { RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { EditorTabView } from '~/types/editor-view'
import { computed, ref, watch } from 'vue'

interface FlowOptions {
  discovery: DiscoveryWorkspaceOptions
  quickApply: ReturnType<typeof useQuickRegionApply>
  discoveryWorking: Ref<boolean>
  iconAnalysisOpen: Ref<boolean>
  switchView: (view: EditorTabView) => void
  selectRegion: (cardId: string, regionId: string) => Promise<void>
  setMessage: (message: string) => void
}

/** 対象カード選択と結果からの修正導線。OCR実行・保存・履歴は既存の所有者へ委譲する。 */
export function useRegionApplyFlow({ discovery, quickApply, discoveryWorking, iconAnalysisOpen, switchView, selectRegion, setMessage }: FlowOptions) {
  const { runtime, currentImageId, store } = discovery
  const batchAutoApply = ref(true)
  const operation = ref<RegionOCRMode>('detect')
  const selections = ref<Partial<Record<RegionOCRMode, string[]>>>({})
  const focusedCardId = ref('')
  const resultsVisited = ref(false)
  const returningToResults = ref(false)
  const applyTargetIds = computed({
    get: () => selections.value[operation.value] ?? null,
    set: (ids: string[] | null) => { selections.value[operation.value] = ids ?? [] },
  })
  const applyResultsOpen = ref(false)
  const iconAnalysisRegionId = ref<string | undefined>()
  const discoveryFocus = ref<{ id: string, request: number } | null>(null)
  const busy = () => discovery.ocrRunning.value || discovery.busy.value || discoveryWorking.value
  watch(runtime.projectGeneration, () => {
    selections.value = {}
    focusedCardId.value = ''
    applyResultsOpen.value = false
    discoveryFocus.value = null
    iconAnalysisOpen.value = false
    iconAnalysisRegionId.value = undefined
    resultsVisited.value = false
    returningToResults.value = false
    operation.value = 'detect'
  })
  function openApplyTargets(ids?: string[], mode: RegionOCRMode = 'detect') {
    if (busy())
      return
    focusedCardId.value = ''
    const eligible = quickApply.eligible.value
    operation.value = mode
    const available = eligible.filter(card => mode === 'reocr' ? card.regions.length > 0 : true)
    const selected = ids ?? selections.value[mode] ?? available.filter(card => mode === 'reocr' || !card.regions.length).map(card => card.id)
    applyTargetIds.value = selected.filter(id => available.some(card => card.id === id))
    applyResultsOpen.value = false
    switchView('ocr')
  }
  function focusCard(id: string) {
    focusedCardId.value = id
  }
  function openApplyResults() {
    if (!busy()) {
      resultsVisited.value = true
      applyResultsOpen.value = true
      returningToResults.value = false
      switchView('ocr')
    }
  }
  async function applyTargetCards(ids: string[], addCandidates = false) {
    if (busy())
      return
    applyTargetIds.value = [...ids]
    applyResultsOpen.value = false
    batchAutoApply.value = true
    switchView('ocr')
    const generation = runtime.projectGeneration.value
    await quickApply.start(ids, operation.value, addCandidates)
    if (generation !== runtime.projectGeneration.value)
      return
    resultsVisited.value = true
    applyResultsOpen.value = true
  }
  async function navigate(cardId: string) {
    if (busy() || !quickApply.eligible.value.some(card => card.id === cardId))
      return false
    const generation = runtime.projectGeneration.value
    await discovery.selectCard(cardId)
    return currentImageId.value === cardId && generation === runtime.projectGeneration.value && !busy()
  }
  async function previewCard(cardId: string, regionId?: string) {
    if (!await navigate(cardId))
      return
    applyResultsOpen.value = false
    returningToResults.value = resultsVisited.value
    switchView('card')
    iconAnalysisRegionId.value = regionId
    iconAnalysisOpen.value = true
  }
  async function resolveApplyIssue(cardId: string, issue: RegionApplyIssue, target: 'region' | 'discovery' | 'preview') {
    if (target === 'preview') {
      await previewCard(cardId, issue.regionId)
      return
    }
    if (!await navigate(cardId))
      return
    applyResultsOpen.value = false
    returningToResults.value = resultsVisited.value
    if (target === 'discovery' && issue.occurrenceId) {
      if (!store.assetDiscovery?.occurrences.some(item => item.id === issue.occurrenceId && item.cardId === cardId)) {
        setMessage('このアイコン候補は変更済みです。必要なら再反映してください。')
        return
      }
      switchView('discovery')
      discoveryFocus.value = { id: issue.occurrenceId, request: (discoveryFocus.value?.request ?? 0) + 1 }
    }
    else {
      switchView('card')
      if (issue.regionId)
        await selectRegion(cardId, issue.regionId)
    }
  }
  return { focusCard, focusedCardId, operation, resultsVisited, returningToResults, batchAutoApply, applyTargetIds, applyResultsOpen, iconAnalysisRegionId, discoveryFocus, openApplyTargets, openApplyResults, applyTargetCards, previewCard, resolveApplyIssue }
}
