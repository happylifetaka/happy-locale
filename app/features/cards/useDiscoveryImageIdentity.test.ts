import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useDiscoveryImageIdentity } from './useDiscoveryImageIdentity'

const hash = vi.hoisted(() => ({ digest: vi.fn<(blob: Blob) => Promise<string>>(), clear: vi.fn() }))
vi.mock('~/services/asset-discovery/digest', () => ({ createImageDigestCache: () => hash }))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  hash.digest.mockReset()
  hash.clear.mockReset()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
})

async function settle() {
  for (let i = 0; i < 10; i++) await nextTick()
}

function setup() {
  const store = useProjectStore()
  store.replaceProject(discoveryProject())
  const runtime = useProjectRuntime()
  const source = new File(['source'], 'same.png')
  const asset = new File(['asset'], 'same.png')
  const digests = new Map<Blob, string>([[source, 'a'.repeat(64)], [asset, 'b'.repeat(64)]])
  hash.digest.mockImplementation(async blob => digests.get(blob)!)
  runtime.replaceCardImage({ element: { removeAttribute: vi.fn() } as unknown as HTMLImageElement, file: source, url: 'blob:source' })
  runtime.setAssetImage('asset-1', {} as HTMLCanvasElement)
  runtime.replaceAssetFiles(new Map([['asset-1', asset]]))
  const busy = ref(true)
  const currentImageId = ref(store.document!.activeCardId)
  const logDiagnostic = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const identity = scope.run(() => useDiscoveryImageIdentity({ store, runtime, busy, currentImageId, logDiagnostic }))!
  return { store, runtime, busy, currentImageId, logDiagnostic, identity, scope, digests, source, asset }
}

it('checks only referenced assets and the displayed card, without changing valid approvals or source regions', async () => {
  const s = setup()
  const before = s.store.snapshot()
  s.busy.value = false
  await settle()
  expect(hash.digest.mock.calls.map(call => call[0])).toEqual([s.source, s.asset])
  expect(s.identity.currentIdentity()).toMatchObject({ cardId: 'synthetic-1', imageDigest: 'a'.repeat(64) })
  expect(s.identity.currentIdentity()!.assetDigests.get('asset-1')).toBe('b'.repeat(64))
  expect(s.store.snapshot()).toEqual(before)
  expect(s.identity.checking.value).toBe(false)
  expect(s.logDiagnostic).not.toHaveBeenCalled()
})

it('invalidates a same-name changed source and clears ownership, retaining bounds and group decisions', async () => {
  const s = setup()
  const before = savedProjectSignature(s.store.document!)
  s.digests.set(s.source, 'c'.repeat(64))
  s.busy.value = false
  await settle()
  expect(s.store.assetDiscovery!.occurrences[0]).toMatchObject({ owner: null, approval: null, decision: 'pending', imageDigest: 'a'.repeat(64) })
  expect(s.store.assetDiscovery!.groups).toEqual(discoveryProject().assetDiscovery!.groups)
  expect(s.store.activeCard.regions).toEqual([])
  expect(savedProjectSignature(s.store.document!)).not.toBe(before)
  // Invalidating an already-invalidated approval must not trigger an endless watcher loop.
  const calls = hash.digest.mock.calls.length
  await settle()
  expect(hash.digest).toHaveBeenCalledTimes(calls)
})

it('uses the pending PNG after recrop even with unchanged asset metadata, and rejects a cached result immediately', async () => {
  const s = setup()
  s.busy.value = false
  await settle()
  const assets = s.store.assets
  const newer = new Blob(['recropped'])
  s.digests.set(newer, 'd'.repeat(64))
  s.runtime.setPendingAssetWrite('asset-1', newer)
  expect(s.identity.currentIdentity()).toBeNull()
  await settle()
  expect(s.store.assets).toBe(assets)
  expect(s.store.assetDiscovery!.occurrences[0]).toMatchObject({ assetId: 'asset-1', decision: 'pending', approval: null })
  expect(s.identity.currentIdentity()!.assetDigests.get('asset-1')).toBe('d'.repeat(64))
  s.runtime.acknowledgeAssetWrites(new Map([['asset-1', newer]]))
  await settle()
  expect(s.identity.currentIdentity()!.assetDigests.get('asset-1')).toBe('d'.repeat(64))
})

it('keeps approval on rename and layout-only asset edits when PNG bytes are unchanged', async () => {
  const s = setup()
  s.busy.value = false
  await settle()
  s.store.setAssets(s.store.assets.map(asset => ({ ...asset, name: 'renamed', scale: 2 })))
  await settle()
  expect(s.store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
})

it.each(['card', 'project', 'dispose', 'review'] as const)('discards delayed source hashes after %s changes', async (change) => {
  const s = setup()
  let resolve!: (digest: string) => void
  hash.digest.mockImplementationOnce(() => new Promise<string>((done) => {
    resolve = done
  }))
  s.busy.value = false
  await nextTick()
  expect(s.identity.checking.value).toBe(true)
  if (change === 'card')
    s.currentImageId.value = 'other'
  if (change === 'project') {
    s.busy.value = true
    s.runtime.setDirectory({ name: 'same folder' } as FileSystemDirectoryHandle)
    s.store.replaceProject(discoveryProject())
  }
  if (change === 'dispose')
    s.scope.stop()
  if (change === 'review') {
    const state = structuredClone(s.store.assetDiscovery!)
    state.groups[0]!.name = 'Changed while hashing'
    s.store.setAssetDiscovery(state)
  }
  resolve('c'.repeat(64))
  await settle()
  expect(s.store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
  expect(s.logDiagnostic).not.toHaveBeenCalled()
  if (change === 'review')
    expect(s.store.assetDiscovery!.groups[0]!.name).toBe('Changed while hashing')
})

it('treats unavailable images and hash failures as unverified, not deleted or approved', async () => {
  const s = setup()
  s.runtime.replaceAssetFiles(new Map())
  hash.digest.mockRejectedValueOnce(new Error('File changed while reading'))
  s.busy.value = false
  await settle()
  const identity = s.identity.currentIdentity()!
  expect(identity.imageDigest).toBeNull()
  expect(identity.assetDigests.size).toBe(0)
  expect(identity.errors.size).toBe(2)
  expect(s.store.assetDiscovery!.occurrences[0]!.decision).toBe('accepted')
  s.runtime.replaceAssetFiles(new Map([['asset-1', s.asset]]))
  await settle()
  expect(s.identity.currentIdentity()!.errors.size).toBe(0)
  expect(s.identity.currentIdentity()!.imageDigest).toBe('a'.repeat(64))
})
