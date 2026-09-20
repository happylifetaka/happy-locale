import type { CardIconProposal } from '~/services/asset-discovery/collect'
import type { DiscoveryReviewContext } from '~/services/asset-discovery/review-operations'
import { expect, it } from 'vitest'
import { adoptIconProposal, compareIconProposal } from '~/services/asset-discovery/proposal-review'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { discoveryProject, discoveryProposal } from '../fixtures/asset-discovery'

function fixture() {
  const project = discoveryProject()
  const proposal = discoveryProposal()
  const context: DiscoveryReviewContext = {
    cards: project.cards,
    assetIds: new Set(project.assets.map(asset => asset.id)),
    imageDigests: new Map([[proposal.cardId, proposal.imageDigest]]),
    assetDigests: new Map([['asset-1', 'b'.repeat(64)]]),
  }
  return { project, state: project.assetDiscovery!, proposal, context }
}

function detected(proposal: CardIconProposal, id: string, x: number, y: number, width = 20, height = 20) {
  const bounds = { x, y, width, height }
  return { ...structuredClone(proposal.occurrences[0]!), id, bounds, detectedBounds: { ...bounds } }
}

it('classifies new, unchanged and missing occurrences without changing decisions or geometry', () => {
  const { project, state, proposal, context } = fixture()
  const missingBounds = { x: 100, y: 180, width: 20, height: 20 }
  state.occurrences.push({ ...structuredClone(state.occurrences[0]!), id: 'missing', bounds: missingBounds, detectedBounds: { ...missingBounds }, owner: null, approval: null, decision: 'excluded' })
  proposal.occurrences.push(detected(proposal, 'new', 160, 180))
  proposal.limitsHit = ['extraction']
  const before = structuredClone(project)
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences).toEqual([
    { status: 'unchanged', detectedId: 'detected-1', occurrenceIds: ['occurrence-1'], peerIds: [], hasUserReview: true },
    { status: 'new', detectedId: 'new', occurrenceIds: [], peerIds: [], hasUserReview: false },
    { status: 'missing', detectedId: null, occurrenceIds: ['missing'], peerIds: [], hasUserReview: true },
  ])
  expect(review.limitsHit).toEqual(['extraction'])
  expect(project).toEqual(before)
  expect(adoptIconProposal(state, review, [], context).state).toEqual(state)
})

it('uses the initial detector bounds to match manually moved/cropped candidates and never silently overwrites them', () => {
  const { state, proposal, context } = fixture()
  state.occurrences[0] = { ...state.occurrences[0]!, bounds: { x: 80, y: 50, width: 20, height: 20 }, decision: 'pending', approval: null }
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences[0]).toMatchObject({ status: 'changed', hasUserReview: true, occurrenceIds: ['occurrence-1'] })
  expect(adoptIconProposal(state, review, [], context).state).toEqual(state)
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'detected-1' }], context)).toThrow('対応')
  const result = adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context)
  expect(result.state.occurrences[0]).toMatchObject({ id: 'occurrence-1', bounds: proposal.occurrences[0]!.bounds, assetId: 'asset-1', decision: 'pending' })
  expect(result.state.groups).toEqual(state.groups)
  expect(result.adoptedIds.get('detected-1')).toBe('occurrence-1')
})

it.each(['accepted', 'excluded'] as const)('requires explicit replacement and preserves the %s candidate identity/registration/group', (decision) => {
  const { project, state, proposal, context } = fixture()
  if (decision === 'excluded')
    state.occurrences[0] = { ...state.occurrences[0]!, decision, approval: null }
  const before = structuredClone(project)
  proposal.occurrences[0] = detected(proposal, 'detected-1', 42, 51, 25, 22)
  const review = compareIconProposal(state, proposal, context)
  const result = adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context)
  expect(result.state.occurrences[0]).toMatchObject({ id: 'occurrence-1', assetId: 'asset-1', approval: null, decision: decision === 'excluded' ? 'excluded' : 'pending', owner: state.occurrences[0]!.owner })
  expect(result.state.groups).toEqual(state.groups)
  expect(parseFolderProject(serializeFolderProject({ ...project, assetDiscovery: result.state })).assetDiscovery).toEqual(result.state)
  expect(project).toEqual(before)
})

