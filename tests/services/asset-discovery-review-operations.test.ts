import type { DiscoveryReviewContext, OccurrenceReviewChange } from '~/services/asset-discovery/review-operations'
import { expect, it } from 'vitest'
import { addManualOccurrence, editReviewGroup, linkReviewAsset, linkReviewAssetChoices, moveReviewOccurrences, reviewOccurrence } from '~/services/asset-discovery/review-operations'
import { discoveryProject } from '../fixtures/asset-discovery'

function fixture() {
  const project = discoveryProject()
  const state = project.assetDiscovery!
  const card = project.cards[0]!
  const context: DiscoveryReviewContext = {
    cards: project.cards,
    assetIds: new Set(['asset-1', 'asset-2']),
    imageDigests: new Map([[card.id, 'a'.repeat(64)]]),
    assetDigests: new Map([['asset-1', 'b'.repeat(64)], ['asset-2', 'c'.repeat(64)]]),
  }
  return { project, card, state, context, id: state.occurrences[0]!.id }
}

it('creates a manual, unapproved occurrence with independent bounds and unique ownership', () => {
  const { project, state, card, context } = fixture()
  const before = structuredClone(project)
  const bounds = { x: 80, y: 60, width: 20, height: 20 }
  const next = addManualOccurrence(state, card.id, bounds, context)
  const added = next.occurrences[1]!
  expect(added).toMatchObject({ cardId: card.id, imageDigest: 'a'.repeat(64), bounds, detectedBounds: null, origin: 'manual', detectorRevision: 'manual-v1', decision: 'pending', approval: null, assetId: null, owner: { kind: 'candidate', id: 'candidate-1' } })
  expect(added.id).not.toBe(state.occurrences[0]!.id)
  expect(next.groups).toEqual(state.groups)
  bounds.x = 0
  next.occurrences[0]!.bounds.x = 0
  expect(added.bounds.x).toBe(80)
  expect(project).toEqual(before)
})

it('leaves ambiguous ownership unassigned and refuses manual additions without a verified source', () => {
  const { state, card, context } = fixture()
  card.ocrCandidates!.push({ ...card.ocrCandidates![0]!, id: 'overlap' })
  const bounds = state.occurrences[0]!.bounds
  expect(addManualOccurrence(state, card.id, bounds, context).occurrences[1]!.owner).toBeNull()
  expect(() => addManualOccurrence(state, card.id, bounds, { ...context, imageDigests: new Map() })).toThrow('元画像')
})

it('applies the shared size, reference and per-card limits to manual additions', () => {
  const { state, card, context } = fixture()
  expect(() => addManualOccurrence(state, card.id, { x: 199, y: 10, width: 20, height: 20 }, context)).toThrow('画像外')
  expect(() => addManualOccurrence(state, 'missing', state.occurrences[0]!.bounds, context)).toThrow('元画像')
  const full = { ...state, occurrences: Array.from({ length: 100 }, (_, index) => ({ ...state.occurrences[0]!, id: `occurrence-${index + 1}` })) }
  expect(() => addManualOccurrence(full, card.id, state.occurrences[0]!.bounds, context)).toThrow('候補数')
})

it('revises bounds without losing initial geometry or assignment, invalidates approval and clears invalid ownership', () => {
  const { state, context, id } = fixture()
  const before = structuredClone(state)
  const bounds = { x: 160, y: 130, width: 20, height: 20 }
  const next = reviewOccurrence(state, id, { kind: 'bounds', bounds }, context)
  expect(next.occurrences[0]).toMatchObject({ bounds, detectedBounds: before.occurrences[0]!.bounds, assetId: 'asset-1', decision: 'pending', approval: null, owner: null })
  expect(next.groups).toEqual(state.groups)
  expect(state).toEqual(before)
})

it('keeps approval for a no-op edit and ownership for a still-contained crop', () => {
  const { state, context, id } = fixture()
  expect(reviewOccurrence(state, id, { kind: 'bounds', bounds: state.occurrences[0]!.bounds }, context)).toEqual(state)
  const next = reviewOccurrence(state, id, { kind: 'bounds', bounds: { ...state.occurrences[0]!.bounds, width: 25 } }, context)
  expect(next.occurrences[0]!.owner).toEqual(state.occurrences[0]!.owner)
  expect(next.occurrences[0]!.approval).toBeNull()
})

