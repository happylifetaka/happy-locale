import { describe, expect, it } from 'vitest'
import {
  assertFileSize,
  assertImageDimensions,
  assertPdfPageDimensions,
  FILE_LIMITS,
} from '~/utils/file-limits'

describe('local file limits', () => {
  it('rejects oversized files before their contents are read', () => {
    expect(() => assertFileSize(
      { size: FILE_LIMITS.imageBytes + 1 },
      FILE_LIMITS.imageBytes,
      '画像',
    )).toThrow('50 MiB')
  })

  it('accepts normal images and rejects excessive dimensions or pixels', () => {
    expect(() => assertImageDimensions(4000, 3000)).not.toThrow()
    expect(() => assertImageDimensions(32_769, 100)).toThrow('一辺')
    expect(() => assertImageDimensions(20_000, 20_000)).toThrow('メガピクセル')
  })

  it('rejects excessive PDF page dimensions', () => {
    expect(() => assertPdfPageDimensions(595, 842)).not.toThrow()
    expect(() => assertPdfPageDimensions(14_401, 842)).toThrow('ページ寸法')
  })
})
