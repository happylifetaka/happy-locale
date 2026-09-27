import type { RegionDetectionProposal, RegionProposalChoice, RegionProposalScope, RegionReviewCard } from '~/services/asset-discovery/region-proposal'
import type { RegionCandidate } from '~/types/ocr'
import { expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { adoptRegionProposal, compareRegionProposal } from '~/services/asset-discovery/region-proposal'

function candidate(id: string, y: number, patch: Partial<RegionCandidate> = {}): RegionCandidate {
  const line = { x: 30, y: y + 10, width: 180, height: 30, text: 'Detected text', confidence: 95 }
  return { ...line, id, x: 20, y, width: 200, height: 60, selected: true, lines: [line], ...patch }
}

function fixture() {
  const editor = useCardEditor()
  editor.loadImageProject('synthetic.png', 500, 700)
  editor.addRegion({ x: 20, y: 40, width: 200, height: 40 }, '#fff')
  editor.addRegion({ x: 20, y: 160, width: 260, height: 120 }, '#123456')
  editor.updateRegion(editor.selectedRegionId.value!, {
    originalText: 'Original body',
    translatedText: '既存の訳',
    translationStatus: 'reviewed',
    sourceIcons: [{ id: 'icon', assetId: 'asset', x: 20, y: 30, width: 20, height: 20 }],
    exclusionAreas: [{ id: 'protect', x: 60, y: 40, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 10, mode: 'paint', points: [{ x: 100, y: 50 }, { x: 130, y: 50 }] }],
  })
  editor.addRegion({ x: 20, y: 320, width: 200, height: 40 }, '#fff')
  const card: RegionReviewCard = { id: 'card', imageWidth: 500, imageHeight: 700, regions: structuredClone(editor.project.value.regions), ocrCandidates: [candidate('saved', 420, { selected: false, text: 'Saved candidate text', confidence: 37, sampleRegionId: 'layout-body' })] }
  card.regions.forEach((item, i) => item.id = ['name', 'body', 'missing'][i]!)
  const scope: RegionProposalScope = { imageDigest: 'a'.repeat(64), revision: 1, session: Symbol('review') }
  const proposal = { cardId: card.id, imageDigest: scope.imageDigest, imageWidth: 500, imageHeight: 700, candidates: [
    candidate('fresh-name', 40, { height: 40 }),
    candidate('fresh-body', 150, { x: 10, width: 280, height: 140 }),
    candidate('fresh-saved', 430, { x: 30, width: 180, height: 40 }),
    candidate('fresh-new', 580),
  ] } satisfies RegionDetectionProposal
  const choices: RegionProposalChoice[] = [
    { action: 'bounds', detectedId: 'fresh-body', target: { kind: 'region', id: 'body' } },
    { action: 'bounds', detectedId: 'fresh-saved', target: { kind: 'candidate', id: 'saved' } },
    { action: 'add-candidate', detectedId: 'fresh-new' },
  ]
  return { card, scope, proposal, choices }
}

it('compares mixed confirmed and unconfirmed regions and publishes an immutable independent proposal', () => {
  const s = fixture()
  const before = { card: structuredClone(s.card), proposal: structuredClone(s.proposal) }
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(review.differences.map(item => item.status)).toEqual(['unchanged', 'changed', 'changed', 'new', 'missing'])
  expect(review.differences[1]!.targets).toEqual([{ id: 'body', kind: 'region' }])
  expect(review.differences[2]!.targets).toEqual([{ id: 'saved', kind: 'candidate' }])
  expect(review.existing.find(item => item.id === 'body')!.text).toBe('Original body')
  expect(Object.isFrozen(review.candidates[0]!.lines[0])).toBe(true)
  expect(Object.isFrozen(review.differences[1]!.targets[0])).toBe(true)
  expect({ card: s.card, proposal: s.proposal }).toEqual(before)
  s.proposal.candidates[0]!.text = 'Mutated input'
  expect(review.candidates[0]!.text).toBe('Detected text')
})

it('adopts only chosen bounds and new candidates without changing IDs, text, status or absolute mask positions', () => {
  const s = fixture()
  const before = structuredClone(s.card)
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  const next = adoptRegionProposal(s.card, review, s.choices, s.scope)
  expect(next.regions).toHaveLength(3)
  expect(next.regions[0]).toEqual(before.regions[0])
  expect(next.regions[2]).toEqual(before.regions[2])
  const body = next.regions[1]!
  expect(body).toMatchObject({ id: 'body', originalText: 'Original body', translatedText: '既存の訳', translationStatus: 'reviewed', x: 10, y: 150, width: 280, height: 140 })
  expect(body.regionId).toBe(before.regions[1]!.regionId)
  expect(body.sourceIcons![0]).toMatchObject({ x: 30, y: 40, assetId: 'asset' })
  expect(body.exclusionAreas[0]).toMatchObject({ x: 70, y: 50 })
  expect(body.manualMaskStrokes[0]!.points).toEqual([{ x: 110, y: 60 }, { x: 140, y: 60 }])
  const saved = next.ocrCandidates![0]!
  expect(saved).toMatchObject({ id: 'saved', selected: false, text: 'Saved candidate text', confidence: 37, sampleRegionId: 'layout-body', x: 30, y: 430, width: 180, height: 40 })
  expect(saved.lines[0]).toMatchObject({ x: 39, width: 162, height: 20, text: 'Detected text' })
  expect(saved.lines[0]!.y).toBeCloseTo(430 + 10 * 2 / 3)
  expect(next.ocrCandidates![1]).toEqual(s.proposal.candidates[3])
  expect(s.card).toEqual(before)
  body.originalText = 'Modified output'
  expect(s.card.regions[1]!.originalText).toBe('Original body')
})

it('keeps unselected, undetected and zero-choice data intact, including optional-field absence', () => {
  const s = fixture()
  delete s.card.ocrCandidates
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(adoptRegionProposal(s.card, review, [], s.scope)).toEqual(s.card)
  expect(adoptRegionProposal(s.card, review, [], s.scope)).not.toHaveProperty('ocrCandidates')
  const next = adoptRegionProposal(s.card, review, [s.choices[0]!], s.scope)
  expect(next).not.toHaveProperty('ocrCandidates')
  expect(next.regions.slice(2)).toEqual(s.card.regions.slice(2))
  expect(next.regions.map(item => item.id)).toEqual(s.card.regions.map(item => item.id))
})

it('does not duplicate regions on repeat detection or reapply a stale result after adoption', () => {
  const s = fixture()
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  const next = adoptRegionProposal(s.card, review, s.choices, s.scope)
  expect(() => adoptRegionProposal(next, review, s.choices, s.scope)).toThrow('再比較')
  const repeated = compareRegionProposal(next, s.proposal, s.scope)
  expect(repeated.differences.map(item => item.status)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged', 'missing'])
  expect(() => adoptRegionProposal(next, repeated, [s.choices[2]!], s.scope)).toThrow('対応')
  const same = adoptRegionProposal(next, repeated, s.choices.slice(0, 2), s.scope)
  expect(same).toEqual(next)
  expect(adoptRegionProposal(same, repeated, s.choices.slice(0, 2), s.scope)).toEqual(next)
})

it.each(['original', 'translation', 'status', 'mask', 'selection', 'line', 'region-id', 'dimensions', 'digest', 'revision', 'edit-undo'] as const)('rejects stale comparison after %s changes', (kind) => {
  const s = fixture()
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  if (kind === 'original')
    s.card.regions[1]!.originalText = 'Changed'
  if (kind === 'translation')
    s.card.regions[1]!.translatedText = '修正'
  if (kind === 'status')
    s.card.regions[1]!.translationStatus = 'draft'
  if (kind === 'mask')
    s.card.regions[1]!.manualMaskStrokes[0]!.points[0]!.x++
  if (kind === 'selection')
    s.card.ocrCandidates![0]!.selected = true
  if (kind === 'line')
    s.card.ocrCandidates![0]!.lines[0]!.text = 'Changed line'
  if (kind === 'region-id')
    s.card.regions[1]!.id = 'renamed'
  if (kind === 'dimensions')
    s.card.imageWidth++
  if (kind === 'digest')
    s.scope.imageDigest = 'b'.repeat(64)
  if (kind === 'revision' || kind === 'edit-undo')
    s.scope.revision++
  const before = structuredClone(s.card)
  expect(() => adoptRegionProposal(s.card, review, s.choices, s.scope)).toThrow('再比較')
  expect(s.card).toEqual(before)
})

it('rejects deserialized reviews and inconsistent source identity or dimensions', () => {
  const s = fixture()
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(() => adoptRegionProposal(s.card, JSON.parse(JSON.stringify(review)), s.choices, s.scope)).toThrow('再比較')
  expect(() => adoptRegionProposal(s.card, review, s.choices, { ...s.scope, session: Symbol('other-review') })).toThrow('再比較')
  for (const patch of [{ cardId: 'other' }, { imageDigest: 'b'.repeat(64) }, { imageWidth: 501 }, { imageHeight: 701 }])
    expect(() => compareRegionProposal(s.card, { ...s.proposal, ...patch }, s.scope)).toThrow('元画像')
})

it('requires an explicit target for ambiguous merged and split detections and never auto-deletes other targets', () => {
  const s = fixture()
  s.proposal.candidates = [candidate('merged', 160, { width: 260, height: 200 })]
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(review.differences[0]).toMatchObject({ status: 'ambiguous', targets: [{ kind: 'region', id: 'body' }, { kind: 'region', id: 'missing' }] })
  expect(() => adoptRegionProposal(s.card, review, [{ action: 'add-candidate', detectedId: 'merged' }], s.scope)).toThrow('対応')
  const merged = adoptRegionProposal(s.card, review, [{ action: 'bounds', detectedId: 'merged', target: { kind: 'region', id: 'body' } }], s.scope)
  expect(merged.regions[2]).toEqual(s.card.regions[2])
  expect(merged.regions).toHaveLength(s.card.regions.length)

  s.proposal.candidates = [candidate('top', 160, { width: 260, height: 50 }), candidate('bottom', 220, { width: 260, height: 50 })]
  const split = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(split.differences.slice(0, 2).map(item => item.status)).toEqual(['ambiguous', 'ambiguous'])
  const choices: RegionProposalChoice[] = s.proposal.candidates.map(item => ({ action: 'bounds', detectedId: item.id, target: { kind: 'region', id: 'body' } }))
  expect(() => adoptRegionProposal(s.card, split, choices, s.scope)).toThrow()
})

it('flags overlapping new detections and permits one explicit addition, never both', () => {
  const s = fixture()
  s.proposal.candidates = [candidate('a', 580), candidate('b', 585)]
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(review.differences[0]).toMatchObject({ status: 'ambiguous', targets: [], peerIds: ['b'] })
  const choices: RegionProposalChoice[] = [{ action: 'add-candidate', detectedId: 'a' }, { action: 'add-candidate', detectedId: 'b' }]
  expect(() => adoptRegionProposal(s.card, review, choices, s.scope)).toThrow('対応')
  expect(adoptRegionProposal(s.card, review, choices.slice(0, 1), s.scope).ocrCandidates).toHaveLength(2)
})

it('rejects two safe frame changes aimed at the same existing target before exposing either result', () => {
  const s = fixture()
  const before = structuredClone(s.card)
  s.proposal.candidates = [candidate('a', 150, { x: 10, width: 280, height: 140 }), candidate('b', 155, { x: 15, width: 270, height: 130 })]
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  const choices: RegionProposalChoice[] = s.proposal.candidates.map(item => ({ action: 'bounds', detectedId: item.id, target: { kind: 'region', id: 'body' } }))
  expect(adoptRegionProposal(s.card, review, choices.slice(0, 1), s.scope).regions[1]!.x).toBe(10)
  expect(() => adoptRegionProposal(s.card, review, choices, s.scope)).toThrow('一つずつ')
  expect(s.card).toEqual(before)
})

it('distinguishes candidate IDs from confirmed-region IDs but rejects colliding new additions', () => {
  const s = fixture()
  s.card.ocrCandidates![0]!.id = 'body'
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  const next = adoptRegionProposal(s.card, review, [{ action: 'bounds', detectedId: 'fresh-saved', target: { kind: 'candidate', id: 'body' } }], s.scope)
  expect(next.regions).toEqual(s.card.regions)
  expect(next.ocrCandidates![0]!.x).toBe(30)
  s.proposal.candidates = [candidate('body', 580)]
  const collision = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(() => adoptRegionProposal(s.card, collision, [{ action: 'add-candidate', detectedId: 'body' }], s.scope)).toThrow('対応')
})

it('rejects the entire selection when a later frame would clip an icon, protection area or manual mask', () => {
  const s = fixture()
  const before = structuredClone(s.card)
  s.proposal.candidates[1] = candidate('fresh-body', 160, { x: 50, width: 230, height: 120 })
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(() => adoptRegionProposal(s.card, review, [s.choices[2]!, s.choices[0]!], s.scope)).toThrow('切り捨て')
  expect(s.card).toEqual(before)
  s.card.regions[1]!.manualMaskStrokes = [{ brushSize: 20, points: [{ x: 2, y: 20 }] }]
  s.proposal.candidates[1] = candidate('fresh-body', 150, { x: 10, width: 280, height: 140 })
  const expand = compareRegionProposal(s.card, s.proposal, s.scope)
  expect(() => adoptRegionProposal(s.card, expand, [s.choices[0]!], s.scope)).toThrow('拡張')
})

it('rejects invalid choice IDs, duplicate detection choices and unrelated targets', () => {
  const s = fixture()
  const review = compareRegionProposal(s.card, s.proposal, s.scope)
  for (const choices of [
    [s.choices[0]!, s.choices[0]!],
    [{ action: 'add-candidate', detectedId: 'missing' }],
    [{ action: 'bounds', detectedId: 'fresh-body', target: { kind: 'region', id: 'name' } }],
    [{ action: 'bounds', detectedId: 'fresh-new', target: { kind: 'region', id: 'body' } }],
  ] as RegionProposalChoice[][])
    expect(() => adoptRegionProposal(s.card, review, choices, s.scope)).toThrow()
})

it('validates coordinates, candidate data, image identity and bounded comparison work', () => {
  const s = fixture()
  for (const patch of [{ x: -1 }, { width: 0 }, { height: Number.NaN }, { confidence: 101 }, { id: '' }])
    expect(() => compareRegionProposal(s.card, { ...s.proposal, candidates: [candidate('bad', 580, patch)] }, s.scope)).toThrow()
  expect(() => compareRegionProposal(s.card, { ...s.proposal, candidates: [candidate('same', 580), candidate('same', 580)] }, s.scope)).toThrow()
  expect(() => compareRegionProposal(s.card, s.proposal, { ...s.scope, revision: -1 })).toThrow()
  expect(() => compareRegionProposal(s.card, s.proposal, { ...s.scope, imageDigest: 'filename.png' })).toThrow()
  const many = Array.from({ length: 1001 }, (_, i) => candidate(`many-${i}`, 580))
  expect(() => compareRegionProposal(s.card, { ...s.proposal, candidates: many }, s.scope)).toThrow('上限')
})
