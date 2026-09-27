import type { DiscoveryThumbnailState } from './useDiscoveryThumbnails'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useDiscoveryThumbnails } from './useDiscoveryThumbnails'

const io = vi.hoisted(() => ({ load: vi.fn(), hash: vi.fn(), crop: vi.fn(), decode: vi.fn(), close: vi.fn(), readCache: vi.fn(), writeCache: vi.fn() }))
vi.mock('~/services/project/folder', () => ({ loadFolderProjectCardImage: io.load }))
vi.mock('~/services/asset-discovery/digest', () => ({ createImageDigestCache: () => ({ digest: io.hash, clear: vi.fn() }) }))
vi.mock('~/services/asset-discovery/thumbnail', () => ({ createIconThumbnail: io.crop }))
vi.mock('~/services/asset-discovery/thumbnail-cache', () => ({ readIconThumbnailCache: io.readCache, writeIconThumbnailCache: io.writeCache }))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  io.load.mockReset().mockResolvedValue(new File(['image'], 'image.png'))
  io.hash.mockReset().mockResolvedValue('a'.repeat(64))
  io.crop.mockReset().mockResolvedValue(new Blob(['crop']))
  io.readCache.mockReset().mockResolvedValue(null)
  io.writeCache.mockReset().mockResolvedValue(true)
  io.close.mockReset()
  io.decode.mockReset().mockResolvedValue({ width: 200, height: 240, close: io.close })
  vi.stubGlobal('createImageBitmap', io.decode)
  let serial = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:thumbnail-${++serial}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function settle() {
  for (let i = 0; i < 20; i++) await nextTick()
}
function setup() {
  const store = useProjectStore()
  store.replaceProject(discoveryProject())
  const runtime = useProjectRuntime()
  runtime.setDirectory({ name: 'project' } as FileSystemDirectoryHandle)
  const scope = effectScope()
  scopes.push(scope)
  const thumbnails = scope.run(() => useDiscoveryThumbnails({ store, runtime, currentImageId: ref(store.document!.activeCardId) }))!
  const item = store.assetDiscovery!.occurrences[0]!
  return { store, runtime, scope, thumbnails, item }
}

it('only loads requested crops, batches one card, shares duplicate crops and retains saved data', async () => {
  const s = setup()
  const before = JSON.stringify(s.store.snapshot())
  await settle()
  expect(io.load).not.toHaveBeenCalled()
  const one = vi.fn()
  const two = vi.fn()
  const duplicate = vi.fn()
  const release = s.thumbnails.subscribe(s.item, one)
  s.thumbnails.subscribe({ ...s.item, id: 'duplicate' }, duplicate)
  s.thumbnails.subscribe({ ...s.item, bounds: { ...s.item.bounds, x: 70 } }, two)
  await settle()
  expect(io.load).toHaveBeenCalledOnce()
  expect(io.decode).toHaveBeenCalledOnce()
  expect(io.crop).toHaveBeenCalledTimes(2)
  expect(io.close).toHaveBeenCalledOnce()
  expect(one).toHaveBeenLastCalledWith({ url: 'blob:thumbnail-1' })
  expect(duplicate).toHaveBeenLastCalledWith({ url: 'blob:thumbnail-1' })
  release()
  s.thumbnails.subscribe(s.item, vi.fn())
  await settle()
  expect(io.load).toHaveBeenCalledOnce()
  expect(JSON.stringify(s.store.snapshot())).toBe(before)
  s.scope.stop()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})

it('regenerates after bounds changes and cancels requests that leave the viewport', async () => {
  const s = setup()
  s.thumbnails.subscribe(s.item, vi.fn())()
  await settle()
  expect(io.decode).not.toHaveBeenCalled()
  const release = s.thumbnails.subscribe(s.item, vi.fn())
  await settle()
  release()
  const adjusted = { ...s.item, bounds: { ...s.item.bounds, width: 25 } }
  s.thumbnails.subscribe(adjusted, vi.fn())
  await settle()
  expect(io.crop).toHaveBeenLastCalledWith(expect.anything(), s.item.imageSize, adjusted.bounds)
  expect(io.crop).toHaveBeenCalledTimes(2)
})

it.each(['project', 'dispose', 'release'] as const)('discards a delayed crop after %s and closes the bitmap', async (change) => {
  const s = setup()
  let resolve!: (blob: Blob) => void
  io.crop.mockReturnValueOnce(new Promise<Blob>(accept => resolve = accept))
  const listener = vi.fn()
  const release = s.thumbnails.subscribe(s.item, listener)
  await settle()
  expect(io.crop).toHaveBeenCalledOnce()
  if (change === 'project')
    s.runtime.setDirectory({ name: 'next' } as FileSystemDirectoryHandle)
  else if (change === 'dispose')
    s.scope.stop()
  else release()
  resolve(new Blob(['late']))
  await settle()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(listener).toHaveBeenCalledExactlyOnceWith({})
  expect(io.close).toHaveBeenCalledOnce()
})

it.each(['digest', 'size', 'decode', 'crop'] as const)('reports %s failure without using a blurry fallback', async (failure) => {
  const s = setup()
  if (failure === 'digest')
    io.hash.mockResolvedValue('different')
  if (failure === 'size')
    io.decode.mockResolvedValue({ width: 20, height: 24, close: io.close })
  if (failure === 'decode')
    io.decode.mockRejectedValue(new Error('bad image'))
  if (failure === 'crop')
    io.crop.mockRejectedValue(new Error('bad bounds'))
  const listener = vi.fn<(state: DiscoveryThumbnailState) => void>()
  s.thumbnails.subscribe(s.item, listener)
  await settle()
  expect(listener.mock.lastCall![0].error).toBeTruthy()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  if (failure === 'size' || failure === 'crop')
    expect(io.close).toHaveBeenCalledOnce()
})

it('evicts unused thumbnails and releases all remaining URLs on disposal', async () => {
  const s = setup()
  for (let i = 0; i < 130; i++) {
    const release = s.thumbnails.subscribe({ ...s.item, bounds: { ...s.item.bounds, x: i } }, vi.fn())
    await settle()
    release()
  }
  expect(URL.createObjectURL).toHaveBeenCalledTimes(130)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  s.scope.stop()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(130)
})

it('reuses the persistent cache after verifying source identity without decoding the full image', async () => {
  const s = setup()
  io.readCache.mockResolvedValue(new Blob(['cached'], { type: 'image/png' }))
  const listener = vi.fn()
  s.thumbnails.subscribe(s.item, listener)
  await settle()
  expect(io.hash).toHaveBeenCalledOnce()
  expect(io.decode).not.toHaveBeenCalled()
  expect(io.crop).not.toHaveBeenCalled()
  expect(io.writeCache).not.toHaveBeenCalled()
  expect(listener).toHaveBeenLastCalledWith({ url: 'blob:thumbnail-1' })
})

it('keeps a generated preview usable when optional cache writes fail', async () => {
  const s = setup()
  io.writeCache.mockResolvedValue(false)
  const listener = vi.fn()
  s.thumbnails.subscribe(s.item, listener)
  await settle()
  expect(io.writeCache).toHaveBeenCalledOnce()
  expect(listener).toHaveBeenLastCalledWith({ url: 'blob:thumbnail-1' })
})
