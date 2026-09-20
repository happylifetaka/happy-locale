import type { OCRTextBlock, RegionCandidate } from '~/types/ocr'
import { FILE_LIMITS } from '~/utils/file-limits'

/** 保存した未確定候補を検証する。不正な項目を黙って捨てて検証結果を欠落させない。 */
export function parseRegionCandidates(value: unknown, imageWidth: number, imageHeight: number): RegionCandidate[] {
  const fail = (): never => {
    throw new Error('project.jsonのOCR領域候補が不正です。')
  }
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const finite = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item)
  const block = (item: unknown): OCRTextBlock => {
    if (!record(item) || typeof item.text !== 'string' || item.text.length > FILE_LIMITS.projectStringLength
      || !finite(item.x) || !finite(item.y) || !finite(item.width) || !finite(item.height)
      || item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0
      || item.x + item.width > FILE_LIMITS.imageDimension * 4 || item.y + item.height > FILE_LIMITS.imageDimension * 4
      || !(item.confidence === null || (finite(item.confidence) && item.confidence >= 0 && item.confidence <= 100))) {
      return fail()
    }
    return { text: item.text, x: item.x, y: item.y, width: item.width, height: item.height, confidence: item.confidence }
  }
  if (!Array.isArray(value) || value.length > FILE_LIMITS.projectRegionsPerCard)
    return fail()
  const ids = new Set<string>()
  let lines = 0
  return value.map((item) => {
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)
      || typeof item.selected !== 'boolean' || !Array.isArray(item.lines)
      || (item.sampleRegionId !== undefined && typeof item.sampleRegionId !== 'string')) {
      return fail()
    }
    ids.add(item.id)
    lines += item.lines.length
    if (lines > FILE_LIMITS.projectRegionsPerCard)
      return fail()
    const bounds = block(item)
    if (bounds.x + bounds.width > imageWidth + 1 || bounds.y + bounds.height > imageHeight + 1)
      return fail()
    return {
      ...bounds,
      id: item.id,
      selected: item.selected,
      lines: item.lines.map(block),
      ...(typeof item.sampleRegionId === 'string' ? { sampleRegionId: item.sampleRegionId } : {}),
    }
  })
}
