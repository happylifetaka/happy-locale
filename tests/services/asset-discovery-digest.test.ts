import { afterEach, expect, it, vi } from 'vitest'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { FILE_LIMITS } from '~/utils/file-limits'

afterEach(() => vi.unstubAllGlobals())

it('hashes actual bytes, not file names, dimensions or timestamps', async () => {
  const cache = createImageDigestCache()
  const first = new File(['abc'], 'same.png', { lastModified: 123 })
  const equal = new File(['abc'], 'other.png', { lastModified: 999 })
  const changed = new File(['abd'], 'same.png', { lastModified: 123 })
  expect(await cache.digest(first)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(await cache.digest(equal)).toBe(await cache.digest(first))
  expect(await cache.digest(changed)).not.toBe(await cache.digest(first))
})

it('shares concurrent reads for the same immutable Blob and releases the cache on reset', async () => {
  const cache = createImageDigestCache()
  const blob = new Blob(['abc'])
  const read = vi.spyOn(blob, 'arrayBuffer')
  const first = cache.digest(blob)
  expect(cache.digest(blob)).toBe(first)
  await first
  expect(read).toHaveBeenCalledOnce()
  cache.clear()
  await cache.digest(blob)
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not cache failed reads and rejects excessive files before reading bytes', async () => {
  const cache = createImageDigestCache()
  const blob = new Blob(['abc'])
  vi.spyOn(blob, 'arrayBuffer').mockRejectedValueOnce(new Error('File changed'))
  await expect(cache.digest(blob)).rejects.toThrow('File changed')
  await expect(cache.digest(blob)).resolves.toHaveLength(64)
  const oversized = new Blob()
  Object.defineProperty(oversized, 'size', { value: FILE_LIMITS.imageBytes + 1 })
  const read = vi.spyOn(oversized, 'arrayBuffer')
  await expect(cache.digest(oversized)).rejects.toThrow('以下')
  expect(read).not.toHaveBeenCalled()
})

it('does not substitute a weak metadata hash if WebCrypto is unavailable', async () => {
  vi.stubGlobal('crypto', {})
  await expect(createImageDigestCache().digest(new Blob(['abc']))).rejects.toThrow('同一性を確認できません')
})
