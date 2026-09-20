import type { RegionCandidate } from '~/types/ocr'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { cloneRegionCandidates } from '~/services/ocr/candidates'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useCandidateReview } from './useCandidateReview'

const cleanups: Array<() => void> = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
})

function setup(draft = false) {
  const store = useProjectStore()
  const document = discoveryProject()
  const original = document.cards[0]!
  const currentImageId = ref(original.id)
  if (draft) {
    const { imageName, imageWidth, imageHeight, regions } = original
    store.updateCard(null, { imageName, imageWidth, imageHeight, regions })
    store.setCardOCRCandidates(original.id, original.ocrCandidates!)
  }
  else {
    document.cards.push({ ...structuredClone(original), id: 'other-card' })
    store.replaceProject(document)
  }
  const editor = useCardEditor((id, project) => store.updateCard(id, project), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
  editor.loadSavedProject(store.activeCard, draft ? undefined : original.id)
  const regionCandidates = ref<RegionCandidate[]>([])
  const selectedCandidateId = ref<string | null>(null)
  const regionCandidateEditHistory = ref<RegionCandidate[][]>([])
  const cardPreviewMode = ref<'edited' | 'original'>('edited')
  const batchOCRResults = computed(() => new Map((store.document?.cards ?? [{ id: currentImageId.value, ocrCandidates: store.draftOCRCandidates }]).map(card => [card.id, card.ocrCandidates ?? []])))
  const write = vi.fn((id: string, candidates: readonly RegionCandidate[] | null) => store.setCardOCRCandidates(id, candidates))
  const scope = effectScope()
  const switchInspectorTab = vi.fn()
  const review = scope.run(() => useCandidateReview({
    currentImageId,
    activeProjectCard: computed(() => store.document?.cards.find(card => card.id === currentImageId.value) ?? null),
    regionCandidates,
    selectedCandidateId,
    regionCandidateEditHistory,
    cardPreviewMode,
    batchOCRResults,
    batchOCRStates: computed(() => new Map()),
    editor,
    updateBatchOCRResult: write,
    finishBatchOCRReview: vi.fn(),
    clearRegionCandidates: vi.fn(),
    promoteDiscoveryOwners: store.reconcileDiscoveryOwners,
    switchInspectorTab,
    backgroundColorForBounds: () => '#ffffff',
    setMessage: vi.fn(),
    logDiagnostic: vi.fn(),
  }))!
  cleanups.push(() => scope.stop())
  review.showBatchOCRCandidates(currentImageId.value)
  switchInspectorTab.mockClear()
  selectedCandidateId.value = 'candidate-1'
  const seedHistory = () => {
    regionCandidateEditHistory.value = [cloneRegionCandidates(regionCandidates.value)]
  }
  const saved = () => store.readCardCandidateEdit(draft ? null : currentImageId.value).candidates
  return { store, editor, currentImageId, regionCandidates, selectedCandidateId, regionCandidateEditHistory, cardPreviewMode, review, write, scope, switchInspectorTab, saved, seedHistory }
}

it.each([false, true])('synchronizes mixed application and ordinary Undo/Redo without publishing stale copies (draft=%s)', (draft) => {
  const s = setup(draft)
  s.editor.addRegion({ x: 10, y: 150, width: 180, height: 70 }, '#ffffff')
  const regionId = s.editor.selectedRegionId.value!
  const before = s.saved()
  const next = cloneRegionCandidates(before)
  next[0]!.width += 10
  next.push({ ...next[0]!, id: 'new', x: 165, y: 5, width: 20, height: 10, lines: [] })
  s.seedHistory()
  s.cardPreviewMode.value = 'edited'
  s.editor.applyRegionDetection([{ id: regionId, bounds: { x: 8, y: 148, width: 184, height: 74 } }], before, next)
  expect(s.regionCandidates.value).toEqual(next)
  expect(s.regionCandidateEditHistory.value).toEqual([])
  expect(s.selectedCandidateId.value).toBe('candidate-1')
  expect(s.cardPreviewMode.value).toBe('edited')
  expect(s.switchInspectorTab).not.toHaveBeenCalled()
  expect(s.editor.selectedRegionId.value).toBe(regionId)
  expect(s.write).not.toHaveBeenCalled()
  s.selectedCandidateId.value = 'new'
  s.seedHistory()
  s.editor.undo()
  expect(s.regionCandidates.value).toEqual(before)
  expect(s.regionCandidateEditHistory.value).toEqual([])
  expect(s.selectedCandidateId.value).toBeNull()
  s.editor.redo()
  expect(s.regionCandidates.value).toEqual(next)
  s.review.persistDisplayedBatchCandidates()
  expect(s.saved()).toEqual(next)
  if (!draft)
    expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).cards[0]!.ocrCandidates).toEqual(next)
})

