import type { CardIconProposal, DiscoveryCard } from '~/services/asset-discovery/collect'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { collectCardIconCandidates } from '~/services/asset-discovery/collect'
import { collectStoredIconDiscoveryBatch, groupInitialCollectedIcons, stageInitialCardIcons } from '~/services/asset-discovery/collection'
import { proposeIconGroups } from '~/services/asset-discovery/group'
import { compareIconProposal } from '~/services/asset-discovery/proposal-review'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { assetFingerprint } from '~/utils/asset-matching'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/asset-discovery/collect', () => ({ collectCardIconCandidates: vi.fn() }))
const pixels = new Uint8ClampedArray(20 * 20 * 4)
for (let y = 3; y < 17; y++) {
  for (let x = 3; x < 17; x++)
    pixels.set([220, 20, 20, 255], (y * 20 + x) * 4)
}
const fingerprint = assetFingerprint(pixels, 20, 20)!

function proposal(card: DiscoveryCard): CardIconProposal {
  const first = discoveryProject().assetDiscovery!.occurrences[0]!
  const occurrence = { ...first, id: `detected-${card.id}`, cardId: card.id, owner: null, decision: 'pending' as const, assetId: null, approval: null }
  return { cardId: card.id, imageDigest: first.imageDigest, imageSize: first.imageSize, occurrences: [occurrence], samples: [{ id: occurrence.id, fingerprint }], searchedAreas: [], ocrAreas: [], limitsHit: [] }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(collectCardIconCandidates).mockReset().mockImplementation(async ({ card }) => proposal(card))
})

function setup(draft = false) {
  const project = discoveryProject()
  const original = project.cards[0]!
  project.cards = ['one', 'two', 'three'].map(id => ({ ...structuredClone(original), id }))
  project.activeCardId = 'one'
  delete project.assetDiscovery
  const store = useProjectStore()
  if (draft) {
    project.cards = [project.cards[0]!]
    store.updateCard(null, project.cards[0]!)
    store.setCardOCRCandidates('one', original.ocrCandidates!)
    store.setAssets(project.assets)
  }
  else {
    store.replaceProject(project)
  }
  const context = () => ({ cards: store.document?.cards ?? [{ ...store.draftCard, id: 'one', ocrCandidates: store.draftOCRCandidates }], assetIds: new Set(store.assets.map(asset => asset.id)) })
  const reviewContext = () => ({ ...context(), imageDigests: new Map(project.cards.map(card => [card.id, 'a'.repeat(64)])), assetDigests: new Map<string, string>() })
  const batch = {
    cards: project.cards,
    provider: { recognize: vi.fn(), dispose: vi.fn() },
    loadFile: vi.fn(async () => new File(['synthetic'], 'source.png')),
    isCurrent: () => true,
    cardIsCurrent: (_card: DiscoveryCard) => true,
    cancelled: () => false,
    maximumProposedCandidates: 2000,
  }
  const options = { batch, store, context, draftCardId: draft ? 'one' : undefined }
  return { project, store, context, reviewContext, batch, options }
}

it.each([false, true])('stores first collection as pending and roundtrips without touching OCR/regions/assets (draft=%s)', async (draft) => {
  const s = setup(draft)
  const cardBefore = s.store.readCardCandidateEdit(draft ? null : 'one')
  const assetsBefore = JSON.stringify(s.store.assets)
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.staged.every(item => item.status === 'stored')).toBe(true)
  expect(result.failures).toEqual([])
  expect(result.groupingError).toBeNull()
  expect(s.store.assetDiscovery!.occurrences).toHaveLength(draft ? 1 : 3)
  expect(s.store.assetDiscovery!.occurrences.every(item => item.decision === 'pending' && item.approval === null && item.assetId === null)).toBe(true)
  expect(s.store.assetDiscovery!.groups).toHaveLength(1)
  expect(s.store.assetDiscovery!.groups[0]).toMatchObject({ name: '', proposedAssetId: null, memberIds: result.staged.flatMap(item => item.addedIds), representativeId: result.staged[0]!.addedIds[0] })
  expect(s.store.readCardCandidateEdit(draft ? null : 'one')).toEqual(cardBefore)
  expect(JSON.stringify(s.store.assets)).toBe(assetsBefore)
  if (!draft) {
    const saved = s.store.snapshot()!
    expect(parseFolderProject(serializeFolderProject(saved)).assetDiscovery).toEqual(saved.assetDiscovery)
    expect(savedProjectSignature(saved)).not.toBe(savedProjectSignature(s.project))
  }
  expect(s.batch.provider.dispose).not.toHaveBeenCalled()
})

