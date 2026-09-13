import type { OCRLayout } from '~/services/ocr/types'
import type { TextRegion } from '~/types/editor'

/** Older projects have no saved layout; infer a single line only for wide, short text regions. */
export function regionTextLayout(region: TextRegion): OCRLayout {
  if (region.ocrLayout)
    return region.ocrLayout
  return region.originalText.trim() && !/[\r\n]/u.test(region.originalText.trim())
    && region.width >= region.height * 3
    ? 'single-line'
    : 'text-block'
}
