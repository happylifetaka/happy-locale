import type { PdfAnalysis, PositionedPdfTextItem } from '../../app/services/pdf'
import { describe, expect, it } from 'vitest'
import {
  addPdfOcrEntry,
  analyzePdf,
  createPdfBackgroundPatch,
  createTranslatedPdf,
  entriesForPdfTranslation,
  estimatePdfTextColor,
  fingerprintPdfFile,
  fitPdfText,
  groupPdfTextItems,
  isPdfEntryProtected,
  matchPdfTranslations,
  mergePdfEntryWithNext,
  movePdfEntry,
  normalizePdfLoadError,
  parsePdfTranslationCsv,
  pdfFeatureWarnings,
  pdfImagePlacement,
  pdfProcessingErrorMessage,
  pdfRectangleToViewportBounds,
  pdfTextLinePlacements,
  requiresPdfPageWarning,
  serializePdfTranslationCsv,
  splitPdfEntryAtLines,
  updatePdfEntryOriginal,
  viewportBoundsToPdfRectangle,
} from '../../app/services/pdf'

class TestImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function item(
  text: string,
  x: number,
  baselineY = 700,
  hasEOL = false,
): PositionedPdfTextItem {
  return {
    text,
    x,
    baselineY,
    width: text.length * 6,
    height: 10,
    fontSize: 10,
    hasEOL,
  }
}

function analysis(): PdfAnalysis {
  const entries = groupPdfTextItems(1, [
    item('Draw', 20),
    item('two cards.', 52, 700, true),
    item('Discard one.', 20, 680, true),
  ])
  return {
    fileName: 'rules.pdf',
    sourceFingerprint: 'test-fingerprint',
    kind: 'mixed',
    pageCount: 2,
    pages: [
      { pageNumber: 1, kind: 'text', width: 600, height: 800, textCount: 2, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] },
      { pageNumber: 2, kind: 'image', width: 600, height: 800, textCount: 0, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] },
    ],
    entries,
    features: { formFields: 0, links: 0, annotations: 0 },
  }
}