it('initializes every group representative from the first collected member rather than ID order', () => {
  const s = setup()
  const input = proposal(s.batch.cards[0]!)
  const original = input.occurrences[0]!
  input.occurrences = ['z-first-red', 'z-first-blue', 'a-later-blue', 'a-later-red'].map(id => ({ ...original, id }))
  const staged = stageInitialCardIcons(undefined, input, s.reviewContext())
  if (staged.kind !== 'initial')
    throw new Error('Expected initial collection')
  const grouped = groupInitialCollectedIcons(staged.state, {
    groups: [
      { memberIds: ['a-later-red', 'z-first-red'], representativeId: 'a-later-red', minimumSimilarity: null },
      { memberIds: ['a-later-blue', 'z-first-blue'], representativeId: 'a-later-blue', minimumSimilarity: null },
    ],
    comparisons: 2,
    truncated: false,
  }, [staged.receipt], s.context())
  expect(grouped.groups.map(({ memberIds, representativeId }) => ({ memberIds, representativeId }))).toEqual([
    { memberIds: ['z-first-red', 'a-later-red'], representativeId: 'z-first-red' },
    { memberIds: ['z-first-blue', 'a-later-blue'], representativeId: 'z-first-blue' },
  ])
  expect(grouped.occurrences).toEqual(staged.state.occurrences)
  expect(staged.state.groups).toEqual([])
})

it('stages all first-pass candidates even if their initial bounds need manual disambiguation', () => {
  const s = setup()
  const input = proposal(s.batch.cards[0]!)
  input.occurrences.push({ ...input.occurrences[0]!, id: 'overlapping-first-candidate' })
  const staged = stageInitialCardIcons(undefined, input, s.reviewContext())
  expect(staged.kind).toBe('initial')
  expect(staged.state.occurrences).toHaveLength(2)
  expect(staged.state.occurrences.every(item => item.decision === 'pending')).toBe(true)
  expect(s.store.assetDiscovery).toBeUndefined()
})

it('never overwrites existing review, even when a repeated extraction finds no icons', async () => {
  const s = setup()
  await collectStoredIconDiscoveryBatch(s.options)
  const edited = structuredClone(s.store.assetDiscovery!)
  edited.occurrences[0]!.bounds.width++
  edited.occurrences[0]!.decision = 'excluded'
  edited.groups[0]!.name = 'Manually organized'
  s.store.setAssetDiscovery(edited)
  const before = s.store.snapshot()!
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => ({ ...proposal(card), occurrences: [], samples: [] }))
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.staged.map(item => item.status)).toEqual(['review', 'review', 'review'])
  expect(s.store.snapshot()).toEqual(before)
  expect(compareIconProposal(s.store.assetDiscovery!, result.proposals[0]!, s.reviewContext()).differences).toMatchObject([{ status: 'missing', hasUserReview: true }])
})

it('leaves a repeated unchanged detection as a comparison without duplicate candidates or groups', async () => {
  const s = setup()
  await collectStoredIconDiscoveryBatch(s.options)
  const before = s.store.snapshot()!
  const write = vi.spyOn(s.store, 'setAssetDiscovery')
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    const next = proposal(card)
    next.occurrences[0]!.id += '-new-run'
    next.samples[0]!.id += '-new-run'
    return next
  })
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.staged.every(item => item.status === 'review')).toBe(true)
  expect(s.store.snapshot()).toEqual(before)
  expect(write).not.toHaveBeenCalled()
  expect(compareIconProposal(s.store.assetDiscovery!, result.proposals[0]!, s.reviewContext()).differences).toMatchObject([{ status: 'unchanged' }])
})

