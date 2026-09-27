import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { assetFingerprint } from '~/utils/asset-matching'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useDiscoveryAssetMatching } from './useDiscoveryAssetMatching'
import { useDiscoveryReview } from './useDiscoveryReview'

const pixels = new Uint8ClampedArray(20 * 20 * 4)
for (let y = 3; y < 17; y++) {
  for (let x = 3; x < 17; x++)
    pixels.set([220, 20, 20, 255], (y * 20 + x) * 4)
}
const sample = assetFingerprint(pixels, 20, 20)!
vi.mock('~/utils/asset-matching', async original => ({ ...await original<typeof import('~/utils/asset-matching')>(), fingerprintImage: () => sample }))
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const cleanups: Array<() => void> = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => ({ width: blob instanceof File ? 200 : 20, height: blob instanceof File ? 240 : 20, close: vi.fn() })))
})
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  const store = useProjectStore()
  const project = discoveryProject()
  const first = project.assetDiscovery!.occurrences[0]!
  first.imageDigest = digest('source')
  first.approval!.imageDigest = first.imageDigest
  first.approval!.assetDigest = digest('red')
  project.assetDiscovery!.occurrences.push({ ...structuredClone(first), id: 'occurrence-2', assetId: null, approval: null, decision: 'pending' })
  project.assetDiscovery!.groups[0]!.memberIds.push('occurrence-2')
  project.assets.push({ ...project.assets[0]!, id: 'asset-2', name: 'other-icon', imagePath: 'assets/asset-2.png' })
  store.replaceProject(project)
  const runtime = useProjectRuntime()
  runtime.cardSourceFile.value = new File(['source'], 'source.png')
  runtime.assetFiles.value = new Map([['asset-1', new Blob(['red'])], ['asset-2', new Blob(['red'])]])
  const cardId = ref(project.activeCardId)
  const busy = ref(false)
  const available = ref(true)
  const scope = effectScope()
  const controllers = scope.run(() => {
    const review = useDiscoveryReview({ store, busy: () => busy.value, scope: () => [runtime.projectGeneration.value, runtime.cardSourceFile.value, runtime.assetFiles.value, runtime.pendingAssetWrites.value], context: () => ({ cards: store.document!.cards, assetIds: new Set(store.assets.map(asset => asset.id)), imageDigests: new Map([[project.activeCardId, digest('source')]]), assetDigests: new Map(store.assets.map(asset => [asset.id, digest('red')])) }) })
    const matching = useDiscoveryAssetMatching({ store, runtime, review, busy: () => busy.value, currentCard: () => available.value ? { id: cardId.value, imageWidth: store.activeCard.imageWidth, imageHeight: store.activeCard.imageHeight } : null })
    return { review, matching }
  })!
  cleanups.push(() => {
    scope.stop()
    runtime.dispose()
  })
  return { store, runtime, cardId, busy, available, scope, ...controllers }
}

it('links only the chosen occurrence through the Store and review Undo, without automatic approval or rendering changes', async () => {
  const s = setup()
  const before = s.store.snapshot()!
  const signature = savedProjectSignature(before)
  const proposal = (await s.matching.analyze())!
  expect(s.matching.proposal.value).toBe(proposal)
  expect(s.matching.running.value).toBe(false)
  expect(proposal.rows[0]!.status).toBe('ambiguous')
  expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
  expect(s.review.canUndo.value).toBe(false)
  s.matching.choose(proposal, 'occurrence-1', 'asset-2')
  expect(s.store.assetDiscovery!.occurrences[0]).toMatchObject({ assetId: 'asset-2', decision: 'pending', approval: null })
  expect(s.store.assetDiscovery!.occurrences[1]).toEqual(before.assetDiscovery!.occurrences[1])
  expect(s.store.assetDiscovery!.groups).toEqual(before.assetDiscovery!.groups)
  expect(s.store.document!.cards).toEqual(before.cards)
  expect(s.store.assets).toEqual(before.assets)
  expect(savedProjectSignature(s.store.snapshot()!)).not.toBe(signature)
  expect(s.matching.proposal.value).toBeNull()
  expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).assetDiscovery).toEqual(s.store.assetDiscovery)
  expect(s.review.undo()).toBe(true)
  expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
  expect(() => s.matching.choose(proposal, 'occurrence-1', 'asset-2')).toThrow('再照合')
  expect(s.review.redo()).toBe(true)
  expect(s.store.assetDiscovery!.occurrences[0]!.approval).toBeNull()
  expect(s.runtime.assetFiles.value.size).toBe(2)
})

