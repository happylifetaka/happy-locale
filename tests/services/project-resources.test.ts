import { afterEach, expect, it, vi } from 'vitest'
import { loadProjectAssetImages } from '~/services/project/resources'

afterEach(() => vi.unstubAllGlobals())

it('releases staged images when a later asset fails to decode', async () => {
  const first = { width: 10, height: 10, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error('corrupt asset')))
  const files = new Map([['first', new File(['ok'], 'first.png')], ['second', new File(['bad'], 'second.png')]])
  await expect(loadProjectAssetImages(files)).rejects.toThrow('corrupt asset')
  expect(first.close).toHaveBeenCalledOnce()
})

it('releases images that fail dimension validation', async () => {
  const oversized = { width: 100000, height: 100000, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(oversized))
  await expect(loadProjectAssetImages(new Map([['large', new File(['large'], 'large.png')]]))).rejects.toThrow()
  expect(oversized.close).toHaveBeenCalledOnce()
})

it('hands off successful staged images without closing them', async () => {
  const image = { width: 10, height: 10, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image))
  const loaded = await loadProjectAssetImages(new Map([['asset', new File(['ok'], 'asset.png')]]))
  expect(loaded.get('asset')).toBe(image)
  expect(image.close).not.toHaveBeenCalled()
})
