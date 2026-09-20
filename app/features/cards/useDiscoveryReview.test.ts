import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { useDiscoveryReview } from '~/features/cards/useDiscoveryReview'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject, discoveryProposal } from '../../../tests/fixtures/asset-discovery'

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
})

function fixture({ draft = false, empty = false, steps = 30, characters = 2_000_000 } = {}) {
  const store = useProjectStore()
  const project = discoveryProject()
  const cardId = project.activeCardId
  if (draft) {
    store.updateCard(null, project.cards[0]!)
    store.setCardOCRCandidates(cardId, project.cards[0]!.ocrCandidates!)
    store.setAssets(project.assets)
    if (!empty)
      store.setAssetDiscovery(project.assetDiscovery!, cardId)
  }
  else {
    store.replaceProject({ ...project, assetDiscovery: empty ? undefined : project.assetDiscovery })
  }
  const generation = ref(1)
  const source = shallowRef(new Blob(['original']))
  const assetRevision = ref(1)
  const busy = ref(false)
  const known = ref(true)
  const actualAssetDigest = ref('b'.repeat(64))
  const scope = effectScope()
  scopes.push(scope)
  const review = scope.run(() => useDiscoveryReview({
    store,
    scope: () => [generation.value, source.value, assetRevision.value],
    busy: () => busy.value,
    draftCardId: () => cardId,
    maximumHistorySteps: steps,
    maximumHistoryCharacters: characters,
    context: () => ({
      cards: store.document?.cards ?? [{ ...store.activeCard, id: cardId, ocrCandidates: store.draftOCRCandidates }],
      assetIds: new Set(store.assets.map(asset => asset.id)),
      imageDigests: known.value ? new Map([[cardId, 'a'.repeat(64)]]) : new Map(),
      assetDigests: known.value ? new Map([['asset-1', actualAssetDigest.value]]) : new Map(),
    }),
  }))!
  return { store, project, cardId, review, generation, source, assetRevision, busy, known, actualAssetDigest, scope }
}