const changes = ['cancel', 'card', 'unavailable', 'source-back', 'generation', 'edit-undo', 'png-back', 'assets', 'busy-back', 'dispose'] as const
function change(s: ReturnType<typeof setup>, kind: typeof changes[number]) {
  if (kind === 'cancel')
    s.matching.cancel()
  if (kind === 'card')
    s.cardId.value = 'other-card'
  if (kind === 'unavailable')
    s.available.value = false
  if (kind === 'source-back') {
    const original = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['other'], 'source.png')
    s.runtime.cardSourceFile.value = original
  }
  if (kind === 'generation')
    s.runtime.setDirectory(null)
  if (kind === 'edit-undo') {
    s.review.editGroup('group-1', { name: 'New group name' })
    s.review.undo()
  }
  if (kind === 'png-back') {
    const original = s.runtime.pendingAssetWrites.value
    s.runtime.setPendingAssetWrite('asset-2', new Blob(['green']))
    s.runtime.pendingAssetWrites.value = original
  }
  if (kind === 'assets')
    s.store.setAssets(s.store.assets.filter(asset => asset.id !== 'asset-2'))
  if (kind === 'busy-back') {
    s.busy.value = true
    s.busy.value = false
  }
  if (kind === 'dispose')
    s.scope.stop()
}

it.each(changes)('discards pending matching after %s and closes a late bitmap', async (kind) => {
  const s = setup()
  let finish!: (image: ImageBitmap) => void
  vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const task = s.matching.analyze()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(s.matching.running.value).toBe(true)
  change(s, kind)
  const before = s.store.snapshot()
  const bitmap = { width: 20, height: 20, close: vi.fn() }
  finish(bitmap as unknown as ImageBitmap)
  expect(await task).toBeNull()
  expect(bitmap.close).toHaveBeenCalledOnce()
  expect(s.matching.running.value).toBe(false)
  expect(s.matching.proposal.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
})

it.each(changes)('refuses a completed proposal after %s even when old values return', async (kind) => {
  const s = setup()
  const proposal = (await s.matching.analyze())!
  change(s, kind)
  const before = s.store.snapshot()
  expect(s.matching.proposal.value).toBeNull()
  expect(() => s.matching.choose(proposal, 'occurrence-1', 'asset-2')).toThrow('再照合')
  expect(s.store.snapshot()).toEqual(before)
})

it('checks in-place PNG changes at selection time as well as reactive map replacements', async () => {
  const s = setup()
  const proposal = (await s.matching.analyze())!
  s.runtime.assetFiles.value.set('asset-2', new Blob(['green']))
  expect(() => s.matching.choose(proposal, 'occurrence-1', 'asset-2')).toThrow('再照合')
  expect(s.store.assetDiscovery!.occurrences[0]!.assetId).toBe('asset-1')
})

it('exposes partial catalog failures for review instead of treating them as no-match', async () => {
  const s = setup()
  s.runtime.assetFiles.value.delete('asset-2')
  const proposal = (await s.matching.analyze())!
  expect(proposal.failedAssetIds).toEqual(['asset-2'])
  expect(proposal.rows.every(row => row.status === 'incomplete')).toBe(true)
  expect(s.review.canUndo.value).toBe(false)
  s.matching.choose(proposal, 'occurrence-2', 'asset-1')
  expect(s.store.assetDiscovery!.occurrences[1]).toMatchObject({ assetId: 'asset-1', decision: 'pending', approval: null })
})

it('keeps a newer request intact when cancelled work finishes later', async () => {
  const s = setup()
  let finish!: (image: ImageBitmap) => void
  vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const first = s.matching.analyze()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(await s.matching.analyze()).toBeNull()
  s.matching.cancel()
  const second = (await s.matching.analyze())!
  finish({ width: 20, height: 20, close: vi.fn() } as unknown as ImageBitmap)
  expect(await first).toBeNull()
  expect(s.matching.proposal.value).toBe(second)
  s.matching.choose(second, 'occurrence-1', 'asset-2')
  expect(s.store.assetDiscovery!.occurrences[0]!.assetId).toBe('asset-2')
})

it('keeps validation and failed linking retryable without changing state or history', async () => {
  const s = setup()
  const proposal = (await s.matching.analyze())!
  const before = s.store.snapshot()
  expect(() => s.matching.choose(proposal, 'missing', 'asset-2')).toThrow('再照合')
  expect(() => s.matching.choose(proposal, 'occurrence-1', 'missing')).toThrow('再照合')
  vi.spyOn(s.review, 'linkAssetChoices').mockImplementationOnce(() => {
    throw new Error('Link failed')
  })
  expect(() => s.matching.choose(proposal, 'occurrence-1', 'asset-2')).toThrow('Link failed')
  expect(s.store.snapshot()).toEqual(before)
  expect(s.review.canUndo.value).toBe(false)
  expect(s.matching.proposal.value).toBe(proposal)
  s.matching.choose(proposal, 'occurrence-1', 'asset-2')
  expect(s.review.canUndo.value).toBe(true)
})

it('rejects an older or foreign proposal and publishes only the latest analysis', async () => {
  const s = setup()
  const first = (await s.matching.analyze())!
  const second = (await s.matching.analyze())!
  expect(() => s.matching.choose(first, 'occurrence-1', 'asset-2')).toThrow('再照合')
  expect(() => s.matching.choose(JSON.parse(JSON.stringify(second)), 'occurrence-1', 'asset-2')).toThrow('再照合')
  expect(s.matching.proposal.value).toBe(second)
})

it('applies different explicitly selected assets together as one Undo without changing the group', async () => {
  const s = setup()
  const before = s.store.snapshot()!
  const proposal = (await s.matching.analyze())!
  s.matching.chooseMany(proposal, [])
  expect(s.matching.proposal.value).toBe(proposal)
  expect(s.review.canUndo.value).toBe(false)
  s.matching.chooseMany(proposal, [{ occurrenceId: 'occurrence-1', assetId: 'asset-2' }, { occurrenceId: 'occurrence-2', assetId: 'asset-1' }])
  expect(s.store.assetDiscovery!.occurrences.map(item => [item.assetId, item.decision, item.approval])).toEqual([['asset-2', 'pending', null], ['asset-1', 'pending', null]])
  expect(s.store.assetDiscovery!.groups).toEqual(before.assetDiscovery!.groups)
  expect(s.review.undo()).toBe(true)
  expect(s.store.snapshot()).toEqual(before)
  expect(s.review.canUndo.value).toBe(false)
  expect(s.review.redo()).toBe(true)
  expect(s.store.assetDiscovery!.occurrences[1]!.assetId).toBe('asset-1')
})

it.each(['missing-occurrence', 'missing-asset', 'duplicate'] as const)('rejects the entire selection for %s without partially linking earlier rows', async (kind) => {
  const s = setup()
  const before = s.store.snapshot()
  const proposal = (await s.matching.analyze())!
  const choices = [
    { occurrenceId: 'occurrence-1', assetId: 'asset-2' },
    { occurrenceId: kind === 'missing-occurrence' ? 'missing' : kind === 'duplicate' ? 'occurrence-1' : 'occurrence-2', assetId: kind === 'missing-asset' ? 'missing' : 'asset-1' },
  ]
  expect(() => s.matching.chooseMany(proposal, choices)).toThrow()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.review.canUndo.value).toBe(false)
  expect(s.matching.proposal.value).toBe(proposal)
})

