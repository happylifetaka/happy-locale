import type { OCRTextBlock } from '~/services/ocr/types'
import { describe, expect, it } from 'vitest'
import {
  createRegionCandidates,
  splitRegionCandidate,
} from '../../app/services/ocr/candidates'

describe('createRegionCandidates', () => {
  it('rejoins overlapping prose fragments even when the icon fragment is unchecked', () => {
    const blocks = [
      { text: 'Heal an ally with', x: 10, y: 30, width: 160, height: 20, confidence: 90 },
      { text: '%, gain 3', x: 169, y: 20, width: 80, height: 40, confidence: 34 },
    ]
    const cs = createRegionCandidates(blocks, { imageWidth: 300, imageHeight: 200, padding: 0 })
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ text: 'Heal an ally with %, gain 3', x: 10, y: 20, width: 239, height: 40 })
  })

  it('rejoins prose whose icon OCR boxes slightly overlap without combining columns', () => {
    const blocks = [
      { text: 'If you have a *5', x: 10, y: 30, width: 160, height: 24, confidence: 77 },
      { text: 's, give an ally +3', x: 161, y: 20, width: 140, height: 40, confidence: 63 },
      { text: 'and draw a card', x: 40, y: 75, width: 230, height: 24, confidence: 92 },
    ]
    const cs = createRegionCandidates(blocks, { imageWidth: 400, imageHeight: 200, padding: 0 })
    expect(cs).toHaveLength(1)
    expect(cs[0]!.lines).toHaveLength(2)
    expect(cs[0]!.text).toBe('If you have a *5 s, give an ally +3\nand draw a card')
  })

  it('rescues a label with low-confidence alphabetic ornaments only with pixel evidence', () => {
    const words = [
      { text: 'noise', x: 10, y: 20, width: 60, height: 40, confidence: 0 },
      { text: 'CASTLE', x: 90, y: 20, width: 80, height: 40, confidence: 77 },
      { text: 'junk', x: 190, y: 20, width: 60, height: 40, confidence: 0 },
    ]
    const block = { text: 'noise CASTLE junk', x: 10, y: 20, width: 240, height: 40, confidence: 7 }
    const options = { imageWidth: 300, imageHeight: 200, padding: 0, words }
    const [c] = createRegionCandidates([block], { ...options, refineHeadingBounds: b => ({ ...b, x: 90, y: 30, width: 80, height: 20 }) })
    expect(c).toMatchObject({ text: 'CASTLE', x: 90, y: 30, width: 80, height: 20, confidence: 77, selected: true })
    expect(createRegionCandidates([block], { ...options, refineHeadingBounds: b => b })[0]).toMatchObject({ text: block.text, selected: false })
  })

  it('requires pixel evidence before removing a numeric ornament beside a low-confidence heading word', () => {
    const words = [
      { text: 'FOREST', x: 10, y: 20, width: 130, height: 36, confidence: 1 },
      { text: 'OR', x: 150, y: 27, width: 30, height: 20, confidence: 96 },
      { text: 'CASTLE', x: 190, y: 20, width: 110, height: 36, confidence: 94 },
      { text: '4', x: 316, y: 25, width: 27, height: 25, confidence: 69 },
      { text: '—', x: 160, y: 54, width: 30, height: 2, confidence: 0 },
    ]
    const block = { text: 'FOREST OR CASTLE 4', x: 10, y: 20, width: 333, height: 36, confidence: 65 }
    const options = { imageWidth: 400, imageHeight: 200, padding: 0, words }
    const refineHeadingBounds = (bounds: OCRTextBlock) => ({ ...bounds, x: bounds.x + 40, width: bounds.width - 40, y: bounds.y + 6, height: 24 })
    const [candidate] = createRegionCandidates([block], { ...options, refineHeadingBounds })
    expect(candidate).toMatchObject({ text: 'FOREST OR CASTLE', x: 50, width: 250, y: 26, height: 24, selected: true })
    expect(candidate!.confidence).toBeCloseTo((1 + 96 + 94) / 3)
    for (const refine of [undefined, (bounds: OCRTextBlock) => bounds, (bounds: OCRTextBlock) => ({ ...bounds, height: 24 })])
      expect(createRegionCandidates([block], { ...options, refineHeadingBounds: refine })[0]?.text).toBe(block.text)
    for (const changed of [
      words.map(word => ({ ...word, confidence: 90 })),
      words.map(word => word.text === '4' ? { ...word, width: 8 } : word),
      words.map(word => word.text === 'FOREST' ? { ...word, text: 'Forest' } : word),
    ]) {
      const original = { ...block, text: changed.slice(0, 4).map(word => word.text).join(' ') }
      expect(createRegionCandidates([original], { ...options, words: changed, refineHeadingBounds })[0]?.text).toBe(original.text)
    }
    // 行自身に含まれる記号は、薄くても無条件にテキストから捨てない。
    const withDash = { ...block, text: 'FOREST OR — CASTLE 4' }
    expect(createRegionCandidates([withDash], { ...options, refineHeadingBounds })[0]?.text).toBe(withDash.text)
  })

  it.each([0, 0.5, 3.5, 8])('separates overlapping padding without clipping content (gap=%s)', (gap) => {
    const blocks = [
      { text: 'NEXT PHASE', x: 50, y: 20, width: 100, height: 20, confidence: 92 },
      { text: 'Choose an ally.', x: 10, y: 40 + gap, width: 180, height: 25, confidence: 90 },
    ]
    const [heading, body] = createRegionCandidates(blocks, { imageWidth: 200, imageHeight: 150, padding: 6 })
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(body!.y)
    expect(heading!.y + heading!.height).toBeGreaterThanOrEqual(40)
    expect(body!.y).toBeLessThanOrEqual(40 + gap)
    expect(body!.y + body!.height).toBe(Math.ceil(71 + gap))
    expect(body!.y - heading!.y - heading!.height).toBeCloseTo(Math.min(1, gap))
    expect(heading!.lines).toEqual([blocks[0]])
    expect(body!.lines).toEqual([blocks[1]])
  })

  it('does not clip overlapping OCR content or adjust independent columns', () => {
    const heading = { text: 'NEXT PHASE', x: 50, y: 20, width: 100, height: 20, confidence: 92 }
    const body = { text: 'Choose an ally.', x: 10, y: 38, width: 180, height: 25, confidence: 90 }
    const candidates = createRegionCandidates([heading, body], { imageWidth: 400, imageHeight: 150, padding: 6 })
    expect(candidates.map(c => [c.y, c.height])).toEqual([[14, 32], [32, 37]])
    const columns = createRegionCandidates([heading, { ...body, x: 200, y: 44 }], { imageWidth: 400, imageHeight: 150, padding: 6 })
    expect(columns.map(c => [c.y, c.height])).toEqual([[14, 32], [38, 37]])
  })

  it('separates both ends of a candidate between two other candidates', () => {
    const candidates = createRegionCandidates([
      { text: 'FIRST LABEL', x: 50, y: 20, width: 100, height: 20, confidence: 92 },
      { text: 'Choose an ally.', x: 10, y: 44, width: 180, height: 20, confidence: 90 },
      { text: 'NEXT LABEL', x: 50, y: 68, width: 100, height: 20, confidence: 92 },
    ], { imageWidth: 200, imageHeight: 150, padding: 6 })
    expect(candidates).toHaveLength(3)
    for (let i = 0; i < candidates.length - 1; i++)
      expect(candidates[i]!.y + candidates[i]!.height).toBeLessThan(candidates[i + 1]!.y)
    expect(candidates[1]!.y).toBeLessThanOrEqual(44)
    expect(candidates[1]!.y + candidates[1]!.height).toBeGreaterThanOrEqual(64)
  })

  it('separates a name, type, repeated headings and multiline effects without game-specific words', () => {
    const candidates = createRegionCandidates([
      { text: 'Silver Keeper', x: 30, y: 10, width: 140, height: 24, confidence: 90 },
      { text: 'FOREST • GUIDE', x: 40, y: 42, width: 120, height: 12, confidence: 90 },
      { text: 'WHEN PLAYED', x: 60, y: 72, width: 80, height: 12, confidence: 90 },
      { text: 'Choose an ally,', x: 30, y: 90, width: 140, height: 14, confidence: 90 },
      { text: 'then draw a card.', x: 30, y: 110, width: 140, height: 14, confidence: 90 },
      { text: 'END OF TURN', x: 60, y: 141, width: 80, height: 12, confidence: 90 },
      { text: 'Return one card.', x: 30, y: 160, width: 140, height: 14, confidence: 90 },
    ], { imageWidth: 200, imageHeight: 200, padding: 0 })

    expect(candidates.map(candidate => candidate.text)).toEqual([
      'Silver Keeper',
      'FOREST • GUIDE',
      'WHEN PLAYED',
      'Choose an ally,\nthen draw a card.',
      'END OF TURN',
      'Return one card.',
    ])
  })

  it('rejoins a fragmented title before grouping vertically, keeping its reading order and bounds', () => {
    const candidates = createRegionCandidates([
      { text: 'Keeper', x: 93, y: 10, width: 70, height: 20, confidence: 80 },
      { text: 'Silver', x: 10, y: 12, width: 65, height: 20, confidence: 90 },
      { text: 'FOREST GUIDE', x: 10, y: 40, width: 153, height: 12, confidence: 90 },
      { text: 'Draw a card.', x: 10, y: 64, width: 153, height: 14, confidence: 90 },
    ], { imageWidth: 200, imageHeight: 150, padding: 0 })

    expect(candidates.map(candidate => candidate.text)).toEqual(['Silver Keeper', 'FOREST GUIDE', 'Draw a card.'])
    expect(candidates[0]).toMatchObject({ x: 10, y: 10, width: 153, height: 22 })
    expect(candidates[0]?.lines).toHaveLength(1)
    expect(splitRegionCandidate(candidates[0]!)).toBeNull()
  })

  it('joins same-row fragments with an inflated icon box and slight OCR overlap', () => {
    const candidates = createRegionCandidates([
      { text: 'Choose an ally', x: 10, y: 25, width: 90, height: 12, confidence: 90 },
      { text: 'and draw a card.', x: 99, y: 20, width: 95, height: 26, confidence: 90 },
      { text: 'Then discard one.', x: 10, y: 50, width: 184, height: 12, confidence: 90 },
    ], { imageWidth: 210, imageHeight: 150, padding: 0 })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.text).toBe('Choose an ally and draw a card.\nThen discard one.')
    expect(candidates[0]?.lines).toHaveLength(2)
  })

  it('does not use a tall noisy line to bridge a paragraph gap', () => {
    const candidates = createRegionCandidates([
      { text: 'First effect.', x: 10, y: 10, width: 140, height: 40, confidence: 90 },
      { text: 'Another effect.', x: 10, y: 68, width: 140, height: 12, confidence: 90 },
    ], { imageWidth: 200, imageHeight: 150, padding: 0 })
    expect(candidates).toHaveLength(2)
  })

  it('retains left-aligned body lines with icon-sized boxes and generous line spacing', () => {
    const candidates = createRegionCandidates([
      { text: 'Choose a direction.', x: 10, y: 10, width: 130, height: 15, confidence: 90 },
      { text: 'Spend two tokens and move.', x: 11, y: 45, width: 220, height: 33, confidence: 90 },
      { text: 'Then end your turn.', x: 10, y: 99, width: 210, height: 20, confidence: 90 },
    ], { imageWidth: 250, imageHeight: 150, padding: 0 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.lines).toHaveLength(3)
  })

  it('does not extend body spacing tolerance to uncertain illustration text above a title', () => {
    const candidates = createRegionCandidates([
      { text: 'Ink', x: 32, y: 10, width: 55, height: 48, confidence: 54 },
      { text: 'Silver Keeper', x: 10, y: 110, width: 200, height: 47, confidence: 90 },
    ], { imageWidth: 250, imageHeight: 200, padding: 0 })
    expect(candidates).toHaveLength(2)
  })

  it('does not bridge across an intervening heading when a later line has noisy mixed case', () => {
    const candidates = createRegionCandidates([
      { text: 'A first effect.', x: 10, y: 10, width: 150, height: 30, confidence: 90 },
      { text: 'NEXT PHASE', x: 40, y: 35, width: 90, height: 10, confidence: 90 },
      { text: 'A second effect.', x: 10, y: 47, width: 150, height: 30, confidence: 90 },
    ], { imageWidth: 200, imageHeight: 150, padding: 0 })
    expect(candidates).toHaveLength(3)
  })

  it('separates differently sized uppercase labels but retains multiline types', () => {
    const candidates = createRegionCandidates([
      { text: 'FOREST GUIDE', x: 10, y: 10, width: 160, height: 12, confidence: 90 },
      { text: 'LEGENDARY', x: 50, y: 27, width: 80, height: 12, confidence: 90 },
      { text: 'NEXT PHASE', x: 30, y: 46, width: 120, height: 20, confidence: 90 },
    ], { imageWidth: 200, imageHeight: 150, padding: 0 })
    expect(candidates.map(candidate => candidate.text)).toEqual(['FOREST GUIDE\nLEGENDARY', 'NEXT PHASE'])
  })

  it('keeps distant columns separate and preserves ordinary paragraphs without headings', () => {
    const candidates = createRegionCandidates([
      { text: 'Left first.', x: 10, y: 10, width: 70, height: 12, confidence: 90 },
      { text: 'Right first.', x: 150, y: 10, width: 70, height: 12, confidence: 90 },
      { text: 'Left second.', x: 10, y: 28, width: 70, height: 12, confidence: 90 },
      { text: 'Right second.', x: 150, y: 28, width: 70, height: 12, confidence: 90 },
    ], { imageWidth: 250, imageHeight: 150, padding: 0 })
    expect(candidates.map(candidate => candidate.text)).toEqual(['Left first.\nLeft second.', 'Right first.\nRight second.'])
  })

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

  it('filters short, symbol-heavy, and tiny fragments but retains low-confidence candidates unchecked', () => {
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

    expect(candidates.map(candidate => [candidate.text, candidate.selected])).toEqual([
      ['Low confidence', false],
      ['Useful text', false],
    ])
  })

  it.each([0.1, 1, 29, 34, 40, 40.1, 90, null])('selects only confidence above 40 (or unknown): %s', (confidence) => {
    const [candidate] = createRegionCandidates([
      { text: 'Example text', x: 10, y: 10, width: 100, height: 12, confidence },
    ], { imageWidth: 200, imageHeight: 200 })
    expect(candidate?.selected).toBe(confidence === null || confidence > 40)
  })

  it('does not absorb unchecked noise into a checked line or paragraph', () => {
    const candidates = createRegionCandidates([
      { text: 'Some text', x: 10, y: 10, width: 100, height: 12, confidence: 90 },
      { text: 'Noise abc', x: 115, y: 10, width: 60, height: 12, confidence: 34 },
      { text: 'Noise def', x: 10, y: 28, width: 100, height: 12, confidence: 40 },
    ], { imageWidth: 200, imageHeight: 200 })
    expect(candidates.map(candidate => candidate.selected)).toEqual([true, false, false])
  })

  it('can still explicitly filter confidence when requested', () => {
    expect(createRegionCandidates([
      { text: 'Example text', x: 10, y: 10, width: 100, height: 12, confidence: 29 },
    ], { imageWidth: 200, imageHeight: 200, minimumConfidence: 30 })).toEqual([])
  })

  it('excludes zero-confidence noise before it can join another candidate', () => {
    const candidates = createRegionCandidates([
      { text: 'Noise text', x: 10, y: 10, width: 50, height: 12, confidence: 0 },
      { text: 'Useful text', x: 65, y: 10, width: 80, height: 12, confidence: 34 },
    ], { imageWidth: 200, imageHeight: 200, minimumConfidence: 0, padding: 0 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ text: 'Useful text', x: 65, width: 80, confidence: 34, selected: false })
  })

  const headingWords = [
    { text: '$', x: 10, y: 20, width: 30, height: 30, confidence: 14 },
    { text: 'FOREST', x: 50, y: 20, width: 90, height: 30, confidence: 93 },
    { text: '4', x: 150, y: 20, width: 30, height: 30, confidence: 58 },
  ]
  const heading = { text: '$ FOREST 4', x: 10, y: 20, width: 170, height: 30, confidence: 55 }

  it('uses central heading word coordinates without decorative end tokens, in original image units', () => {
    const [candidate] = createRegionCandidates([heading], {
      words: headingWords,
      imageWidth: 200,
      imageHeight: 200,
      scale: 2,
      padding: 6,
    })
    expect(candidate).toMatchObject({ text: 'FOREST', x: 23, y: 8, width: 49, height: 19, confidence: 93, selected: true })
    expect(candidate?.lines).toEqual([{ text: 'FOREST', x: 25, y: 10, width: 45, height: 15, confidence: 93 }])
  })

  it('retains original text and bounds without reliable word geometry', () => {
    for (const words of [undefined, [], headingWords.slice(0, 2), headingWords.map(word => ({ ...word, confidence: 90 })), headingWords.map(word => ({ ...word, width: word.text === 'FOREST' ? word.width : 10 }))]) {
      const [candidate] = createRegionCandidates([heading], { words, imageWidth: 200, imageHeight: 200, padding: 0 })
      expect(candidate).toMatchObject(heading)
    }
  })

  it('does not strip numbers or symbols from ordinary sentences', () => {
    const words = headingWords.map(word => word.text === 'FOREST' ? { ...word, text: 'Gain' } : word)
    const [candidate] = createRegionCandidates([{ ...heading, text: '$ Gain 4' }], { words, imageWidth: 200, imageHeight: 200, padding: 0 })
    expect(candidate?.text).toBe('$ Gain 4')
  })

  it('keeps all words of a heading when only the leading ornament is a separate symbol', () => {
    const words = [
      { text: '¥', x: 10, y: 20, width: 20, height: 20, confidence: 0 },
      { text: 'FOREST', x: 28, y: 14, width: 100, height: 36, confidence: 95 },
      { text: 'OR', x: 138, y: 20, width: 30, height: 30, confidence: 95 },
      { text: 'CASTLE.', x: 178, y: 14, width: 110, height: 36, confidence: 40 },
    ]
    const block = { text: '¥ FOREST OR CASTLE.', x: 10, y: 14, width: 278, height: 36, confidence: 52 }
    const options = { imageWidth: 400, imageHeight: 300, padding: 0 }
    const [candidate] = createRegionCandidates([block], { ...options, words })
    expect(candidate).toMatchObject({ text: 'FOREST OR CASTLE', x: 28, width: 260, selected: true })
    expect(candidate?.lines).toHaveLength(1)
    for (const unchanged of [
      words.map(word => ({ ...word, confidence: 90 })),
      words.map(word => ({ ...word, confidence: 30 })),
      words.map(word => word.text === 'FOREST' ? { ...word, text: 'Forest' } : word),
    ]) {
      const original = { ...block, text: unchanged.map(word => word.text).join(' ') }
      expect(createRegionCandidates([original], { ...options, words: unchanged })[0]?.text).toBe(original.text)
    }
  })

  it('matches overflowing word boxes and removes a single leading decoration', () => {
    const block = { text: '® FORTRESS', x: 10, y: 10, width: 170, height: 27, confidence: 64 }
    const words = [
      { text: '®', x: 10, y: 10, width: 34, height: 32, confidence: 35 },
      { text: 'FORTRESS', x: 60, y: 12, width: 140, height: 30, confidence: 92 },
      { text: 'Nearby', x: 205, y: 35, width: 80, height: 30, confidence: 90 },
    ]
    const options = { imageWidth: 300, imageHeight: 200, scale: 2, padding: 0 }
    expect(createRegionCandidates([block], { ...options, words })[0]).toMatchObject({
      text: 'FORTRESS',
      x: 30,
      y: 6,
      width: 70,
      height: 15,
      confidence: 92,
      selected: true,
    })
    for (const changed of [
      words.map(word => ({ ...word, confidence: 90 })),
      words.map(word => word.text === 'FORTRESS' ? { ...word, x: 140 } : word),
      words.map(word => word.text === '®' ? { ...word, width: 8 } : word),
    ]) {
      expect(createRegionCandidates([block], { ...options, words: changed })[0]?.text).toBe(block.text)
    }
  })

  it('removes a single trailing ornament without removing a numeric label', () => {
    const words = [
      { text: 'FORTRESS', x: 10, y: 10, width: 140, height: 30, confidence: 92 },
      { text: '®', x: 165, y: 10, width: 34, height: 32, confidence: 35 },
    ]
    const block = { text: 'FORTRESS ®', x: 10, y: 10, width: 189, height: 32, confidence: 64 }
    const options = { imageWidth: 300, imageHeight: 200, padding: 0 }
    expect(createRegionCandidates([block], { ...options, words })[0]?.text).toBe('FORTRESS')
    const numeric = words.map(word => word.text === '®' ? { ...word, text: '4' } : word)
    expect(createRegionCandidates([{ ...block, text: 'FORTRESS 4' }], { ...options, words: numeric })[0]?.text).toBe('FORTRESS 4')
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
