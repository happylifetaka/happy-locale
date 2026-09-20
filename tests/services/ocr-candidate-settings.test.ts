import type { CandidateDetectionSettings } from '~/services/ocr/candidates/settings'
import type { OCRTextBlock } from '~/types/ocr'
import { expect, it } from 'vitest'
import { createRegionCandidates } from '~/services/ocr/candidates'
import { DEFAULT_CANDIDATE_DETECTION_SETTINGS } from '~/services/ocr/candidates/settings'
import { baselineOCR } from '../fixtures/refactoring-baseline'

function line(text: string, y: number, patch: Partial<OCRTextBlock> = {}): OCRTextBlock {
  return { text, x: 20, y, width: 150, height: 20, confidence: 90, ...patch }
}

function candidates(blocks: OCRTextBlock[], settings: Partial<CandidateDetectionSettings> = {}) {
  return createRegionCandidates(blocks, { imageWidth: 400, imageHeight: 400, padding: 8, settings })
}

it('can disable decorative heading corrections without changing shared defaults or later calls', () => {
  const raw = baselineOCR()
  const options = { imageWidth: 200, imageHeight: 240, scale: 2, words: raw.words }
  const before = structuredClone(raw)
  const defaults = createRegionCandidates(raw.blocks, options)
  expect(defaults.map(c => c.text)).toContain('CASTLE')
  const untrimmed = createRegionCandidates(raw.blocks, { ...options, settings: { headingDecorations: 'none' } })
  expect(untrimmed.map(c => c.text)).toContain('$ CASTLE 4')
  expect(createRegionCandidates(raw.blocks, options)).toEqual(defaults)
  expect(raw).toEqual(before)
  expect(DEFAULT_CANDIDATE_DETECTION_SETTINGS.headingDecorations).toBe('uppercase-latin')
})

it('distinguishes full layout grouping, row-only grouping and ungrouped OCR blocks', () => {
  const blocks = [line('Choose an', 20, { width: 90 }), line('ally.', 20, { x: 120, width: 50 }), line('Draw two cards.', 50)]
  expect(candidates(blocks).map(c => c.text)).toEqual(['Choose an ally.\nDraw two cards.'])
  expect(candidates(blocks, { lineGrouping: 'rows-only' }).map(c => c.text)).toEqual(['Choose an ally.', 'Draw two cards.'])
  expect(candidates(blocks, { lineGrouping: 'none' }).map(c => c.text)).toEqual(['Choose an', 'ally.', 'Draw two cards.'])
  expect(candidates(blocks, { maximumRowGapRatio: 0 }).map(c => c.text)).toEqual(['Choose an', 'ally.\nDraw two cards.'])
})

it('can turn off the uppercase label/body boundary independently of heading trimming', () => {
  const blocks = [line('CASTLE', 20), line('Draw two cards.', 50)]
  expect(candidates(blocks)).toHaveLength(2)
  expect(candidates(blocks, { labelClassification: 'none' }).map(c => c.text)).toEqual(['CASTLE\nDraw two cards.'])
})

it('uses adjustable line gaps while retaining layout safety checks', () => {
  const blocks = [line('Choose an ally.', 20), line('Draw two cards.', 65)]
  expect(candidates(blocks)).toHaveLength(2)
  expect(candidates(blocks, { maximumAlignedLargeLineGapRatio: 1.5 })).toHaveLength(1)
  expect(candidates(blocks, { maximumAlignedLineGapRatio: 0 })).toHaveLength(2)
  const labels = [line('HERO', 20), line('MAGE', 58)]
  expect(candidates(labels)).toHaveLength(2)
  expect(candidates(labels, { maximumLineGapRatio: 1 })).toHaveLength(1)
})

it.each(['row', 'paragraph'] as const)('uses the same strict selection threshold before %s grouping and after bounds creation', (layout) => {
  const blocks = [line('FIRST', 20, { width: 60, confidence: 50 }), line('SECOND', layout === 'row' ? 20 : 50, { x: layout === 'row' ? 90 : 20, width: 60, confidence: 90 })]
  expect(candidates(blocks)).toHaveLength(1)
  const selected = candidates(blocks, { initialSelectionConfidence: 50 })
  expect(selected.map(c => c.selected)).toEqual([false, true])
  expect(candidates([line('Unknown', 100, { confidence: null })], { initialSelectionConfidence: 100 })[0]?.selected).toBe(true)
})

it('resolves candidate filters per call and keeps legacy explicit options higher priority', () => {
  const blocks = [line('Low confidence', 20, { confidence: 30 })]
  expect(candidates(blocks, { minimumConfidence: 40 })).toEqual([])
  expect(createRegionCandidates(blocks, {
    imageWidth: 400,
    imageHeight: 400,
    minimumConfidence: 0,
    settings: { minimumConfidence: 40 },
  })).toHaveLength(1)
  expect(candidates(blocks)).toHaveLength(1)
  expect(candidates([line('AB', 20)])).toHaveLength(0)
  expect(candidates([line('AB', 20)], { minimumLatinLetters: 2 })).toHaveLength(1)
})

it('controls confirmed-label padding and separates only padding, never recognized content', () => {
  const label = line('CASTLE', 20)
  const options = { imageWidth: 400, imageHeight: 400, padding: 8, labelBounds: [label] }
  expect(createRegionCandidates([label], options)[0]).toMatchObject({ x: 18, y: 18, width: 154, height: 24 })
  expect(createRegionCandidates([label], { ...options, settings: { refinedPadding: 0 } })[0]).toMatchObject({ x: 20, y: 20, width: 150, height: 20 })
  const blocks = [line('CASTLE', 10, { height: 10 }), line('Draw two cards.', 30, { height: 10 })]
  const separated = candidates(blocks, { maximumPaddingGap: 4 })
  expect(separated[0]!.y + separated[0]!.height).toBe(23)
  expect(separated[1]!.y).toBe(27)
  const unseparated = candidates(blocks, { separatePadding: false })
  expect(unseparated[0]!.y + unseparated[0]!.height).toBe(28)
  expect(unseparated[1]!.y).toBe(22)
  const touching = candidates(blocks, { maximumPaddingGap: 100 })
  expect(touching[0]!.y + touching[0]!.height).toBe(20)
  expect(touching[1]!.y).toBe(30)
})
