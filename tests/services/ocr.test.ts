import { describe, expect, it } from 'vitest'
import {
  normalizeOCRText,
  resolveOCRAssetBase,
  textInReadingOrder,
} from '../../app/services/ocr/tesseract'

describe('normalizeOCRText', () => {
  it('normalizes line endings and repeated spaces', () => {
    expect(normalizeOCRText('  Draw   2 cards. \r\n Then discard one.  ')).toBe(
      'Draw 2 cards.\nThen discard one.',
    )
  })

  it('removes empty lines', () => {
    expect(normalizeOCRText('First\n\n  \nSecond')).toBe('First\nSecond')
  })
})

describe('resolveOCRAssetBase', () => {
  it('uses root paths for local development', () => {
    expect(resolveOCRAssetBase('/')).toBe('/ocr')
  })

  it('uses the Nuxt base URL for repository deployments', () => {
    expect(resolveOCRAssetBase('/happy-locale/')).toBe('/happy-locale/ocr')
  })
})

describe('textInReadingOrder', () => {
  it('orders multiline OCR blocks from top to bottom', () => {
    expect(textInReadingOrder([
      { text: 'Third', x: 12, y: 42, width: 50, height: 10, confidence: 90 },
      { text: 'First', x: 10, y: 10, width: 50, height: 10, confidence: 90 },
      { text: 'Second', x: 11, y: 26, width: 50, height: 10, confidence: 90 },
    ])).toBe('First\nSecond\nThird')
  })

  it('orders fragments on the same visual line from left to right', () => {
    expect(textInReadingOrder([
      { text: 'right', x: 80, y: 11, width: 40, height: 12, confidence: null },
      { text: 'left', x: 10, y: 10, width: 40, height: 12, confidence: null },
      { text: 'next line', x: 10, y: 30, width: 80, height: 12, confidence: null },
    ])).toBe('left\nright\nnext line')
  })
})