it('changing assignment does not approve it until the individual explicit approval', () => {
  const { state, context, id } = fixture()
  expect(reviewOccurrence(state, id, { kind: 'asset', assetId: 'asset-1' }, context)).toEqual(state)
  const assigned = reviewOccurrence(state, id, { kind: 'asset', assetId: 'asset-2' }, context)
  expect(assigned.occurrences[0]).toMatchObject({ assetId: 'asset-2', decision: 'pending', approval: null })
  const approved = reviewOccurrence(assigned, id, { kind: 'approve' }, context)
  expect(approved.occurrences[0]).toMatchObject({ decision: 'accepted', approval: { assetId: 'asset-2', assetDigest: 'c'.repeat(64), imageDigest: 'a'.repeat(64) } })
  expect(approved.groups).toEqual(state.groups)
  const detached = reviewOccurrence(approved, id, { kind: 'asset', assetId: null }, context)
  expect(detached.occurrences[0]).toMatchObject({ assetId: null, decision: 'pending', approval: null })
  expect(() => reviewOccurrence(detached, id, { kind: 'approve' }, context)).toThrow('登録先')
})

it('allows explicit ownership confirmation without changing approval, but rejects missing or too-small owners', () => {
  const { state, card, context, id } = fixture()
  card.ocrCandidates!.push({ ...card.ocrCandidates![0]!, id: 'another' })
  const unowned = reviewOccurrence(state, id, { kind: 'owner', owner: null }, context)
  expect(unowned.occurrences[0]!.owner).toBeNull()
  expect(unowned.occurrences[0]!.approval).toEqual(state.occurrences[0]!.approval)
  const owned = reviewOccurrence(unowned, id, { kind: 'owner', owner: { kind: 'candidate', id: 'another' } }, context)
  expect(owned.occurrences[0]!.owner).toEqual({ kind: 'candidate', id: 'another' })
  expect(owned.occurrences[0]!.approval).toEqual(state.occurrences[0]!.approval)
  expect(() => reviewOccurrence(unowned, id, { kind: 'owner', owner: { kind: 'candidate', id: 'missing' } }, context)).toThrow('所属先')
  card.ocrCandidates![1]!.width = 10
  expect(() => reviewOccurrence(unowned, id, { kind: 'owner', owner: { kind: 'candidate', id: 'another' } }, context)).toThrow('所属先')
  expect(() => reviewOccurrence(unowned, id, { kind: 'owner', owner: { kind: 'candidate', id: 'candidate-1' } }, { ...context, imageDigests: new Map() })).toThrow('元画像')
})

it('keeps excluded occurrences available for repeat detection and requires reapproval on restoration', () => {
  const { state, context, id } = fixture()
  const excluded = reviewOccurrence(state, id, { kind: 'decision', decision: 'excluded' }, context)
  expect(excluded.occurrences).toHaveLength(1)
  expect(excluded.occurrences[0]).toMatchObject({ decision: 'excluded', approval: null, assetId: 'asset-1' })
  expect(excluded.groups).toEqual(state.groups)
  const restored = reviewOccurrence(excluded, id, { kind: 'decision', decision: 'pending' }, context)
  expect(restored.occurrences[0]).toMatchObject({ decision: 'pending', approval: null })
})

it.each(['unread-source', 'changed-source', 'changed-size', 'unread-asset'] as const)('rejects approval with %s', (reason) => {
  const { state, card, context, id } = fixture()
  if (reason === 'unread-source')
    context.imageDigests = new Map()
  if (reason === 'changed-source')
    context.imageDigests = new Map([[card.id, 'f'.repeat(64)]])
  if (reason === 'unread-asset')
    context.assetDigests = new Map()
  if (reason === 'changed-size') {
    card.imageWidth = 201
    state.occurrences[0]!.owner = null
    state.occurrences[0]!.decision = 'pending'
    state.occurrences[0]!.approval = null
  }
  const before = structuredClone(state)
  expect(() => reviewOccurrence(state, id, { kind: 'approve' }, context)).toThrow()
  expect(state).toEqual(before)
})

