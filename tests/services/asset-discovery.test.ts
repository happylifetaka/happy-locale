import type { MeasuredOCRText } from '~/types/ocr'
import { describe, expect, it } from 'vitest'
import { extractIconCandidates } from '~/services/asset-discovery/extract'
import { discoverySimilarity, proposeIconGroups } from '~/services/asset-discovery/group'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from '~/services/asset-discovery/types'
import { assetFingerprint } from '~/utils/asset-matching'

function scene() {
  const width = 300
  const height = 300
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++)
    data.set([25, 30, 35, 255], p * 4)
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++)
        data.set(color, (py * width + px) * 4)
    }
  }
  const measured: MeasuredOCRText = {
    coordinates: 'image',
    lines: [{ x: 20, y: 140, width: 180, height: 20, text: 'Gain two symbols.', confidence: 90 }],
    words: [
      { x: 20, y: 140, width: 40, height: 20, text: 'Gain', confidence: 90 },
      { x: 70, y: 140, width: 40, height: 20, text: 'two', confidence: 90 },
    ],
  }
  // 通常の文字の連結成分・行末句読点・横長装飾を同時に用意する。
  rect(20, 140, 8, 20, [230, 230, 230, 255])
  rect(33, 140, 8, 20, [230, 230, 230, 255])
  rect(195, 157, 3, 3, [230, 230, 230, 255])
  rect(15, 125, 200, 3, [240, 190, 40, 255])
  return { width, height, data, rect, measured }
}

describe('icon discovery from measured text and pixels', () => {
  it('finds colored and monochrome icons beside text, without letters, punctuation, decorations or illustration', () => {
    const s = scene()
    s.rect(130, 136, 24, 28, [230, 35, 45, 255])
    s.rect(170, 136, 22, 28, [160, 160, 160, 255])
    s.rect(220, 30, 30, 30, [230, 35, 45, 255])
    const original = s.data.slice()
    const result = extractIconCandidates(s.data, s.width, s.height, s.measured)
    expect(result.icons.map(icon => icon.reason)).toEqual(['colored-component', 'contrast-component'])
    expect(result.icons.map(icon => icon.bounds)).toEqual([
      { x: 128, y: 134, width: 28, height: 32 },
      { x: 168, y: 134, width: 26, height: 32 },
    ])
    expect(result.truncated).toBe(false)
    expect(s.data).toEqual(original)
  })

  it('recovers an enclosing light border around a colored center', () => {
    const s = scene()
    s.rect(125, 133, 30, 34, [180, 180, 180, 255])
    s.rect(129, 137, 22, 26, [30, 180, 40, 255])
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons.map(icon => icon.bounds))
      .toEqual([{ x: 123, y: 131, width: 34, height: 38 }])
  })

  it.each([
    { background: [25, 30, 35, 255], foreground: [210, 210, 207, 255] },
    { background: [225, 225, 220, 255], foreground: [35, 35, 40, 255] },
  ])('estimates the background from the search interior when both edges cross text or decoration: %j', ({ background, foreground }) => {
    const s = scene()
    s.rect(0, 0, s.width, s.height, background)
    s.rect(20, 140, 8, 20, foreground)
    s.rect(70, 140, 8, 20, foreground)
    // Both sampled edges intersect a neighboring row or decorative band.
    s.rect(4, 124, 212, 2, foreground)
    s.rect(4, 174, 212, 2, foreground)
    s.rect(125, 133, 30, 34, foreground)
    s.rect(129, 137, 22, 26, [30, 180, 40, 255])
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons.map(icon => icon.bounds))
      .toEqual([{ x: 123, y: 131, width: 34, height: 38 }])
  })

  it('deduplicates overlapping line searches without merging adjacent distinct icons', () => {
    const s = scene()
    s.rect(130, 136, 20, 28, [230, 35, 45, 255])
    s.rect(153, 136, 20, 28, [30, 180, 40, 255])
    s.measured.lines.push({ ...s.measured.lines[0]! })
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toHaveLength(2)
  })

  it('uses actual glyph height when OCR inflates every word to the height of adjacent icons', () => {
    const s = scene()
    s.rect(46, 140, 8, 20, [230, 230, 230, 255])
    s.rect(70, 140, 8, 20, [230, 230, 230, 255])
    s.rect(83, 140, 8, 20, [230, 230, 230, 255])
    s.rect(170, 136, 22, 28, [160, 160, 160, 255])
    s.measured.lines = s.measured.lines.map(line => ({ ...line, y: 130, height: 40 }))
    s.measured.words = s.measured.words.map(word => ({ ...word, y: 130, height: 40 }))
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toHaveLength(1)
  })

  it('searches a short numeric effect with one reliable word', () => {
    const s = scene()
    s.rect(130, 136, 24, 28, [230, 35, 45, 255])
    s.measured.lines[0]!.text = '2 and +1'
    s.measured.words = [{ ...s.measured.words[0]!, text: 'and' }]
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toHaveLength(1)
  })

  it('does not rely on a low OCR confidence for icon-shaped single symbols', () => {
    const s = scene()
    s.rect(130, 136, 24, 28, [230, 35, 45, 255])
    s.measured.words.push({ x: 130, y: 136, width: 24, height: 28, text: 'O', confidence: 99 })
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toHaveLength(1)
  })

  it('does not cut a known word or explore an uppercase label, empty OCR, or invalid line', () => {
    const s = scene()
    s.rect(20, 140, 40, 20, [230, 35, 45, 255])
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toEqual([])
    s.rect(130, 136, 24, 28, [230, 35, 45, 255])
    s.measured.lines[0]!.text = 'SYNTHETIC HEADING'
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).searchedAreas).toEqual([])
    s.measured.lines[0]!.x = Number.NaN
    expect(extractIconCandidates(s.data, s.width, s.height, s.measured).icons).toEqual([])
    expect(extractIconCandidates(s.data, s.width, s.height, { coordinates: 'image', lines: [], words: [] }).icons).toEqual([])
  })

  it('reports candidate and search budgets explicitly and rejects invalid settings or pixel buffers', () => {
    const s = scene()
    s.rect(130, 136, 20, 28, [230, 35, 45, 255])
    s.rect(170, 136, 20, 28, [230, 35, 45, 255])
    const limited = extractIconCandidates(s.data, s.width, s.height, s.measured, { ...DEFAULT_ICON_DISCOVERY_SETTINGS, maximumCandidates: 1 })
    expect(limited.icons).toHaveLength(1)
    expect(limited.truncated).toBe(true)
    const noBudget = extractIconCandidates(s.data, s.width, s.height, s.measured, { ...DEFAULT_ICON_DISCOVERY_SETTINGS, maximumSearchedPixels: 1 })
    expect(noBudget).toMatchObject({ icons: [], truncated: true, examinedPixels: 0 })
    expect(() => extractIconCandidates(s.data, 1, 1, s.measured)).toThrow('画像')
    expect(() => extractIconCandidates(s.data, s.width, s.height, s.measured, { ...DEFAULT_ICON_DISCOVERY_SETTINGS, maximumCandidates: Infinity })).toThrow('上限')
  })

  it('clips edge searches and ignores transparent colored pixels', () => {
    const s = scene()
    s.measured.lines[0]!.x = 0
    s.measured.lines[0]!.width = 300
    s.rect(130, 136, 24, 28, [230, 35, 45, 0])
    const result = extractIconCandidates(s.data, s.width, s.height, s.measured)
    expect(result.icons).toEqual([])
    expect(result.searchedAreas[0]).toMatchObject({ x: 0, width: 300 })
  })
})

