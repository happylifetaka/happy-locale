import { expect, it } from 'vitest'
import { activeReviewGroups } from '~/services/asset-discovery/review-groups'
import { discoveryProject } from '../fixtures/asset-discovery'

function fixture() {
  const state = discoveryProject().assetDiscovery!
  const first = state.occurrences[0]!
  state.occurrences.push(
    { ...structuredClone(first), id: 'second', decision: 'pending', approval: null },
    { ...structuredClone(first), id: 'third', decision: 'pending', approval: null },
  )
  state.groups[0]!.memberIds.push('third', 'second')
  return state
}

it('omits excluded members and empty groups without mutating saved membership or metadata', () => {
  const state = fixture()
  state.occurrences[1]!.decision = 'excluded'
  state.occurrences.push({ ...structuredClone(state.occurrences[1]!), id: 'only-excluded' })
  state.groups.push({ id: 'excluded-group', name: 'Keep for restoration', representativeId: 'only-excluded', memberIds: ['only-excluded'], proposedAssetId: null })
  const before = structuredClone(state)
  const projected = activeReviewGroups(state)
  expect(projected).toEqual([{ ...state.groups[0], memberIds: ['occurrence-1', 'third'] }])
  projected[0]!.name = 'Changed in projection'
  projected[0]!.memberIds.push('different')
  expect(state).toEqual(before)
})

it('preserves a valid manually selected representative rather than replacing it with the first member', () => {
  const state = fixture()
  state.groups[0]!.representativeId = 'second'
  expect(activeReviewGroups(state)[0]!.representativeId).toBe('second')
})

it('uses the first remaining member in group order until the excluded representative is restored', () => {
  const state = fixture()
  const first = state.occurrences[0]!
  first.decision = 'excluded'
  first.approval = null
  const before = structuredClone(state)
  expect(activeReviewGroups(state)[0]).toMatchObject({ memberIds: ['third', 'second'], representativeId: 'third' })
  expect(state).toEqual(before)
  first.decision = 'pending'
  expect(activeReviewGroups(state)[0]).toEqual(state.groups[0])
})

it('does not create groups for ungrouped or excluded candidates', () => {
  const state = fixture()
  state.groups = []
  expect(activeReviewGroups(state)).toEqual([])
})