it('preserves a manually changed representative when collecting additional cards and collecting again', async () => {
  const s = setup()
  s.batch.cards = s.project.cards.slice(0, 2)
  await collectStoredIconDiscoveryBatch(s.options)
  const edited = structuredClone(s.store.assetDiscovery!)
  edited.groups[0]!.representativeId = 'detected-two'
  edited.groups[0]!.name = 'Manually selected representative'
  s.store.setAssetDiscovery(edited)
  s.batch.cards = s.project.cards
  const additional = await collectStoredIconDiscoveryBatch(s.options)
  expect(additional.staged.map(item => item.status)).toEqual(['review', 'review', 'stored'])
  expect(additional.groupingError).toBeNull()
  expect(s.store.assetDiscovery!.groups).toHaveLength(2)
  expect(s.store.assetDiscovery!.groups[0]).toEqual(edited.groups[0])
  expect(s.store.assetDiscovery!.groups[1]).toMatchObject({ memberIds: ['detected-three'], representativeId: 'detected-three' })
  const beforeRepeat = s.store.snapshot()
  const repeated = await collectStoredIconDiscoveryBatch(s.options)
  expect(repeated.staged.map(item => item.status)).toEqual(['review', 'review', 'review'])
  expect(s.store.snapshot()).toEqual(beforeRepeat)
})

it('retains completed cards after a per-card load or persistence failure and continues independent cards', async () => {
  const s = setup()
  const save = s.store.setAssetDiscovery
  vi.spyOn(s.store, 'setAssetDiscovery').mockImplementationOnce(() => {
    throw new Error('Synthetic save failure')
  }).mockImplementation(save)
  s.batch.loadFile.mockResolvedValueOnce(new File(['one'], 'one.png')).mockRejectedValueOnce(new Error('Missing source'))
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.failures).toEqual([{ cardId: 'one', message: 'Synthetic save failure' }, { cardId: 'two', message: 'Missing source' }])
  expect(result.staged).toMatchObject([{ cardId: 'three', status: 'stored' }])
  expect(s.store.assetDiscovery!.occurrences.map(item => item.cardId)).toEqual(['three'])
})

it('preserves saved completed cards but discards the in-flight result when cancelled', async () => {
  const s = setup()
  let cancelled = false
  s.batch.cancelled = () => cancelled
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    if (card.id === 'two')
      cancelled = true
    return proposal(card)
  })
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.cancelled).toBe(true)
  expect(result.staged).toMatchObject([{ cardId: 'one', status: 'stored' }])
  expect(s.store.assetDiscovery!.occurrences.map(item => item.cardId)).toEqual(['one'])
  expect(s.store.assetDiscovery!.groups[0]!.memberIds).toEqual(['detected-one'])
  expect(s.batch.loadFile).toHaveBeenCalledTimes(2)
})

it('does not write late results or groups into a replacement project', async () => {
  const s = setup()
  let current = true
  s.batch.isCurrent = () => current
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    if (card.id === 'two') {
      current = false
      s.store.replaceProject(s.project)
      throw new Error('Late failure')
    }
    return proposal(card)
  })
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.stale).toBe(true)
  expect(result.failures).toEqual([])
  expect(s.store.assetDiscovery).toBeUndefined()
})

it('reports grouping failure as partial success, keeping candidates already persisted', async () => {
  const s = setup()
  const save = s.store.setAssetDiscovery
  vi.spyOn(s.store, 'setAssetDiscovery').mockImplementation((state, id) => {
    if (state?.groups.length)
      throw new Error('Group write failure')
    save(state, id)
  })
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.failures).toEqual([])
  expect(result.groupingError).toContain('候補は保持しています')
  expect(s.store.assetDiscovery!.occurrences).toHaveLength(3)
  expect(s.store.assetDiscovery!.groups).toEqual([])
})

it('keeps manual grouping done while the next card is being extracted', async () => {
  const s = setup()
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    if (card.id === 'two') {
      const next = structuredClone(s.store.assetDiscovery!)
      next.groups.push({ id: 'manual-group', memberIds: ['detected-one'], representativeId: 'detected-one', name: 'Keep this group', proposedAssetId: null })
      s.store.setAssetDiscovery(next)
    }
    return proposal(card)
  })
  await collectStoredIconDiscoveryBatch(s.options)
  expect(s.store.assetDiscovery!.groups[0]).toMatchObject({ id: 'manual-group', memberIds: ['detected-one'], name: 'Keep this group' })
  expect(s.store.assetDiscovery!.groups[1]).toMatchObject({ memberIds: ['detected-two', 'detected-three'], representativeId: 'detected-two' })
})