it('requires the matching current source for crop edits and leaves registration validation atomic', () => {
  const { state, card, context, id } = fixture()
  const before = structuredClone(state)
  const change: OccurrenceReviewChange = { kind: 'bounds', bounds: { ...state.occurrences[0]!.bounds, x: 41 } }
  expect(() => reviewOccurrence(state, id, change, { ...context, imageDigests: new Map([[card.id, 'f'.repeat(64)]]) })).toThrow('元画像が変わ')
  expect(() => reviewOccurrence(state, id, { kind: 'asset', assetId: 'missing' }, context)).toThrow('アセット参照')
  expect(() => reviewOccurrence(state, 'missing', change, context)).toThrow('見つかりません')
  expect(state).toEqual(before)
})

function groupedFixture() {
  const input = fixture()
  input.state.occurrences.push({ ...structuredClone(input.state.occurrences[0]!), id: 'occurrence-2' }, { ...structuredClone(input.state.occurrences[0]!), id: 'occurrence-3', assetId: null, approval: null, decision: 'excluded' })
  input.state.groups[0]!.memberIds.push('occurrence-2')
  input.state.groups.push({ id: 'group-2', memberIds: ['occurrence-3'], representativeId: 'occurrence-3', name: 'Separate', proposedAssetId: 'asset-2' })
  return input
}

it('moves a representative and merges groups without adopting the target registration for their members', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  const moved = moveReviewOccurrences(state, ['occurrence-1'], { kind: 'existing', id: 'group-2' }, context)
  expect(moved.groups[0]!.representativeId).toBe('occurrence-2')
  expect(moved.groups[1]).toMatchObject({ memberIds: ['occurrence-3', 'occurrence-1'], representativeId: 'occurrence-3', proposedAssetId: 'asset-2' })
  const merged = moveReviewOccurrences(moved, ['occurrence-2'], { kind: 'existing', id: 'group-2' }, context)
  expect(merged.groups).toHaveLength(1)
  expect(merged.groups[0]!.memberIds).toEqual(['occurrence-3', 'occurrence-1', 'occurrence-2'])
  expect(merged.occurrences).toEqual(before.occurrences)
  expect(state).toEqual(before)
})

it('splits and ungroups members, removes empty groups and does not duplicate a member on repeat moves', () => {
  const { state, context } = groupedFixture()
  const split = moveReviewOccurrences(state, ['occurrence-1'], { kind: 'new', id: 'split', name: 'New group' }, context)
  expect(split.groups[2]).toEqual({ id: 'split', name: 'New group', memberIds: ['occurrence-1'], representativeId: 'occurrence-1', proposedAssetId: null })
  const repeated = moveReviewOccurrences(split, ['occurrence-1'], { kind: 'existing', id: 'split' }, context)
  expect(repeated).toEqual(split)
  const ungrouped = moveReviewOccurrences(split, ['occurrence-1', 'occurrence-2'], { kind: 'ungrouped' }, context)
  expect(ungrouped.groups.map(group => group.id)).toEqual(['group-2'])
  expect(ungrouped.occurrences).toEqual(state.occurrences)
})

it('edits group metadata only, preserving independent individual decisions and approvals', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  const next = editReviewGroup(state, 'group-1', { name: 'Renamed', representativeId: 'occurrence-2', proposedAssetId: 'asset-2' }, context)
  expect(next.groups[0]).toMatchObject({ name: 'Renamed', representativeId: 'occurrence-2', proposedAssetId: 'asset-2' })
  expect(next.occurrences).toEqual(before.occurrences)
  expect(editReviewGroup(next, 'group-1', { proposedAssetId: null }, context).groups[0]!.proposedAssetId).toBeNull()
  expect(state).toEqual(before)
})

