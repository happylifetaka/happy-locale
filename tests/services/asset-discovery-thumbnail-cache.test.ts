import { afterEach, expect, it, vi } from 'vitest'
import { iconThumbnailCacheName, readIconThumbnailCache, writeIconThumbnailCache } from '~/services/asset-discovery/thumbnail-cache'
import { discoveryProject } from '../fixtures/asset-discovery'

afterEach(() => vi.unstubAllGlobals())
const item = discoveryProject().assetDiscovery!.occurrences[0]!
function setup() {
  const bytes = new Uint8Array(32)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const header = new DataView(bytes.buffer)
  header.setUint32(12, 0x49484452)
  header.setUint32(16, 20)
  header.setUint32(20, 20)
  const png = new Blob([bytes], { type: 'image/png' })
  const writer = { write: vi.fn(), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) }
  const file = { getFile: vi.fn().mockResolvedValue(new File([png], 'cache.png')), createWritable: vi.fn().mockResolvedValue(writer) }
  const cache = { getFileHandle: vi.fn().mockResolvedValue(file) }
  const temp = { getDirectoryHandle: vi.fn().mockResolvedValue(cache) }
  const root = { getDirectoryHandle: vi.fn().mockResolvedValue(temp), queryPermission: vi.fn().mockResolvedValue('granted') }
  const bitmap = { width: 20, height: 20, close: vi.fn() }
  const decode = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)
  return { bytes, png, writer, file, cache, temp, root, directory: root as unknown as FileSystemDirectoryHandle, decode, bitmap }
}

it('keys cache files by image content, dimensions, bounds and rendering version, not user names', async () => {
  const name = await iconThumbnailCacheName(item)
  expect(name).toMatch(/^[a-f0-9]{64}\.png$/u)
  expect(await iconThumbnailCacheName({ ...item })).toBe(name)
  expect(await iconThumbnailCacheName({ ...item, imageDigest: 'b'.repeat(64) })).not.toBe(name)
  expect(await iconThumbnailCacheName({ ...item, bounds: { ...item.bounds, x: 41 } })).not.toBe(name)
  expect(await iconThumbnailCacheName({ ...item, imageSize: { width: 201, height: 240 } })).not.toBe(name)
  await expect(iconThumbnailCacheName({ ...item, imageDigest: '../project' })).rejects.toThrow()
})

it('writes only temp/asset-thumbnails and reads an owned, dimension-checked PNG', async () => {
  const s = setup()
  expect(await writeIconThumbnailCache(s.directory, item, s.png, () => true)).toBe(true)
  expect(s.root.getDirectoryHandle).toHaveBeenCalledWith('temp', { create: true })
  expect(s.temp.getDirectoryHandle).toHaveBeenCalledWith('asset-thumbnails', { create: true })
  expect(s.writer.write).toHaveBeenCalledWith(s.png)
  expect(s.writer.close).toHaveBeenCalledOnce()
  const blob = await readIconThumbnailCache(s.directory, item)
  expect(blob).toBeInstanceOf(Blob)
  expect(blob).not.toBeInstanceOf(File)
  expect(await blob!.arrayBuffer()).toEqual(await s.png.arrayBuffer())
  expect(s.bitmap.close).toHaveBeenCalledOnce()
})

it.each(['missing', 'corrupt', 'oversized', 'wrong-size', 'decode'] as const)('ignores a %s cache file', async (kind) => {
  const s = setup()
  if (kind === 'missing')
    s.file.getFile.mockRejectedValue(new Error('missing'))
  if (kind === 'corrupt')
    s.file.getFile.mockResolvedValue(new File(['not a png'], 'cache.png'))
  if (kind === 'oversized')
    s.file.getFile.mockResolvedValue(new File([new Uint8Array(300000)], 'cache.png'))
  if (kind === 'wrong-size') {
    new DataView(s.bytes.buffer).setUint32(16, 32768)
    s.file.getFile.mockResolvedValue(new File([s.bytes], 'cache.png'))
  }
  if (kind === 'decode')
    s.decode.mockRejectedValue(new Error('corrupt PNG'))
  expect(await readIconThumbnailCache(s.directory, item)).toBeNull()
  if (kind !== 'decode')
    expect(s.decode).not.toHaveBeenCalled()
})

it('does not request permission or write when permission is absent', async () => {
  const s = setup()
  s.root.queryPermission.mockResolvedValue('prompt')
  expect(await writeIconThumbnailCache(s.directory, item, s.png, () => true)).toBe(false)
  expect(s.root.getDirectoryHandle).not.toHaveBeenCalled()
})

it('aborts an in-flight write when the project or request changes', async () => {
  const s = setup()
  let current = true
  s.writer.write.mockImplementation(() => current = false)
  expect(await writeIconThumbnailCache(s.directory, item, s.png, () => current)).toBe(false)
  expect(s.writer.abort).toHaveBeenCalledOnce()
  expect(s.writer.close).not.toHaveBeenCalled()
})

it('treats cache-write failure as optional and aborts its stream', async () => {
  const s = setup()
  s.writer.write.mockRejectedValue(new Error('disk full'))
  expect(await writeIconThumbnailCache(s.directory, item, s.png, () => true)).toBe(false)
  expect(s.writer.abort).toHaveBeenCalledOnce()
  expect(s.writer.close).not.toHaveBeenCalled()
})
