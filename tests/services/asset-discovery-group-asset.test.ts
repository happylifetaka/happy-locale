import { expect, it } from 'vitest'
import { groupAssetState } from '~/services/asset-discovery/group-asset'
import { linkReviewGroupAsset, moveReviewOccurrencesWithAsset } from '~/services/asset-discovery/review-operations'
import { discoveryProject } from '../fixtures/asset-discovery'

function fixture() {
  const project = discoveryProject()
  const state = project.assetDiscovery!
  const first = state.occurrences[0]!
  state.occurrences.push({ ...structuredClone(first), id: 'second', decision: 'excluded', approval: null })
  state.groups[0]!.memberIds.push('second')
  const context = { cards: project.cards, assetIds: new Set(['asset-1', 'asset-2']), imageDigests: new Map(), assetDigests: new Map() }
  return { project, state, context, group: state.groups[0]! }
}

it('assigns and clears a group as one unit without approving members or changing other data', () => {
  const { project, state, context, group } = fixture()
  const before = structuredClone(project)
  const next = linkReviewGroupAsset(state, group.id, 'asset-2', context)
  expect(next.groups[0]!.proposedAssetId).toBe('asset-2')
  expect(next.occurrences.map(item => item.assetId)).toEqual(['asset-2', 'asset-2'])
  expect(next.occurrences.map(item => item.decision)).toEqual(['pending', 'excluded'])
  expect(next.occurrences.every(item => item.approval === null)).toBe(true)
  const cleared = linkReviewGroupAsset(next, group.id, null, context)
  expect(cleared.occurrences.every(item => item.assetId === null)).toBe(true)
  expect(cleared.groups[0]!.proposedAssetId).toBeNull()
  expect(project).toEqual(before)
  expect(() => linkReviewGroupAsset(state, group.id, 'missing', context)).toThrow()
  expect(() => linkReviewGroupAsset(state, 'missing', null, context)).toThrow()
})

it('preserves valid approval for a same-asset assignment and reports legacy mixed assignments without mutation', () => {
  const { state, context, group } = fixture()
  expect(linkReviewGroupAsset(state, group.id, 'asset-1', context)).toEqual(state)
  expect(groupAssetState(state, group)).toEqual({ assetId: 'asset-1', needsSync: false })
  state.occurrences[1]!.assetId = null
  const before = structuredClone(state)
  expect(groupAssetState(state, group)).toEqual({ assetId: 'asset-1', needsSync: true })
  expect(state).toEqual(before)
  group.proposedAssetId = null
  expect(groupAssetState(state, group)).toEqual({ assetId: null, needsSync: true })
  state.occurrences[1]!.assetId = 'asset-1'
  expect(groupAssetState(state, group)).toEqual({ assetId: 'asset-1', needsSync: true })
})

it('inherits destination assignment on move and clears it when returning to ungrouped or a new group', () => {
  const { state, context, group } = fixture()
  state.occurrences.push({ ...structuredClone(state.occurrences[0]!), id: 'target', assetId: 'asset-2', approval: null, decision: 'pending' })
  state.groups.push({ id: 'target-group', name: '', memberIds: ['target'], representativeId: 'target', proposedAssetId: 'asset-2' })
  const before = structuredClone(state)
  const next = moveReviewOccurrencesWithAsset(state, [group.memberIds[0]!], { kind: 'existing', id: 'target-group' }, context)
  expect(next.occurrences[0]).toMatchObject({ assetId: 'asset-2', decision: 'pending', approval: null })
  expect(next.occurrences[1]).toEqual(state.occurrences[1])
  expect(next.groups.find(group => group.id === 'target-group')!.memberIds).toHaveLength(2)
  for (const destination of [{ kind: 'ungrouped' }, { kind: 'new', id: 'new', name: 'New' }] as const) {
    const separated = moveReviewOccurrencesWithAsset(next, [group.memberIds[0]!], destination, context)
    expect(separated.occurrences[0]!.assetId).toBeNull()
    expect(separated.occurrences[2]!.assetId).toBe('asset-2')
  }
  expect(state).toEqual(before)
  state.occurrences[2]!.assetId = null
  expect(() => moveReviewOccurrencesWithAsset(state, [group.memberIds[0]!], { kind: 'existing', id: 'target-group' }, context)).toThrow('揃っていません')
})
