import { expect, it } from 'vitest'
import { maskOCRAreas } from '~/services/ocr/image'

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