function fingerprint(red: number, green = 20, blue = 20) {
  const pixels = new Uint8ClampedArray(20 * 20 * 4)
  for (let y = 3; y < 17; y++) {
    for (let x = 3; x < 17; x++)
      pixels.set([red, green, blue, 255], (y * 20 + x) * 4)
  }
  return assetFingerprint(pixels, 20, 20)!
}

describe('conservative icon group proposals', () => {
  it('groups duplicates, keeps singletons and empty crops, and is independent of input order', () => {
    const samples = [
      { id: 'c', fingerprint: fingerprint(220, 180, 20) },
      { id: 'a', fingerprint: fingerprint(220) },
      { id: 'b', fingerprint: fingerprint(220) },
      { id: 'd', fingerprint: null },
    ]
    const proposal = proposeIconGroups(samples)
    const groups = proposal.groups
    expect(groups.map(group => group.memberIds)).toEqual([['a', 'b'], ['c'], ['d']])
    expect(proposeIconGroups(samples.toReversed())).toEqual(proposal)
    expect(proposal.truncated).toBe(false)
    expect(groups[0]!.minimumSimilarity).toBeCloseTo(1)
  })

  it('does not transitively group A and C merely because both resemble B', () => {
    const samples = [255, 220, 185].map((red, index) => ({ id: `${index}`, fingerprint: fingerprint(red) }))
    expect(discoverySimilarity(samples[0]!.fingerprint, samples[1]!.fingerprint)).toBeGreaterThan(0.9)
    expect(discoverySimilarity(samples[1]!.fingerprint, samples[2]!.fingerprint)).toBeGreaterThan(0.9)
    expect(proposeIconGroups(samples).groups.map(group => group.memberIds)).toEqual([['0', '1'], ['2']])
  })

  it('bounds comparison work and retains unexamined samples as ungrouped singletons', () => {
    const samples = ['a', 'b', 'c', 'd'].map(id => ({ id, fingerprint: fingerprint(220) }))
    const proposal = proposeIconGroups(samples, 0.9, 1)
    expect(proposal).toMatchObject({ comparisons: 1, truncated: true })
    expect(proposal.groups.map(group => group.memberIds)).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('rejects invalid thresholds, duplicate identities and excessive inputs', () => {
    expect(() => proposeIconGroups([], Number.NaN)).toThrow()
    expect(() => proposeIconGroups([{ id: 'a', fingerprint: null }, { id: 'a', fingerprint: null }])).toThrow()
    expect(() => proposeIconGroups(Array.from({ length: 2001 }, (_, i) => ({ id: `${i}`, fingerprint: null })))).toThrow()
  })
})