it('rejects invalid moves or group metadata atomically', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  for (const ids of [[], ['missing'], ['occurrence-1', 'occurrence-1']])
    expect(() => moveReviewOccurrences(state, ids, { kind: 'existing', id: 'group-2' }, context)).toThrow('選び直し')
  expect(() => moveReviewOccurrences(state, ['occurrence-1'], { kind: 'existing', id: 'missing' }, context)).toThrow('見つかりません')
  expect(() => moveReviewOccurrences(state, ['occurrence-1'], { kind: 'new', id: 'group-1', name: '' }, context)).toThrow('重複')
  expect(() => editReviewGroup(state, 'missing', { name: '' }, context)).toThrow('見つかりません')
  for (const patch of [{ representativeId: 'occurrence-3' }, { proposedAssetId: 'missing' }, { name: 'x'.repeat(1001) }])
    expect(() => editReviewGroup(state, 'group-1', patch, context)).toThrow('保存データ')
  expect(state).toEqual(before)
})

it('links only explicitly selected members, preserves excluded decisions, and does not approve the group', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  const linked = linkReviewAsset(state, ['occurrence-1'], 'asset-2', 'group-1', context)
  expect(linked.occurrences[0]).toMatchObject({ assetId: 'asset-2', approval: null, decision: 'pending' })
  expect(linked.occurrences.slice(1)).toEqual(state.occurrences.slice(1))
  expect(linked.groups[0]!.proposedAssetId).toBe('asset-2')
  const excluded = linkReviewAsset(linked, ['occurrence-3'], 'asset-2', 'group-2', context)
  expect(excluded.occurrences[2]).toMatchObject({ assetId: 'asset-2', decision: 'excluded', approval: null })
  const unlinked = linkReviewAsset(excluded, ['occurrence-1', 'occurrence-2'], null, 'group-1', context)
  expect(unlinked.occurrences.slice(0, 2).every(item => item.assetId === null && item.approval === null)).toBe(true)
  expect(unlinked.groups[0]!.proposedAssetId).toBeNull()
  expect(state).toEqual(before)
})

it('validates every selected assignment before committing and leaves same-asset approvals intact', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  expect(linkReviewAsset(state, ['occurrence-1', 'occurrence-2'], 'asset-1', 'group-1', context)).toEqual(state)
  for (const ids of [[], ['missing'], ['occurrence-1', 'occurrence-1']])
    expect(() => linkReviewAsset(state, ids, 'asset-2', undefined, context)).toThrow('一つずつ')
  expect(() => linkReviewAsset(state, ['occurrence-1', 'occurrence-3'], 'asset-2', 'group-1', context)).toThrow('グループ')
  expect(() => linkReviewAsset(state, ['occurrence-1'], 'missing', 'group-1', context)).toThrow('アセット参照')
  expect(state).toEqual(before)
})

it('applies per-occurrence choices without propagating assignments or clearing unchanged approvals', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  const next = linkReviewAssetChoices(state, [{ occurrenceId: 'occurrence-1', assetId: 'asset-2' }, { occurrenceId: 'occurrence-2', assetId: 'asset-1' }], context)
  expect(next.occurrences[0]).toMatchObject({ assetId: 'asset-2', approval: null, decision: 'pending' })
  expect(next.occurrences.slice(1)).toEqual(before.occurrences.slice(1))
  expect(next.groups).toEqual(before.groups)
  expect(state).toEqual(before)
})

it('rejects an invalid member of a mixed assignment set atomically, including excluded occurrences', () => {
  const { state, context } = groupedFixture()
  const before = structuredClone(state)
  const valid = { occurrenceId: 'occurrence-1', assetId: 'asset-2' }
  for (const invalid of [valid, { occurrenceId: 'missing', assetId: 'asset-1' }, { occurrenceId: 'occurrence-2', assetId: 'missing' }, { occurrenceId: 'occurrence-3', assetId: 'asset-1' }])
    expect(() => linkReviewAssetChoices(state, [valid, invalid], context)).toThrow('選び直し')
  expect(() => linkReviewAssetChoices(state, [], context)).toThrow('選び直し')
  expect(state).toEqual(before)
})
