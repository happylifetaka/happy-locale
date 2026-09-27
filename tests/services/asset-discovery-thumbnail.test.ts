import { afterEach, expect, it, vi } from 'vitest'
import { createIconThumbnail } from '~/services/asset-discovery/thumbnail'

afterEach(() => vi.unstubAllGlobals())

it('crops original-image coordinates directly to a proportionate lossless PNG and releases the canvas', async () => {
  const drawImage = vi.fn()
  const dimensions: number[][] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: vi.fn((callback: (blob: Blob) => void, type: string) => {
      dimensions.push([canvas.width, canvas.height])
      callback(new Blob(['crop'], { type }))
    }),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  const source = {} as CanvasImageSource
  const blob = await createIconThumbnail(source, { width: 800, height: 1000 }, { x: 17.5, y: 22.5, width: 320, height: 400 })
  expect(blob.type).toBe('image/png')
  expect(dimensions).toEqual([[102, 128]])
  expect(drawImage).toHaveBeenCalledExactlyOnceWith(source, 17.5, 22.5, 320, 400, 0, 0, 102, 128)
  expect([canvas.width, canvas.height]).toEqual([1, 1])
})

it('rejects out-of-image bounds before allocating a canvas', async () => {
  const createElement = vi.fn()
  vi.stubGlobal('document', { createElement })
  await expect(createIconThumbnail({} as CanvasImageSource, { width: 100, height: 100 }, { x: 95, y: 10, width: 20, height: 20 })).rejects.toThrow('はみ出し')
  expect(createElement).not.toHaveBeenCalled()
})
