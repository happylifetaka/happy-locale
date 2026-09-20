import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { RegionCandidate } from '~/services/ocr/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { resolveSampleCandidates } from '~/services/project/sample'
import { baselineProject } from '../../../tests/fixtures/refactoring-baseline'
import { useCandidateReview } from './useCandidateReview'

vi.mock('~/services/project/sample', () => ({ resolveSampleCandidates: vi.fn(() => null) }))
beforeEach(() => vi.mocked(resolveSampleCandidates).mockReset().mockReturnValue(null))

function candidate(selected = true): RegionCandidate {
  const line = { text: 'Choose an ally.', x: 10, y: 20, width: 80, height: 20, confidence: 90 }
  return { ...line, id: selected ? 'keep' : 'skip', selected, lines: [{ ...line }] }
}

function setup() {
  const stored = [candidate(), candidate(false)]
  const regionCandidates = ref<RegionCandidate[]>([])
  const selectedCandidateId = ref<string | null>('old')
  const regionCandidateEditHistory = ref<RegionCandidate[][]>([[candidate()]])
  const currentImageId = ref('synthetic-1')
  const cardPreviewMode = ref<'edited' | 'original'>('edited')
  const editor = useCardEditor()
  editor.loadImageProject('synthetic.png', 200, 240)
  editor.selectedRegionId.value = 'old'
  const events: string[] = []
  const options = {
    currentImageId,
    activeProjectCard: ref(baselineProject().cards[0]!),
    regionCandidates,
    selectedCandidateId,
    regionCandidateEditHistory,
    cardPreviewMode,
    batchOCRResults: ref(new Map([['synthetic-1', stored]])),
    batchOCRStates: ref(new Map<string, OCRQueueCardState>([['synthetic-1', { status: 'review', candidates: 2 }]])),
    editor,
    updateBatchOCRResult: vi.fn(),
    finishBatchOCRReview: vi.fn(() => events.push('finish')),
    clearRegionCandidates: vi.fn(() => {
      events.push('clear')
      regionCandidates.value = []
      selectedCandidateId.value = null
      regionCandidateEditHistory.value = []
      cardPreviewMode.value = 'edited'
    }),
    switchInspectorTab: vi.fn(),
    backgroundColorForBounds: vi.fn(() => '#123456'),
    setMessage: vi.fn(),
    logDiagnostic: vi.fn(),
  }
  return { ...options, stored, events, review: useCandidateReview(options) }
}

describe('candidate review operations', () => {
  it('restores an independent working copy and persists using the current card ID', () => {
    const s = setup()
    expect(s.review.showBatchOCRCandidates('missing')).toBe(false)
    expect(s.selectedCandidateId.value).toBe('old')
    expect(s.review.showBatchOCRCandidates('synthetic-1')).toBe(true)
    expect(s.regionCandidates.value).toEqual(s.stored)
    expect(s.selectedCandidateId.value).toBeNull()
    expect(s.editor.selectedRegionId.value).toBeNull()
    expect(s.regionCandidateEditHistory.value).toEqual([])
    expect(s.cardPreviewMode.value).toBe('original')
    s.regionCandidates.value[0]!.lines[0]!.text = 'Adjusted line'
    expect(s.stored[0]!.lines[0]!.text).toBe('Choose an ally.')
    s.currentImageId.value = 'synthetic-2'
    s.review.persistDisplayedBatchCandidates()
    expect(s.updateBatchOCRResult).toHaveBeenCalledWith('synthetic-2', s.regionCandidates.value)
  })

  it('confirms selected candidates as one undoable operation before advancing review', () => {
    const s = setup()
    s.review.showBatchOCRCandidates('synthetic-1')
    s.review.confirmRegionCandidates()
    expect(s.editor.project.value.regions).toHaveLength(1)
    expect(s.editor.project.value.regions[0]).toMatchObject({ x: 10, y: 20, width: 80, height: 20, backgroundColor: '#123456', originalText: 'Choose an ally.' })
    expect(s.backgroundColorForBounds).toHaveBeenCalledOnce()
    expect(s.events).toEqual(['clear', 'finish'])
    expect(s.finishBatchOCRReview).toHaveBeenCalledWith('synthetic-1')
    s.editor.undo()
    expect(s.editor.project.value.regions).toEqual([])
  })

  it('keeps candidates when nothing is selected or sample resolution fails', () => {
    const s = setup()
    s.regionCandidates.value = [candidate(false)]
    s.review.confirmRegionCandidates()
    expect(s.setMessage).toHaveBeenCalledWith('追加する領域候補を選択してください。')
    s.regionCandidates.value = [candidate()]
    vi.mocked(resolveSampleCandidates).mockImplementationOnce(() => {
      throw new Error('invalid sample')
    })
    s.review.confirmRegionCandidates()
    expect(s.setMessage).toHaveBeenLastCalledWith('invalid sample')
    expect(s.regionCandidates.value).toHaveLength(1)
    expect(s.editor.project.value.regions).toEqual([])
    expect(s.events).toEqual([])
  })

  it('clears candidates without changing confirmed regions, and only advances review cards', () => {
    const s = setup()
    s.review.showBatchOCRCandidates('synthetic-1')
    s.review.discardRegionCandidates()
    expect(s.events).toEqual(['clear', 'finish'])
    expect(s.editor.project.value.regions).toEqual([])
    s.events.length = 0
    s.currentImageId.value = 'draft'
    s.regionCandidates.value = [candidate()]
    s.review.discardRegionCandidates()
    expect(s.events).toEqual(['clear'])
  })
})