describe('pdf translation', () => {
  it('merges partial CSV translations without clearing existing or unmatched entries', () => {
    const source = analysis()
    const [first, second] = source.entries
    const existing = new Map([[first!.id, '既存訳1'], [second!.id, '既存訳2']])
    const row = { pageNumber: first!.pageNumber, textId: first!.id, fileName: source.fileName, original: first!.original, translation: '更新訳' }
    const result = matchPdfTranslations(source, [row], existing)
    expect(result.applied).toBe(1)
    expect(result.translations.get(first!.id)).toBe('更新訳')
    expect(result.translations.get(second!.id)).toBe('既存訳2')
    expect(existing.get(first!.id)).toBe('既存訳1')
    const wrongFile = matchPdfTranslations(source, [{ ...row, fileName: 'other.pdf' }], existing)
    expect(wrongFile.applied).toBe(0)
    expect(wrongFile.translations).toEqual(existing)
    expect(matchPdfTranslations(source, [], existing).translations).toEqual(existing)
    expect(matchPdfTranslations(source, [{ ...row, translation: '' }], existing).translations.get(first!.id)).toBe('')
  })
  it('fits and places searchable PDF text in viewport reading order', () => {
    const font = { widthOfTextAtSize: (text: string, size: number) => text.length * size }
    const layout = fitPdfText(font, 'ABCD', 20, 24, 10)
    const entry = analysis().entries[0]!

    expect(layout).toEqual({
      fontSize: 10,
      lineHeight: 12,
      lines: ['AB', 'CD'],
    })
    expect(pdfTextLinePlacements(entry, analysis().pages[0]!, layout))
      .toEqual([
        { text: 'AB', x: entry.x, y: entry.y + entry.height - 10, rotation: 0 },
        { text: 'CD', x: entry.x, y: entry.y + entry.height - 22, rotation: 0 },
      ])
  })

  it('round-trips rectangles through rotated and cropped page coordinates', () => {
    const page = {
      height: 500,
      rotation: 90,
      viewportTransform: [0, 1, 1, 0, -25, -10] as const,
    }
    const source = { x: 40, y: 70, width: 120, height: 30 }
    const viewport = pdfRectangleToViewportBounds(
      source,
      page.height,
      [...page.viewportTransform],
    )

    expect(viewportBoundsToPdfRectangle(viewport, {
      ...page,
      viewportTransform: [...page.viewportTransform],
    })).toEqual(source)
    expect(pdfImagePlacement(viewport, {
      ...page,
      viewportTransform: [...page.viewportTransform],
    })).toMatchObject({
      x: source.x + source.width,
      y: source.y,
      width: viewport.width,
      height: viewport.height,
      rotation: 90,
    })
  })

  it('creates a stable SHA-256 fingerprint for the source PDF', async () => {
    await expect(fingerprintPdfFile(new Blob([]))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('adds OCR text only for the selected PDF rectangle', () => {
    const source = analysis()
    const result = addPdfOcrEntry(source, 2, {
      x: 40,
      y: 100,
      width: 220,
      height: 60,
    }, ' Image text\nSecond line ')

    expect(result.entry).toMatchObject({
      id: 'p0002-o0001',
      pageNumber: 2,
      original: 'Image text\nSecond line',
      x: 40,
      y: 640,
      width: 220,
      height: 60,
    })
    expect(result.analysis.entries.at(-1)).toBe(result.entry)
    expect(source.entries).toHaveLength(2)
  })

  it('describes unsupported PDF passwords and interactive features', () => {
    const passwordError = new Error('password required')
    passwordError.name = 'PasswordException'

    expect(normalizePdfLoadError(passwordError).message).toContain('パスワード付きPDF')
    expect(pdfFeatureWarnings({
      formFields: 2,
      links: 1,
      annotations: 3,
    })).toEqual([
      'フォーム2件は編集対象外です。出力後の入力値と動作を確認してください。',
      'リンク1件は編集せず保持します。出力後のリンク先を確認してください。',
      '注釈3件は編集せず保持します。出力後の表示を確認してください。',
    ])
  })

  it('warns for large PDFs and describes catchable memory failures', () => {
    expect(requiresPdfPageWarning(100)).toBe(false)
    expect(requiresPdfPageWarning(101)).toBe(true)
    expect(pdfProcessingErrorMessage(
      new RangeError('Array buffer allocation failed'),
      'fallback',
    )).toContain('メモリを確保できませんでした')
    expect(pdfProcessingErrorMessage(new Error('broken PDF'), 'fallback'))
      .toBe('broken PDF')
    expect(pdfProcessingErrorMessage(null, 'fallback')).toBe('fallback')
  })

  it('stops PDF analysis and export when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const source = new File([], 'rules.pdf', { type: 'application/pdf' })

    await expect(analyzePdf(source, undefined, controller.signal))
      .rejects
      .toMatchObject({ name: 'AbortError' })
    await expect(createTranslatedPdf(
      source,
      analysis(),
      new Map(),
      undefined,
      undefined,
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('groups translation work by page while preserving order within a page', () => {
    const source = analysis()
    source.entries = [
      { ...source.entries[0]!, id: 'page-2', pageNumber: 2 },
      { ...source.entries[0]!, id: 'page-1-first' },
      { ...source.entries[1]!, id: 'page-1-second' },
    ]
    const translations = new Map(source.entries.map(entry => [
      entry.id,
      `訳文:${entry.id}`,
    ]))

    expect(entriesForPdfTranslation(source, translations).map(entry => entry.id))
      .toEqual(['page-1-first', 'page-1-second', 'page-2'])
  })

  it('groups adjacent PDF text items into stable line entries', () => {
    const entries = analysis().entries

    expect(entries.map(entry => [entry.id, entry.original])).toEqual([
      ['p0001-t0001', 'Draw two cards.'],
      ['p0001-t0002', 'Discard one.'],
    ])
  })

  it('round-trips translation CSV including commas and newlines', () => {
    const source = analysis()
    const csv = serializePdfTranslationCsv(source, new Map([
      ['p0001-t0001', 'カードを2枚引く。\nその後、確認する。'],
    ]))
    const rows = parsePdfTranslationCsv(csv)

    expect(rows[0]).toMatchObject({
      fileName: 'rules.pdf',
      pageNumber: 1,
      textId: 'p0001-t0001',
      original: 'Draw two cards.',
      translation: 'カードを2枚引く。\nその後、確認する。',
    })
  })

  it('omits entries explicitly excluded from translation CSV', () => {
    const source = analysis()
    const csv = serializePdfTranslationCsv(
      source,
      new Map(),
      new Set(['p0001-t0002']),
    )

    expect(csv).toContain('p0001-t0001')
    expect(csv).not.toContain('p0001-t0002')
  })

  it('omits excluded entries from translated PDF replacements', () => {
    const source = analysis()
    const translations = new Map([
      ['p0001-t0001', 'カードを2枚引く。'],
      ['p0001-t0002', 'カードを1枚捨てる。'],
    ])

    expect(entriesForPdfTranslation(source, translations, {
      excludedEntryIds: new Set(['p0001-t0002']),
    }).map(entry => entry.id)).toEqual(['p0001-t0001'])
  })

  it('updates extracted text without changing its stable ID or geometry', () => {
    const source = analysis()
    const previous = source.entries[0]!
    const updated = updatePdfEntryOriginal(
      source,
      previous.id,
      ' Draw three cards. ',
    ).entries[0]!

    expect(updated).toEqual({ ...previous, original: 'Draw three cards.' })
    expect(source.entries[0]!.original).toBe('Draw two cards.')
    expect(() => updatePdfEntryOriginal(source, previous.id, ' ')).toThrow(
      '抽出原文を入力',
    )
  })

  it('moves extracted text within its page without changing stable IDs', () => {
    const source = analysis()
    const moved = movePdfEntry(source, 'p0001-t0002', -1)

    expect(moved.entries.map(entry => entry.id)).toEqual([
      'p0001-t0002',
      'p0001-t0001',
    ])
    expect(movePdfEntry(moved, 'p0001-t0002', -1)).toBe(moved)
    expect(source.entries.map(entry => entry.id)).toEqual([
      'p0001-t0001',
      'p0001-t0002',
    ])
  })

  it('merges adjacent extracted text while retaining the first stable ID', () => {
    const source = analysis()
    const first = source.entries[0]!
    const second = source.entries[1]!
    const result = mergePdfEntryWithNext(source, first.id)!
    const merged = result.analysis.entries[0]!

    expect(result).toMatchObject({
      retainedEntryId: first.id,
      removedEntryIds: [second.id],
      createdEntryIds: [],
    })
    expect(merged).toMatchObject({
      id: first.id,
      original: 'Draw two cards.\nDiscard one.',
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
    })
    expect(merged.width).toBe(
      Math.max(first.x + first.width, second.x + second.width) - merged.x,
    )
    expect(merged.height).toBe(
      Math.max(first.y + first.height, second.y + second.height) - merged.y,
    )
    expect(source.entries).toHaveLength(2)
    expect(mergePdfEntryWithNext(source, second.id)).toBeNull()
  })

  it('splits extracted text at newlines with unique stable IDs and geometry', () => {
    const source = analysis()
    source.entries.push({ ...source.entries[1]!, id: 'p0001-t0001-s2' })
    const entry = source.entries[0]!
    const result = splitPdfEntryAtLines(
      source,
      entry.id,
      'First line\n\n Second line \nThird line',
    )!
    const split = result.analysis.entries.slice(0, 3)

    expect(split.map(candidate => [candidate.id, candidate.original])).toEqual([
      [entry.id, 'First line'],
      ['p0001-t0001-s3', 'Second line'],
      ['p0001-t0001-s4', 'Third line'],
    ])
    expect(split.map(candidate => candidate.y)).toEqual([
      entry.y + entry.height * 2 / 3,
      entry.y + entry.height / 3,
      entry.y,
    ])
    expect(split.every(candidate => candidate.height === entry.height / 3)).toBe(true)
    expect(result.createdEntryIds).toEqual([
      'p0001-t0001-s3',
      'p0001-t0001-s4',
    ])
    expect(source.entries[0]!.original).toBe('Draw two cards.')
    expect(splitPdfEntryAtLines(source, entry.id, 'one line')).toBeNull()
  })

  it('neutralizes spreadsheet formulas in PDF CSV and restores them on import', () => {
    const source = analysis()
    source.entries[0]!.original = '=1+1'
    const csv = serializePdfTranslationCsv(source, new Map([
      ['p0001-t0001', '@SUM(A1:A2)'],
    ]))

    expect(csv).toContain('\t=1+1')
    expect(csv).toContain('\t@SUM(A1:A2)')
    expect(parsePdfTranslationCsv(csv)[0]).toMatchObject({
      original: '=1+1',
      translation: '@SUM(A1:A2)',
    })
  })

  it('matches by stable text ID and reports stale rows', () => {
    const source = analysis()
    const result = matchPdfTranslations(source, [
      {
        fileName: 'rules.pdf',
        pageNumber: 1,
        textId: 'p0001-t0001',
        original: 'Changed original',
        translation: 'カードを2枚引く。',
      },
      {
        fileName: 'other.pdf',
        pageNumber: 1,
        textId: 'p0001-t0002',
        original: 'Discard one.',
        translation: 'カードを1枚捨てる。',
      },
      {
        fileName: 'rules.pdf',
        pageNumber: 2,
        textId: 'missing',
        original: '',
        translation: '未一致',
      },
      {
        fileName: 'rules.pdf',
        pageNumber: 1,
        textId: 'p0001-t0001',
        original: 'Draw two cards.',
        translation: 'カードを二枚引く。',
      },
    ])

    expect(result.translations.get('p0001-t0001')).toBe('カードを二枚引く。')
    expect(result).toMatchObject({
      applied: 1,
      unmatched: 1,
      duplicateRows: 1,
      originalMismatches: 1,
      fileMismatches: 1,
    })
  })

  it('blends a PDF text background', () => {
    const width = 32
    const height = 32
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      data.set([40, 90, 60, 255], index * 4)
    }
    const entry: PdfAnalysis['entries'][number] = {
      id: 'p0001-t0001',
      pageNumber: 1,
      original: 'Text',
      x: 8,
      y: 8,
      width: 8,
      height: 6,
      fontSize: 6,
    }

    const patch = createPdfBackgroundPatch(
      entry,
      { image: new ImageData(data, width, height), pageHeight: 30, scale: 1 },
      2,
    )

    expect([...patch.data.slice(0, 3)]).toEqual([40, 90, 60])
  })

  it('excludes a text entry when it overlaps a page protection area', () => {
    const entry: PdfAnalysis['entries'][number] = {
      id: 'p0001-t0001',
      pageNumber: 1,
      original: 'Text',
      x: 8,
      y: 8,
      width: 8,
      height: 6,
      fontSize: 6,
    }

    expect(isPdfEntryProtected(
      entry,
      30,
      [{ x: 10, y: 17, width: 3, height: 3 }],
    )).toBe(true)
    expect(isPdfEntryProtected(
      entry,
      30,
      [{ x: 20, y: 17, width: 3, height: 3 }],
    )).toBe(false)
  })

  it('estimates a light original text color on a dark background', () => {
    const width = 32
    const height = 32
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1)
      data.set([35, 70, 45, 255], index * 4)
    for (let y = 17; y <= 20; y += 1) {
      for (let x = 9; x <= 14; x += 1)
        data.set([240, 235, 220, 255], (y * width + x) * 4)
    }
    const entry: PdfAnalysis['entries'][number] = {
      id: 'p0001-t0001',
      pageNumber: 1,
      original: 'Text',
      x: 8,
      y: 8,
      width: 8,
      height: 6,
      fontSize: 6,
    }

    expect(estimatePdfTextColor(
      entry,
      { image: new ImageData(data, width, height), pageHeight: 30, scale: 1 },
    )).toBe('#f0ebdc')
  })
})
