import type { RegionCandidate as ProviderCandidate } from '~/services/ocr/types'
import type { OCRTextBlock, RegionCandidate } from '~/types/ocr'
import { expect, expectTypeOf, it, vi } from 'vitest'
import { createCandidateBounds } from '~/services/ocr/candidates/geometry'
import { groupCandidateLines } from '~/services/ocr/candidates/grouping'
import { normalizeCandidateBlocks } from '~/services/ocr/candidates/normalize'

function line(text: string, y: number, patch: Partial<OCRTextBlock> = {}): OCRTextBlock {
  return { text, x: 20, y, width: 150, height: 20, confidence: 90, ...patch }
}

it('filters and orders normalized copies without mutating raw OCR and preserves low-confidence selection', () => {
  const raw = [line('Low confidence', 140, { confidence: 34 }), line('Rejected', 20, { confidence: 0 }), line('Synthetic Card', 60)]
  const before = structuredClone(raw)
  const options = { imageWidth: 200, imageHeight: 200, scale: 2 }
  const normalized = normalizeCandidateBlocks(raw, options)
  expect(normalized.lines.map(block => block.text)).toEqual(['Synthetic Card', 'Low confidence'])
  expect(normalized.lines[0]).toMatchObject({ x: 10, y: 30, width: 75, height: 10 })
  const candidates = createCandidateBounds(groupCandidateLines(normalized.lines), normalized.trimmedLines, options)
  expect(candidates.map(candidate => candidate.selected)).toEqual([true, false])
  expect(raw).toEqual(before)
  expect(normalized.lines[0]).not.toBe(raw[2])
})

it('preserves confirmed label identity through scaling and grouping to use tight padding', () => {
  const label = line('CASTLE', 100, { x: 40, width: 120, height: 40 })
  const refineTextBounds = vi.fn((block: OCRTextBlock) => ({ ...block, y: block.y + 10 }))
  const options = { imageWidth: 200, imageHeight: 200, scale: 2, padding: 8, labelBounds: [label], refineTextBounds }
  const { lines, trimmedLines } = normalizeCandidateBlocks([label], options)
  expect(refineTextBounds).not.toHaveBeenCalled()
  expect(trimmedLines.has(lines[0]!)).toBe(true)
  const groups = groupCandidateLines(lines)
  expect(groups[0]?.lines[0]).toBe(lines[0])
  expect(createCandidateBounds(groups, trimmedLines, options)[0]).toMatchObject({ x: 18, y: 48, width: 64, height: 24 })
})

it('does not join prose across an intervening heading', () => {
  const before = line('Choose an ally.', 20)
  const heading = line('CASTLE', 42, { height: 8 })
  const after = line('Draw two cards.', 60)
  expect(groupCandidateLines([before, after])).toEqual([{ lines: [before, after] }])
  expect(groupCandidateLines([before, heading, after])).toEqual([{ lines: [before] }, { lines: [heading] }, { lines: [after] }])
})

it('separates only padding while preserving recognized content and input geometry', () => {
  const upper = line('Choose an ally.', 10, { height: 10 })
  const lower = line('Draw two cards.', 30, { height: 10 })
  const original = structuredClone([upper, lower])
  const options = { imageWidth: 200, imageHeight: 200, padding: 8 }
  const candidates = createCandidateBounds([{ lines: [upper] }, { lines: [lower] }], new WeakSet(), options)
  expect(candidates[0]!.y + candidates[0]!.height).toBe(24.5)
  expect(candidates[1]!.y).toBe(25.5)
  expect([upper, lower]).toEqual(original)
  const overlap = createCandidateBounds([{ lines: [upper] }, { lines: [{ ...lower, y: 15 }] }], new WeakSet(), options)
  expect(overlap[0]).toMatchObject({ y: 2, height: 26 })
  expect(overlap[1]).toMatchObject({ y: 7, height: 26 })
})

it('keeps the Provider compatibility export identical to the canonical saved candidate type', () => {
  expectTypeOf<ProviderCandidate>().toEqualTypeOf<RegionCandidate>()
})
