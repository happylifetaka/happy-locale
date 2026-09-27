import { afterEach, expect, it, vi } from 'vitest'
import { maskOCRAreas, prepareRegionForOCR } from '~/services/ocr/image'

afterEach(() => vi.unstubAllGlobals())

it.each(['success', 'empty-blob', 'context', 'pixels'] as const)('releases the temporary OCR canvas after %s, but not before PNG encoding completes', async (mode) => {
  let finish: BlobCallback | undefined
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => mode === 'context'
      ? null
      : {
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: () => {
            if (mode === 'pixels')
              throw new Error('pixel read failed')
            return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }
          },
          putImageData: vi.fn(),
        },
    toBlob: (callback: BlobCallback) => { finish = callback },
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  const task = prepareRegionForOCR({} as ImageBitmap, { x: 0, y: 0, width: 20, height: 10 }, { scale: 2, padding: 0 })
  if (mode === 'success' || mode === 'empty-blob') {
    expect([canvas.width, canvas.height]).toEqual([40, 20])
    const png = new Blob(['png'])
    finish!(mode === 'success' ? png : null)
    if (mode === 'success')
      await expect(task).resolves.toBe(png)
    else
      await expect(task).rejects.toThrow('OCR用画像')
  }
  else {
    await expect(task).rejects.toThrow()
    expect(finish).toBeUndefined()
  }
  expect([canvas.width, canvas.height]).toEqual([1, 1])
})

it.each([30, 230])('masks icons with the surrounding background (%i), preserving nearby punctuation and numbers', (background) => {
  const width = 20
  const height = 12
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4)
    pixels.set([background, background, background, 255], index)
  // OCR余白を白くしても、その色は背景推定へ混ぜない。
  for (let y = 0; y < height; y++)
    pixels.set([255, 255, 255, 255], y * width * 4)
  const icon = { x: 2, y: 3, width: 5, height: 5 }
  for (let y = 3; y < 8; y++) {
    for (let x = 2; x < 7; x++)
      pixels.set([255, 0, 0, 255], (y * width + x) * 4)
  }
  pixels.set([255, 255, 255, 255], (5 * width + 7) * 4)
  const before = new Uint8ClampedArray(pixels)
  maskOCRAreas(pixels, width, height, [icon], { x: 1, y: 0, width: 19, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      expect([...pixels.slice(offset, offset + 4)]).toEqual(x >= 2 && x < 7 && y >= 3 && y < 8
        ? [background, background, background, 255]
        : [...before.slice(offset, offset + 4)])
    }
  }
})
