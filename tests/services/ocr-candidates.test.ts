import { describe, expect, it } from 'vitest'
import {
  createRegionCandidates,
  splitRegionCandidate,
} from '../../app/services/ocr/candidates'

describe('createRegionCandidates', () => {
  it('converts scaled OCR coordinates and groups nearby lines', () => {
    const candidates = createRegionCandidates(
      [
        { text: 'Draw two cards.', x: 40, y: 60, width: 200, height: 24, confidence: 90 },
        { text: 'Then discard one.', x: 44, y: 90, width: 210, height: 24, confidence: 80 },
      ],
      { scale: 2, imageWidth: 200, imageHeight: 150, padding: 4 },
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      text: 'Draw two cards.\nThen discard one.',
      x: 16,
      y: 26,
      width: 115,
      height: 35,
      confidence: 85,
      selected: true,
    })
  })

  it('keeps distant text as separate candidates and clamps padding', () => {
    const candidates = createRegionCandidates(
      [
        { text: 'Title', x: 2, y: 2, width: 40, height: 10, confidence: null },
        { text: 'Rules', x: 50, y: 80, width: 60, height: 10, confidence: 70 },
      ],
      { imageWidth: 100, imageHeight: 90, padding: 8 },
    )

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({ x: 0, y: 0 })
    expect(candidates[1]).toMatchObject({
      x: 42,
      y: 72,
      width: 58,
      height: 18,
    })
  })

  it('filters low-confidence, short, symbol-heavy, and tiny OCR fragments', () => {
    const candidates = createRegionCandidates(
      [
        { text: 'Low confidence', x: 10, y: 10, width: 80, height: 10, confidence: 29 },
        { text: 'AB', x: 10, y: 30, width: 20, height: 10, confidence: 90 },
        { text: 'ABC!!!???', x: 10, y: 50, width: 60, height: 10, confidence: 90 },
        { text: 'Tiny text', x: 10, y: 70, width: 60, height: 1, confidence: 90 },
        { text: 'Useful text', x: 10, y: 90, width: 70, height: 10, confidence: 30 },
      ],
      { imageWidth: 200, imageHeight: 200, padding: 0 },
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.text).toBe('Useful text')
  })

  it('keeps candidates whose OCR confidence is unavailable', () => {
    const candidates = createRegionCandidates(
      [
        { text: 'Unknown confidence', x: 10, y: 10, width: 100, height: 10, confidence: null },
      ],
      { imageWidth: 200, imageHeight: 200 },
    )

    expect(candidates).toHaveLength(1)
  })

  it('splits a multiline candidate into upper and lower candidates', () => {
    const [candidate] = createRegionCandidates(
      [
        { text: 'First line', x: 10, y: 10, width: 80, height: 10, confidence: 90 },
        { text: 'Second line', x: 10, y: 24, width: 90, height: 10, confidence: 80 },
        { text: 'Third line', x: 10, y: 38, width: 70, height: 10, confidence: 70 },
        { text: 'Fourth line', x: 10, y: 52, width: 85, height: 10, confidence: 60 },
      ],
      { imageWidth: 200, imageHeight: 200, padding: 4 },
    )
    const parts = splitRegionCandidate(candidate!, 4)

    expect(parts).not.toBeNull()
    expect(parts?.[0]).toMatchObject({
      id: 'candidate_1_a',
      text: 'First line\nSecond line',
      selected: true,
    })
    expect(parts?.[1]).toMatchObject({
      id: 'candidate_1_b',
      text: 'Third line\nFourth line',
      selected: true,
    })
    expect(parts?.[0].y).toBeLessThan(parts?.[1].y ?? 0)
  })

  it('does not split a single-line candidate', () => {
    const [candidate] = createRegionCandidates(
      [
        { text: 'Only one line', x: 10, y: 10, width: 80, height: 10, confidence: 90 },
      ],
      { imageWidth: 200, imageHeight: 200 },
    )

    expect(splitRegionCandidate(candidate!)).toBeNull()
  })
})