it('reports a current source error, permits retry, and discards a late error after cancellation', async () => {
  const s = setup()
  const original = vi.mocked(createImageBitmap).getMockImplementation()!
  vi.mocked(createImageBitmap).mockImplementation(async (...args) => {
    if (args[0] instanceof File)
      throw new Error('Source decode failed')
    return original(...args)
  })
  await expect(s.matching.analyze()).rejects.toThrow('Source decode failed')
  expect(s.matching.running.value).toBe(false)
  expect(s.matching.proposal.value).toBeNull()
  vi.mocked(createImageBitmap).mockImplementation(original)
  expect(await s.matching.analyze()).not.toBeNull()
  let fail!: (error: Error) => void
  vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise((_, reject) => fail = reject))
  const pending = s.matching.analyze()
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  s.matching.cancel()
  fail(new Error('Late failure'))
  expect(await pending).toBeNull()
  expect(s.review.canUndo.value).toBe(false)
})

it('does not allocate images for busy, empty, unread or disposed targets', async () => {
  const s = setup()
  s.busy.value = true
  expect(await s.matching.analyze()).toBeNull()
  s.busy.value = false
  s.runtime.cardSourceFile.value = null
  await expect(s.matching.analyze()).rejects.toThrow('元画像')
  s.store.setAssetDiscovery(null)
  expect(await s.matching.analyze()).toBeNull()
  s.scope.stop()
  expect(await s.matching.analyze()).toBeNull()
  expect(createImageBitmap).not.toHaveBeenCalled()
})