it('keeps an unchanged approval and does not replace metadata simply because the detector ran again', () => {
  const { state, proposal, context } = fixture()
  proposal.occurrences[0]!.detectorRevision = 'new-revision'
  const review = compareIconProposal(state, proposal, context)
  const result = adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context)
  expect(result.state).toEqual(state)
  expect(adoptIconProposal(result.state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context).state).toEqual(state)
})

it('adds only selected new proposals and prevents duplicate additions on repeated extraction', () => {
  const { state, proposal, context } = fixture()
  proposal.occurrences.push(detected(proposal, 'new', 160, 180))
  const review = compareIconProposal(state, proposal, context)
  const result = adoptIconProposal(state, review, [{ action: 'add', detectedId: 'new' }], context)
  expect(result.state.occurrences).toHaveLength(2)
  expect(result.state.occurrences[0]).toEqual(state.occurrences[0])
  expect(result.state.occurrences[1]).toMatchObject({ decision: 'pending', approval: null, assetId: null })
  expect(() => adoptIconProposal(result.state, review, [{ action: 'add', detectedId: 'new' }], context)).toThrow('再比較')
  proposal.occurrences = [detected(proposal, 'fresh-id', 160, 180)]
  const repeated = compareIconProposal(result.state, proposal, context)
  expect(repeated.differences[0]).toMatchObject({ status: 'unchanged', occurrenceIds: ['new'] })
  expect(() => adoptIconProposal(result.state, repeated, [{ action: 'add', detectedId: 'fresh-id' }], context)).toThrow('対応')
})

it('makes duplicate detections ambiguous, allowing one explicit addition but not both', () => {
  const { state, proposal, context } = fixture()
  proposal.occurrences = [detected(proposal, 'one', 160, 180), detected(proposal, 'two', 162, 180)]
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences.slice(0, 2).map(item => item.status)).toEqual(['ambiguous', 'ambiguous'])
  expect(review.differences[0]!.peerIds).toEqual(['two'])
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'one' }, { action: 'add', detectedId: 'two' }], context)).toThrow('対応')
  expect(adoptIconProposal(state, review, [{ action: 'add', detectedId: 'two' }], context).state.occurrences).toHaveLength(2)
})

it('requires explicit one-to-one choices for ambiguous existing matches and keeps other old occurrences', () => {
  const { state, proposal, context } = fixture()
  state.occurrences.push({ ...structuredClone(state.occurrences[0]!), id: 'other' })
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences[0]).toMatchObject({ status: 'ambiguous', occurrenceIds: ['occurrence-1', 'other'] })
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'detected-1' }], context)).toThrow('対応')
  expect(adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'other' }], context).state).toEqual(state)
})

it('rejects two replacements of the same old occurrence and never turns one-to-many into automatic splitting', () => {
  const { state, proposal, context } = fixture()
  proposal.occurrences = [detected(proposal, 'left', 40, 50, 9), detected(proposal, 'right', 51, 50, 9)]
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences.map(item => item.status)).toEqual(['ambiguous', 'ambiguous'])
  expect(() => adoptIconProposal(state, review, [
    { action: 'replace', detectedId: 'left', occurrenceId: 'occurrence-1' },
    { action: 'replace', detectedId: 'right', occurrenceId: 'occurrence-1' },
  ], context)).toThrow('一つずつ')
  expect(state.occurrences[0]!.bounds.width).toBe(20)
})

it('keeps old-image candidates distinct and requires explicit replacement after their approval/owner is invalidated', () => {
  const { state, proposal, context } = fixture()
  proposal.imageDigest = 'f'.repeat(64)
  proposal.occurrences[0]!.imageDigest = proposal.imageDigest
  context.imageDigests = new Map([[proposal.cardId, proposal.imageDigest]])
  expect(() => compareIconProposal(state, proposal, context)).toThrow('承認・所属')
  state.occurrences[0] = { ...state.occurrences[0]!, decision: 'pending', approval: null, owner: null }
  const review = compareIconProposal(state, proposal, context)
  expect(review.differences.map(item => item.status)).toEqual(['new', 'source-changed'])
  expect(adoptIconProposal(state, review, [], context).state).toEqual(state)
  const result = adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context)
  expect(result.state.occurrences[0]).toMatchObject({ id: 'occurrence-1', imageDigest: proposal.imageDigest, owner: null, approval: null, decision: 'pending', assetId: 'asset-1' })
  expect(result.state.groups).toEqual(state.groups)
})

