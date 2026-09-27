import type { RegionProposalChoice } from '../../../app/services/asset-discovery/region-proposal'
import type { RegionCandidate } from '../../../app/types/ocr'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { computed, effectScope, ref } from 'vue'
import { useCardEditor } from '../../../app/composables/useCardEditor'
import { useProjectRuntime } from '../../../app/composables/useProjectRuntime'
import { useCandidateReview } from '../../../app/features/cards/useCandidateReview'
import { useRegionDetectionReview } from '../../../app/features/cards/useRegionDetectionReview'
import { detectFileRegions } from '../../../app/services/ocr/detect-file-regions'
import { TesseractOCRProvider } from '../../../app/services/ocr/tesseract'
import { serializeFolderProject } from '../../../app/services/project/format'
import { useProjectStore } from '../../../app/stores/project'
import { baselineProject } from '../../fixtures/refactoring-baseline'

/** Dev-server-only browser fixture. It never changes the mounted app's project. */
export async function runRegionReviewScenario() {
  const previousPinia = getActivePinia()
  const store = useProjectStore(createPinia())
  const scope = effectScope()
  const runtime = useProjectRuntime()
  const provider = new TesseractOCRProvider('/')
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 700
  try {
    const context = canvas.getContext('2d')!
    context.fillStyle = '#203030'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#eeeeee'
    context.font = '32px serif'
    context.fillText('Choose an ally.', 60, 110)
    context.fillText('Draw two cards.', 60, 340)
    context.fillText('Gain three tokens.', 60, 570)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
    runtime.cardSourceFile.value = new File([png], 'synthetic.png', { type: 'image/png' })
    const project = baselineProject()
    project.cards[0]!.imageWidth = canvas.width
    project.cards[0]!.imageHeight = canvas.height
    project.cards[0]!.ocrCandidates = [{ id: 'existing-candidate', x: 40, y: 285, width: 470, height: 100, text: 'Keep candidate text', confidence: 42, selected: false, lines: [] }]
    store.replaceProject(project)
    const cardId = ref(project.activeCardId)
    let progressCount = 0
    let cancelAfterOCR = false
    let review!: ReturnType<typeof useRegionDetectionReview>
    const state = scope.run(() => {
      const editor = useCardEditor((id, card) => store.updateCard(id, card), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
      editor.loadSavedProject(store.activeCard, cardId.value)
      editor.addRegion({ x: 40, y: 55, width: 470, height: 100 }, '#203030')
      const regionId = editor.selectedRegionId.value!
      editor.updateRegion(regionId, { originalText: 'Keep original text', translatedText: '既存の訳', translationStatus: 'reviewed' })
      editor.loadSavedProject(editor.project.value, cardId.value)
      const displayed = ref<RegionCandidate[]>([])
      const candidateHistory = ref<RegionCandidate[][]>([])
      const candidateReview = useCandidateReview({
        currentImageId: cardId,
        activeProjectCard: computed(() => store.document!.cards[0]!),
        regionCandidates: displayed,
        selectedCandidateId: ref(null),
        regionCandidateEditHistory: candidateHistory,
        cardPreviewMode: ref('original'),
        batchOCRResults: computed(() => new Map([[cardId.value, store.document!.cards[0]!.ocrCandidates ?? []]])),
        batchOCRStates: computed(() => new Map()),
        editor,
        updateBatchOCRResult: store.setCardOCRCandidates,
        finishBatchOCRReview: () => {},
        clearRegionCandidates: () => {},
        promoteDiscoveryOwners: store.reconcileDiscoveryOwners,
        switchInspectorTab: () => {},
        backgroundColorForBounds: () => '#203030',
        setMessage: () => {},
        logDiagnostic: () => {},
      })
      candidateReview.showBatchOCRCandidates(cardId.value)
      review = useRegionDetectionReview({
        editor,
        runtime,
        target: () => ({ editorCardId: cardId.value, card: store.document!.cards[0]! }),
        detect: async request => (await detectFileRegions({
          ...request,
          provider,
          onProgress: () => progressCount++,
          onRefinement: () => {
            if (cancelAfterOCR)
              review.cancel()
          },
        }))?.candidates ?? null,
      })
      return { editor, displayed, candidateHistory }
    })!
    const saved = () => serializeFolderProject(store.snapshot()!)
    const before = saved()
    const first = await review.analyze()
    if (!first)
      throw new Error('Real detection was cancelled unexpectedly')
    const untouchedBeforeApply = saved() === before && !state.editor.canUndo.value
    const choices: RegionProposalChoice[] = first.differences.flatMap((difference): RegionProposalChoice[] => {
      if (!difference.detectedId)
        return []
      if (difference.status === 'new')
        return [{ action: 'add-candidate', detectedId: difference.detectedId }]
      if (difference.status === 'changed' && difference.targets.length === 1)
        return [{ action: 'bounds', detectedId: difference.detectedId, target: difference.targets[0]! }]
      throw new Error(`Unexpected real OCR comparison: ${difference.status}`)
    })
    review.apply(first, choices)
    const after = store.snapshot()!
    const afterText = saved()
    const displayedAfterApply = JSON.parse(JSON.stringify(state.displayed.value)) as RegionCandidate[]
    state.editor.undo()
    const undoRestoredAll = saved() === before && !state.editor.canUndo.value
    const displayedAfterUndo = JSON.parse(JSON.stringify(state.displayed.value)) as RegionCandidate[]
    state.editor.redo()
    const redoRestoredAll = saved() === afterText
    const repeated = await review.analyze()
    if (!repeated)
      throw new Error('Repeated real detection was cancelled unexpectedly')
    const repeatedChoices: RegionProposalChoice[] = repeated.differences.flatMap((difference): RegionProposalChoice[] => difference.detectedId && difference.targets.length === 1
      ? [{ action: 'bounds', detectedId: difference.detectedId, target: difference.targets[0]! }]
      : [])
    review.apply(repeated, repeatedChoices)
    const noDuplicateOrTextChanges = saved() === afterText
    cancelAfterOCR = true
    const cancelled = await review.analyze()
    return {
      imageDigest: first.imageDigest,
      texts: first.candidates.map(candidate => candidate.text),
      differences: first.differences,
      choices,
      untouchedBeforeApply,
      after,
      displayedAfterApply,
      displayedAfterUndo,
      undoRestoredAll,
      redoRestoredAll,
      repeatedStatuses: repeated.differences.map(difference => difference.status),
      noDuplicateOrTextChanges,
      cancelledWithoutWrite: cancelled === null && review.review.value === null && !review.running.value && saved() === afterText,
      progressCount,
    }
  }
  finally {
    scope.stop()
    runtime.dispose()
    store.$dispose()
    setActivePinia(previousPinia)
    canvas.width = canvas.height = 1
    await provider.dispose()
  }
}