it('preserves local editing history and focus when its own persisted change echoes back', () => {
  const s = setup()
  s.seedHistory()
  s.regionCandidates.value[0]!.width += 5
  const history = s.regionCandidateEditHistory.value
  const displayed = s.regionCandidates.value
  s.review.persistDisplayedBatchCandidates()
  expect(s.saved()).toEqual(displayed)
  expect(s.regionCandidates.value).toBe(displayed)
  expect(s.regionCandidateEditHistory.value).toBe(history)
  expect(s.selectedCandidateId.value).toBe('candidate-1')
  expect(s.write).toHaveBeenCalledOnce()
  s.regionCandidates.value[0]!.lines[0]!.text = 'Local only'
  expect(s.saved()[0]!.lines[0]!.text).toBe('Synthetic effect.')
})

it('keeps history for unrelated card/region edits and serialization-only changes', () => {
  const s = setup()
  s.seedHistory()
  const history = s.regionCandidateEditHistory.value
  const displayed = s.regionCandidates.value
  s.store.setCardOCRCandidates('other-card', [])
  expect(s.regionCandidateEditHistory.value).toBe(history)
  s.editor.addRegion({ x: 10, y: 150, width: 180, height: 70 }, '#ffffff')
  expect(s.regionCandidateEditHistory.value).toBe(history)
  const candidate = s.saved()[0]!
  const reverseKeys = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T
  s.store.setCardOCRCandidates(s.currentImageId.value, [{ ...reverseKeys(candidate), lines: candidate.lines.map(reverseKeys) }])
  expect(s.regionCandidates.value).toBe(displayed)
  expect(s.regionCandidateEditHistory.value).toBe(history)
  expect(s.selectedCandidateId.value).toBe('candidate-1')
  expect(s.write).not.toHaveBeenCalled()
})

it('discards history on same-tick external changes and restoration, even when the displayed values already match', () => {
  const s = setup()
  const before = s.saved()
  const changed = before.map(candidate => ({ ...candidate, selected: false }))
  s.regionCandidates.value = cloneRegionCandidates(changed)
  s.seedHistory()
  s.store.setCardOCRCandidates(s.currentImageId.value, changed)
  expect(s.regionCandidateEditHistory.value).toEqual([])
  s.store.setCardOCRCandidates(s.currentImageId.value, before)
  expect(s.regionCandidates.value).toEqual(before)
  expect(s.regionCandidateEditHistory.value).toEqual([])
  expect(s.write).not.toHaveBeenCalled()
})

it('clears focus and history when changing cards with equal candidates and never shows a different card explicitly', () => {
  const s = setup()
  s.seedHistory()
  s.currentImageId.value = 'other-card'
  expect(s.selectedCandidateId.value).toBeNull()
  expect(s.regionCandidateEditHistory.value).toEqual([])
  expect(s.regionCandidates.value).toEqual(s.saved())
  const shown = s.regionCandidates.value
  expect(s.review.showBatchOCRCandidates('synthetic-1')).toBe(false)
  expect(s.regionCandidates.value).toBe(shown)
  s.store.setCardOCRCandidates('other-card', [])
  expect(s.regionCandidates.value).toEqual([])
  expect(s.cardPreviewMode.value).toBe('original')
  expect(s.switchInspectorTab).not.toHaveBeenCalled()
})

it('does not ignore a different external update during publication and resets its guard after failures', () => {
  const s = setup()
  const changed = s.saved().map(candidate => ({ ...candidate, selected: false }))
  s.write.mockImplementationOnce((id) => {
    s.store.setCardOCRCandidates(id, changed)
  })
  s.seedHistory()
  s.review.persistDisplayedBatchCandidates()
  expect(s.regionCandidates.value).toEqual(changed)
  expect(s.regionCandidateEditHistory.value).toEqual([])
  s.write.mockImplementationOnce(() => {
    throw new Error('write failed')
  })
  expect(() => s.review.persistDisplayedBatchCandidates()).toThrow('write failed')
  s.seedHistory()
  s.store.setCardOCRCandidates(s.currentImageId.value, [])
  expect(s.regionCandidates.value).toEqual([])
  expect(s.regionCandidateEditHistory.value).toEqual([])
})

it('stops synchronizing when the review scope is disposed', () => {
  const s = setup()
  const shown = s.regionCandidates.value
  s.seedHistory()
  const history = s.regionCandidateEditHistory.value
  s.scope.stop()
  s.store.setCardOCRCandidates(s.currentImageId.value, [])
  expect(s.regionCandidates.value).toBe(shown)
  expect(s.regionCandidateEditHistory.value).toBe(history)
})