it('detaches and freezes comparison geometry, and refuses a forged or deserialized review', () => {
  const { state, proposal, context } = fixture()
  const review = compareIconProposal(state, proposal, context)
  expect(Object.isFrozen(review.occurrences[0]!.bounds)).toBe(true)
  expect(Object.isFrozen(review.differences[0]!.occurrenceIds)).toBe(true)
  proposal.occurrences[0]!.bounds.x = 100
  expect(review.occurrences[0]!.bounds.x).toBe(40)
  expect(() => adoptIconProposal(state, structuredClone(review), [], context)).toThrow('再比較')
})

it.each(['review', 'owner', 'image'] as const)('rejects adoption after %s changes instead of overwriting newer work', (kind) => {
  const { state, proposal, context } = fixture()
  const review = compareIconProposal(state, proposal, context)
  if (kind === 'review')
    state.groups[0]!.name = 'Changed meanwhile'
  if (kind === 'owner')
    context.cards[0]!.ocrCandidates![0]!.width = 130
  if (kind === 'image')
    context.imageDigests = new Map([[proposal.cardId, 'f'.repeat(64)]])
  const before = structuredClone(state)
  expect(() => adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }], context)).toThrow('再比較')
  expect(state).toEqual(before)
})

it('rejects duplicate selections, unknown candidates, cross-card replacement and reused candidate IDs atomically', () => {
  const { state, proposal, context } = fixture()
  context.cards = [...context.cards, { ...context.cards[0]!, id: 'other-card' }]
  state.occurrences.push({ ...structuredClone(state.occurrences[0]!), id: 'other-icon', cardId: 'other-card' })
  proposal.occurrences = [detected(proposal, 'occurrence-1', 160, 180)]
  const review = compareIconProposal(state, proposal, context)
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'occurrence-1' }], context)).toThrow('対応')
  expect(() => adoptIconProposal(state, review, [{ action: 'replace', detectedId: 'occurrence-1', occurrenceId: 'other-icon' }], context)).toThrow('同じカード')
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'missing' }], context)).toThrow('見つかりません')
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'occurrence-1' }, { action: 'add', detectedId: 'occurrence-1' }], context)).toThrow('重複')
  expect(state.occurrences).toHaveLength(2)
})

it('applies the saved per-card limit to selected additions without dropping prior candidates', () => {
  const { state, proposal, context } = fixture()
  state.occurrences = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(state.occurrences[0]!), id: `occurrence-${index + 1}` }))
  proposal.occurrences = [detected(proposal, 'new', 160, 180)]
  const review = compareIconProposal(state, proposal, context)
  expect(() => adoptIconProposal(state, review, [{ action: 'add', detectedId: 'new' }], context)).toThrow('候補数')
  expect(state.occurrences).toHaveLength(100)
})

it.each(['approval', 'wrong-source', 'dimensions', 'duplicate-id', 'edited-bounds'] as const)('rejects malformed %s proposal inputs', (kind) => {
  const { state, proposal, context } = fixture()
  if (kind === 'approval')
    proposal.occurrences[0] = { ...proposal.occurrences[0]!, ...state.occurrences[0]! }
  if (kind === 'wrong-source')
    proposal.occurrences[0]!.imageDigest = 'f'.repeat(64)
  if (kind === 'dimensions')
    proposal.imageSize.width++
  if (kind === 'duplicate-id')
    proposal.occurrences.push(structuredClone(proposal.occurrences[0]!))
  if (kind === 'edited-bounds')
    proposal.occurrences[0]!.bounds.x++
  expect(() => compareIconProposal(state, proposal, context)).toThrow()
})