it('uses original card snapshots when deciding whether completed candidates may still be grouped', async () => {
  const s = setup()
  s.batch.cardIsCurrent = snapshot => JSON.stringify(snapshot) === JSON.stringify(s.store.document!.cards.find(card => card.id === snapshot.id))
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    if (card.id === 'two') {
      const saved = s.store.document!.cards[0]!
      // Text-only changes do not invalidate the receipt geometry, but do invalidate this execution's card snapshot.
      s.store.updateCard('one', { ...saved, regions: [], imageName: 'renamed.png' })
    }
    return proposal(card)
  })
  await collectStoredIconDiscoveryBatch(s.options)
  expect(s.store.assetDiscovery!.occurrences).toHaveLength(3)
  expect(s.store.assetDiscovery!.groups.flatMap(group => group.memberIds)).not.toContain('detected-one')
})

it('does not create empty discovery state for cards without detections', async () => {
  const s = setup()
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => ({ ...proposal(card), occurrences: [], samples: [] }))
  const before = s.store.snapshot()
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.staged.every(item => item.status === 'empty')).toBe(true)
  expect(s.store.snapshot()).toEqual(before)
})

it('can re-extract existing cards at the persisted limit while refusing new stored occurrences', async () => {
  const s = setup()
  const template = s.project.cards[0]!
  s.project.cards = Array.from({ length: 21 }, (_, i) => ({ ...structuredClone(template), id: `card-${i}` }))
  s.project.activeCardId = 'card-0'
  const state: AssetDiscoveryState = { occurrences: s.project.cards.slice(0, 20).flatMap(card => Array.from({ length: 100 }, (_, i) => ({ ...proposal(card).occurrences[0]!, id: `${card.id}-${i}` }))), groups: [] }
  s.project.assetDiscovery = state
  s.store.replaceProject(s.project)
  s.batch.cards = [s.project.cards[20]!, s.project.cards[0]!]
  const before = s.store.snapshot()
  const result = await collectStoredIconDiscoveryBatch(s.options)
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0]!.cardId).toBe('card-20')
  expect(result.staged).toMatchObject([{ cardId: 'card-0', status: 'review' }])
  expect(s.store.snapshot()).toEqual(before)
})

it.each(['approved', 'wrong-card', 'wrong-hash', 'wrong-dimensions', 'duplicate-id'] as const)('rejects an invalid first proposal (%s) without partial changes', (reason) => {
  const s = setup()
  const input = proposal(s.batch.cards[0]!)
  if (reason === 'approved')
    input.occurrences[0]!.decision = 'accepted'
  if (reason === 'wrong-card')
    input.occurrences[0]!.cardId = 'two'
  if (reason === 'wrong-hash')
    input.imageDigest = 'b'.repeat(64)
  if (reason === 'wrong-dimensions')
    input.imageSize.width++
  if (reason === 'duplicate-id')
    input.occurrences.push(structuredClone(input.occurrences[0]!))
  const before = JSON.stringify(input)
  expect(() => stageInitialCardIcons(undefined, input, s.reviewContext())).toThrow()
  expect(JSON.stringify(input)).toBe(before)
  expect(s.store.assetDiscovery).toBeUndefined()
})

it('never groups an edited, deleted, or pre-grouped candidate, and rejects forged receipts', () => {
  const s = setup()
  const first = stageInitialCardIcons(undefined, proposal(s.batch.cards[0]!), s.reviewContext())
  if (first.kind !== 'initial')
    throw new Error('Expected initial proposal')
  const groups = proposeIconGroups(proposal(s.batch.cards[0]!).samples)
  const changed = structuredClone(first.state)
  changed.occurrences[0]!.bounds.x++
  expect(groupInitialCollectedIcons(changed, groups, [first.receipt], s.context()).groups).toEqual([])
  expect(groupInitialCollectedIcons({ occurrences: [], groups: [] }, groups, [first.receipt], s.context()).groups).toEqual([])
  const grouped = groupInitialCollectedIcons(first.state, groups, [first.receipt], s.context())
  expect(groupInitialCollectedIcons(grouped, groups, [first.receipt], s.context())).toEqual(grouped)
  expect(() => groupInitialCollectedIcons(first.state, groups, [{ ...first.receipt }], s.context())).toThrow('この収集')
  expect(first.state.groups).toEqual([])
})
