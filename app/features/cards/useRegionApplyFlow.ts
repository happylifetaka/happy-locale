import type { Ref } from 'vue'
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { useQuickRegionApply } from './useQuickRegionApply'
import type { RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { EditorTabView } from '~/types/editor-view'
import { ref, watch } from 'vue'

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
  const applyTargetIds = ref<string[] | null>(null)
  const iconAnalysisRegionId = ref<string | undefined>()
  const discoveryFocus = ref<{ id: string, request: number } | null>(null)
  const busy = () => discovery.ocrRunning.value || discovery.busy.value || discoveryWorking.value
  watch(runtime.projectGeneration, () => {
    applyTargetIds.value = null
    discoveryFocus.value = null
    iconAnalysisOpen.value = false
    iconAnalysisRegionId.value = undefined
  })
  function openApplyTargets(ids?: string[]) {
    if (busy())
      return
    const eligible = quickApply.eligible.value
    const selected = ids ?? eligible.filter(card => !card.regions.length).map(card => card.id)
    applyTargetIds.value = (selected.length ? selected : [currentImageId.value]).filter(id => eligible.some(card => card.id === id))
  }
  async function applyTargetCards(ids: string[]) {
    if (busy())
      return
    applyTargetIds.value = null
    batchAutoApply.value = true
    switchView('card')
    await quickApply.start(ids)
  }
  async function navigate(cardId: string) {
    if (busy() || !quickApply.eligible.value.some(card => card.id === cardId))
      return false
    const generation = runtime.projectGeneration.value
    await discovery.selectCard(cardId)
    return currentImageId.value === cardId && generation === runtime.projectGeneration.value && !busy()
  }
  async function previewCard(cardId: string, regionId?: string) {
    applyTargetIds.value = null
    if (!await navigate(cardId))
      return
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
    if (target === 'discovery' && issue.occurrenceId) {
      if (!store.assetDiscovery?.occurrences.some(item => item.id === issue.occurrenceId && item.cardId === cardId)) {
        setMessage('このアイコン候補は変更済みです。必要なら再反映してください。')
        return
      }
      switchView('discovery')
      discoveryFocus.value = { id: issue.occurrenceId, request: (discoveryFocus.value?.request ?? 0) + 1 }
    }
    else if (issue.regionId) {
      switchView('card')
      await selectRegion(cardId, issue.regionId)
    }
  }
  return { batchAutoApply, applyTargetIds, iconAnalysisRegionId, discoveryFocus, openApplyTargets, applyTargetCards, previewCard, resolveApplyIssue }
}