it.each([false, true])('persists manual review operations through the real Store, undo and redo (draft=%s)', (draft) => {
  const { store, review, project, cardId } = fixture({ draft, empty: true })
  const regionsBefore = structuredClone(store.activeCard.regions)
  const assetsBefore = structuredClone(store.assets)
  const id = review.add(cardId, { x: 40, y: 50, width: 20, height: 20 })
  expect(store.assetDiscovery!.occurrences[0]).toMatchObject({ id, decision: 'pending', origin: 'manual' })
  expect(review.canUndo.value).toBe(true)
  expect(review.undo()).toBe(true)
  expect(store.assetDiscovery).toBeUndefined()
  expect(review.canUndo.value).toBe(false)
  expect(review.canRedo.value).toBe(true)
  expect(review.redo()).toBe(true)
  expect(store.assetDiscovery!.occurrences[0]!.id).toBe(id)
  review.change(id, { kind: 'asset', assetId: 'asset-1' })
  review.change(id, { kind: 'approve' })
  expect(store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
  expect(review.undo()).toBe(true)
  expect(store.assetDiscovery!.occurrences[0]!.decision).toBe('pending')
  expect(review.redo()).toBe(true)
  expect(store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
  expect(store.activeCard.regions).toEqual(regionsBefore)
  expect(store.assets).toEqual(assetsBefore)
  if (draft)
    store.acceptSavedProject(project, new Set())
  const saved = serializeFolderProject(store.document!)
  expect(parseFolderProject(saved).assetDiscovery).toEqual(store.assetDiscovery)
  expect(saved).not.toContain('canUndo')
  expect(saved).not.toContain('historyTruncated')
})

it('marks edits unsaved, preserves history on saving, and restores the original save signature on undo', () => {
  const { store, review } = fixture()
  const signature = savedProjectSignature(store.document!)
  review.editGroup('group-1', { name: 'New name' })
  expect(savedProjectSignature(store.document!)).not.toBe(signature)
  store.acceptSavedProject(store.snapshot()!, new Set())
  expect(review.canUndo.value).toBe(true)
  expect(review.undo()).toBe(true)
  expect(savedProjectSignature(store.document!)).toBe(signature)
  expect(review.redo()).toBe(true)
  expect(store.assetDiscovery!.groups[0]!.name).toBe('New name')
})

it('supports group split/move and crop/exclude history without changing the source project or shared asset', () => {
  const { store, review, cardId } = fixture()
  const original = structuredClone(store.assetDiscovery)
  const assets = structuredClone(store.assets)
  const id = review.add(cardId, { x: 80, y: 60, width: 20, height: 20 })
  review.move([id], { kind: 'existing', id: 'group-1' })
  review.move([id], { kind: 'new', id: 'split', name: 'Split' })
  expect(store.assetDiscovery!.groups).toHaveLength(2)
  review.undo()
  expect(store.assetDiscovery!.groups).toHaveLength(1)
  expect(store.assetDiscovery!.groups[0]!.memberIds).toContain(id)
  review.change(id, { kind: 'bounds', bounds: { x: 160, y: 140, width: 20, height: 20 } })
  expect(review.canRedo.value).toBe(false)
  expect(store.assetDiscovery!.occurrences[1]!.owner).toBeNull()
  review.change(id, { kind: 'decision', decision: 'excluded' })
  review.undo()
  expect(store.assetDiscovery!.occurrences[1]!.decision).toBe('pending')
  while (review.canUndo.value)
    review.undo()
  expect(store.assetDiscovery).toEqual(original)
  expect(store.assets).toEqual(assets)
})

it('does not consume history or destroy redo for a no-op, and clears redo for a new edit', () => {
  const { review, store } = fixture()
  review.editGroup('group-1', { name: store.assetDiscovery!.groups[0]!.name })
  expect(review.canUndo.value).toBe(false)
  review.editGroup('group-1', { name: 'One' })
  review.undo()
  review.editGroup('group-1', { name: store.assetDiscovery!.groups[0]!.name })
  expect(review.canUndo.value).toBe(false)
  expect(review.canRedo.value).toBe(true)
  review.editGroup('group-1', { name: 'Branch' })
  expect(review.canRedo.value).toBe(false)
  expect(review.redo()).toBe(false)
  review.undo()
  expect(review.canUndo.value).toBe(false)
})

it.each(['generation', 'source', 'asset', 'outside-review', 'owners', 'asset-removal'] as const)('invalidates old history synchronously after %s changes', (kind) => {
  const { review, store, generation, source, assetRevision, cardId } = fixture()
  review.editGroup('group-1', { name: 'Earlier edit' })
  if (kind === 'generation')
    generation.value++
  if (kind === 'source')
    source.value = new Blob(['replacement of same dimensions'])
  if (kind === 'asset')
    assetRevision.value++
  if (kind === 'outside-review') {
    const next = structuredClone(store.assetDiscovery!)
    next.groups[0]!.name = 'External edit'
    store.setAssetDiscovery(next)
  }
  if (kind === 'owners') {
    const candidate = store.document!.cards[0]!.ocrCandidates![0]!
    store.setCardOCRCandidates(cardId, [{ ...candidate, width: 130 }])
  }
  if (kind === 'asset-removal')
    store.setAssets([])
  const current = store.snapshot()
  expect(review.canUndo.value).toBe(false)
  expect(review.undo()).toBe(false)
  expect(review.redo()).toBe(false)
  expect(store.snapshot()).toEqual(current)
})

it('does not resurrect a cleared history when resources later return to the same identity', () => {
  const { review, source } = fixture()
  review.editGroup('group-1', { name: 'Change' })
  const previous = source.value
  source.value = new Blob(['replacement'])
  source.value = previous
  expect(review.undo()).toBe(false)
})

it('does not discard review history for asset naming/layout edits or unrelated OCR text edits', () => {
  const { review, store, cardId } = fixture()
  review.editGroup('group-1', { name: 'Change' })
  store.setAssets(store.assets.map(asset => ({ ...asset, name: 'Renamed', scale: 2 })))
  const candidate = store.document!.cards[0]!.ocrCandidates![0]!
  store.setCardOCRCandidates(cardId, [{ ...candidate, text: 'Revised OCR text' }])
  expect(review.undo()).toBe(true)
  expect(store.assets[0]!.name).toBe('Renamed')
  expect(store.document!.cards[0]!.ocrCandidates![0]!.text).toBe('Revised OCR text')
})

it('refuses to restore approval without verified images, preserving the edit and retryable history', () => {
  const { review, store, known, actualAssetDigest } = fixture()
  review.change('occurrence-1', { kind: 'bounds', bounds: { x: 41, y: 50, width: 20, height: 20 } })
  known.value = false
  const current = store.snapshot()
  expect(() => review.undo()).toThrow('承認対象画像')
  expect(store.snapshot()).toEqual(current)
  expect(review.canUndo.value).toBe(true)
  known.value = true
  actualAssetDigest.value = 'f'.repeat(64)
  expect(() => review.undo()).toThrow('承認対象画像')
  actualAssetDigest.value = 'b'.repeat(64)
  expect(review.undo()).toBe(true)
  expect(store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
})

it('permits undo of group-only changes without loading untouched approvals, but rejects a known mismatch', () => {
  const { review, known, actualAssetDigest } = fixture()
  review.editGroup('group-1', { name: 'Change' })
  known.value = false
  expect(review.undo()).toBe(true)
  known.value = true
  actualAssetDigest.value = 'f'.repeat(64)
  expect(() => review.redo()).toThrow('承認対象画像')
})

it('bounds history by steps and serialized size without rolling back successful edits', () => {
  const { review, store } = fixture({ steps: 2 })
  for (const name of ['One', 'Two', 'Three'])
    review.editGroup('group-1', { name })
  expect(review.historyTruncated.value).toBe(true)
  review.undo()
  review.undo()
  expect(review.undo()).toBe(false)
  expect(store.assetDiscovery!.groups[0]!.name).toBe('One')
  review.clearHistory()
  expect(review.historyTruncated.value).toBe(false)
  const small = fixture({ characters: 1 })
  small.review.editGroup('group-1', { name: 'Large edit' })
  expect(small.store.assetDiscovery!.groups[0]!.name).toBe('Large edit')
  expect(small.review.canUndo.value).toBe(false)
  expect(small.review.historyTruncated.value).toBe(true)
})

it('does not mutate history for failed validation or Store writes, and refuses busy/disposed actions', () => {
  const { review, store, busy, scope } = fixture()
  review.editGroup('group-1', { name: 'Change' })
  const current = store.snapshot()
  expect(() => review.editGroup('group-1', { representativeId: 'missing' })).toThrow()
  const write = vi.spyOn(store, 'setAssetDiscovery').mockImplementationOnce(() => {
    throw new Error('write failed')
  })
  expect(() => review.undo()).toThrow('write failed')
  expect(store.snapshot()).toEqual(current)
  expect(review.canUndo.value).toBe(true)
  write.mockRestore()
  busy.value = true
  expect(review.canUndo.value).toBe(false)
  expect(() => review.undo()).toThrow('操作できません')
  busy.value = false
  expect(review.undo()).toBe(true)
  scope.stop()
  expect(review.canRedo.value).toBe(false)
  expect(() => review.redo()).toThrow('操作できません')
})

it('adopts only selected extraction proposals into the Store as one undoable edit', () => {
  const { store, review } = fixture({ empty: true })
  const proposal = discoveryProposal()
  const comparison = review.compare(proposal)
  expect(store.assetDiscovery).toBeUndefined()
  expect(review.canUndo.value).toBe(false)
  expect(review.adopt(comparison, []).size).toBe(0)
  expect(store.assetDiscovery).toBeUndefined()
  expect(review.canUndo.value).toBe(false)
  const ids = review.adopt(comparison, [{ action: 'add', detectedId: 'detected-1' }])
  expect(ids.get('detected-1')).toBe('detected-1')
  expect(store.assetDiscovery!.occurrences).toHaveLength(1)
  expect(review.canUndo.value).toBe(true)
  expect(() => review.adopt(comparison, [{ action: 'add', detectedId: 'detected-1' }])).toThrow('再比較')
  review.undo()
  expect(store.assetDiscovery).toBeUndefined()
  expect(() => review.adopt(comparison, [{ action: 'add', detectedId: 'detected-1' }])).toThrow('再比較')
  review.redo()
  expect(store.assetDiscovery!.occurrences).toHaveLength(1)
  expect(parseFolderProject(serializeFolderProject(store.document!)).assetDiscovery).toEqual(store.assetDiscovery)
  const repeated = review.compare(discoveryProposal())
  expect(() => review.adopt(repeated, [{ action: 'add', detectedId: 'detected-1' }])).toThrow('対応')
})

it('keeps approval, groups and history unchanged for repeated equivalent proposals', () => {
  const { store, review } = fixture()
  const before = store.snapshot()
  const comparison = review.compare(discoveryProposal())
  const choices = [{ action: 'replace' as const, detectedId: 'detected-1', occurrenceId: 'occurrence-1' }]
  expect(review.adopt(comparison, choices).get('detected-1')).toBe('occurrence-1')
  expect(review.adopt(comparison, choices).get('detected-1')).toBe('occurrence-1')
  expect(store.snapshot()).toEqual(before)
  expect(review.canUndo.value).toBe(false)
})

it('undoes an explicit replacement together with its approval invalidation', () => {
  const { store, review } = fixture()
  const before = store.snapshot()
  const proposal = discoveryProposal()
  proposal.occurrences[0]!.bounds.x++
  proposal.occurrences[0]!.detectedBounds!.x++
  const comparison = review.compare(proposal)
  review.adopt(comparison, [{ action: 'replace', detectedId: 'detected-1', occurrenceId: 'occurrence-1' }])
  expect(store.assetDiscovery!.occurrences[0]).toMatchObject({ id: 'occurrence-1', bounds: { x: 41 }, decision: 'pending', approval: null })
  expect(store.assetDiscovery!.groups).toEqual(before!.assetDiscovery!.groups)
  review.undo()
  expect(store.snapshot()).toEqual(before)
  review.redo()
  expect(store.assetDiscovery!.occurrences[0]!.decision).toBe('pending')
})

it.each(['resource', 'edit-undo', 'outside-edit'] as const)('invalidates a comparison after %s, even when the prior data is later restored', (kind) => {
  const { store, review, source } = fixture()
  const comparison = review.compare(discoveryProposal())
  if (kind === 'resource') {
    const original = source.value
    source.value = new Blob(['different'])
    source.value = original
  }
  if (kind === 'edit-undo') {
    review.editGroup('group-1', { name: 'New name' })
    review.undo()
  }
  if (kind === 'outside-edit') {
    const original = structuredClone(store.assetDiscovery!)
    store.setAssetDiscovery({ ...original, groups: original.groups.map(group => ({ ...group, name: 'Changed' })) })
    store.setAssetDiscovery(original)
  }
  const before = store.snapshot()
  expect(() => review.adopt(comparison, [])).toThrow('再比較')
  expect(store.snapshot()).toEqual(before)
})

it('rejects comparisons from another review session and rejects unread source images', () => {
  const first = fixture()
  const comparison = first.review.compare(discoveryProposal())
  const second = fixture()
  expect(() => second.review.adopt(comparison, [])).toThrow('再比較')
  second.known.value = false
  expect(() => second.review.compare(discoveryProposal())).toThrow('元画像')
})
