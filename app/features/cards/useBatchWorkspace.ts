import type { Ref } from 'vue'
import type { useQuickRegionApply } from './useQuickRegionApply'
import type { useRegionApplyFlow } from './useRegionApplyFlow'
import type { useTranslationReview } from '~/composables/useTranslationReview'
import type { EditorTabView, EditorView } from '~/types/editor-view'
import { computed, ref, watch } from 'vue'

type Review = ReturnType<typeof useTranslationReview>
interface Options {
  currentView: Ref<EditorView>
  projectGeneration: Ref<number>
  ocrRunning: Ref<boolean>
  projectBusy: Readonly<Ref<boolean>>
  isDemo: Ref<boolean>
  translationReview: Review['translationReview']
  translationReviewCards: Review['translationReviewCards']
  openTranslationReview: Review['openTranslationReview']
  regionOCRFlow: ReturnType<typeof useRegionApplyFlow>
  quickRegionApply: ReturnType<typeof useQuickRegionApply>
  switchView: (view: EditorTabView) => void
  selectProjectCard: (id: string) => Promise<void>
  selectProjectRegion: (cardId: string, regionId: string) => Promise<void>
}

/** 一括作業の対象選択と閲覧を分離し、編集画面との往復状態を所有する。 */
export function useBatchWorkspace({ currentView, projectGeneration, ocrRunning, projectBusy, isDemo, translationReview, translationReviewCards, openTranslationReview, regionOCRFlow, quickRegionApply, switchView, selectProjectCard, selectProjectRegion }: Options) {
  const batchTranslationBusy = ref(false)
  const batchTranslationTargets = ref<string[]>([])
  const batchTranslationFocus = ref('')
  const translationReturn = ref(false)
  watch(translationReview, (review) => {
    if (!review)
      return
    batchTranslationTargets.value = review.cards.filter(card => card.regions.length).map(card => card.id)
    batchTranslationFocus.value = ''
    switchView('translation')
  })
  watch(projectGeneration, () => {
    translationReview.value = null
    batchTranslationTargets.value = []
    batchTranslationFocus.value = ''
    batchTranslationBusy.value = false
    translationReturn.value = false
  })
  function openBatchTranslation() {
    if (batchTranslationBusy.value || ocrRunning.value || projectBusy.value)
      return
    if (!translationReview.value)
      openTranslationReview(undefined, false, isDemo.value)
    else switchView('translation')
  }
  const batchSelection = computed(() => {
    if (currentView.value === 'ocr') {
      return {
        ids: regionOCRFlow.applyTargetIds.value ?? [],
        eligibleIds: quickRegionApply.eligible.value.filter(card => regionOCRFlow.operation.value === 'detect' || card.regions.length).map(card => card.id),
        focusedId: regionOCRFlow.focusedCardId.value,
        operation: regionOCRFlow.operation.value,
        detection: regionOCRFlow.operation.value === 'detect',
        busy: ocrRunning.value || projectBusy.value,
      }
    }
    if (currentView.value === 'translation') {
      return {
        ids: batchTranslationTargets.value,
        eligibleIds: translationReviewCards.value.filter(card => card.regions.length).map(card => card.id),
        focusedId: batchTranslationFocus.value,
        operation: 'translate' as const,
        detection: false,
        busy: batchTranslationBusy.value || projectBusy.value,
      }
    }
    return undefined
  })
  watch(() => batchSelection.value?.eligibleIds.join(','), () => {
    const selection = batchSelection.value
    if (!selection || selection.busy)
      return
    const valid = selection.ids.filter(id => selection.eligibleIds.includes(id))
    if (valid.length !== selection.ids.length)
      selectBatchTargets(valid)
  })
  function selectBatchTargets(ids: string[]) {
    const selection = batchSelection.value
    if (!selection || selection.busy)
      return
    const valid = ids.filter(id => selection.eligibleIds.includes(id))
    if (currentView.value === 'ocr')
      regionOCRFlow.applyTargetIds.value = valid
    else batchTranslationTargets.value = valid
  }
  function browseBatchCard(id: string) {
    if (batchSelection.value?.busy)
      return
    if (currentView.value === 'ocr')
      regionOCRFlow.focusedCardId.value = id
    else if (currentView.value === 'translation')
      batchTranslationFocus.value = id
    else void selectProjectCard(id)
  }
  async function editTranslationCard(cardId: string, regionId: string) {
    if (batchTranslationBusy.value)
      return
    const generation = projectGeneration.value
    await selectProjectRegion(cardId, regionId)
    if (generation !== projectGeneration.value)
      return
    translationReturn.value = true
    switchView('card')
  }
  return { batchTranslationBusy, batchTranslationTargets, batchTranslationFocus, translationReturn, openBatchTranslation, batchSelection, selectBatchTargets, browseBatchCard, editTranslationCard }
}
