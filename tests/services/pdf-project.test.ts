import type { PdfAnalysis } from '../../app/services/pdf'
import { describe, expect, it } from 'vitest'
import {
  assertPdfProjectSource,
  createPdfProjectDocument,
  parsePdfProject,
  serializePdfProject,
} from '../../app/services/pdf-project'

function analysis(): PdfAnalysis {
  return {
    fileName: 'rules.pdf',
    sourceFingerprint: 'a'.repeat(64),
    kind: 'text',
    pageCount: 1,
    pages: [
      { pageNumber: 1, kind: 'text', width: 600, height: 800, textCount: 1, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] },
    ],
    entries: [{
      id: 'p0001-t0001',
      pageNumber: 1,
      original: 'Draw two cards.',
      x: 20,
      y: 700,
      width: 100,
      height: 12,
      fontSize: 10,
    }],
    features: { formFields: 0, links: 0, annotations: 0 },
  }
}

describe('pdf project', () => {
  it('round-trips editable PDF state without the source PDF bytes', () => {
    const source = analysis()
    const document = createPdfProjectDocument(
      source,
      new Map([['p0001-t0001', 'カードを2枚引く。']]),
      new Set(['p0001-t0001']),
      new Map([[1, [{ x: 1, y: 2, width: 3, height: 4 }]]]),
      'blend',
      'original',
    )

    expect(parsePdfProject(serializePdfProject(document))).toEqual(document)
  })

  it('rejects an unrelated source PDF fingerprint', () => {
    const project = createPdfProjectDocument(
      analysis(),
      new Map(),
      new Set(),
      new Map(),
      'white',
      'black',
    )

    expect(() => assertPdfProjectSource(project, 'b'.repeat(64))).toThrow(
      '元PDFが一致しません',
    )
    expect(() => assertPdfProjectSource(project, 'a'.repeat(64))).not.toThrow()
  })

  it('rejects malformed or unsupported project data', () => {
    expect(() => parsePdfProject('{')).toThrow('JSONを読み込めません')
    expect(() => parsePdfProject(JSON.stringify({ version: 99 }))).toThrow(
      'versionは2',
    )
    const project = createPdfProjectDocument(
      analysis(),
      new Map(),
      new Set(),
      new Map(),
      'blend',
      'original',
    )
    project.excludedEntryIds.push('unknown')
    expect(() => parsePdfProject(JSON.stringify(project))).toThrow(
      '編集データが不正',
    )
  })

  it('migrates version 1 projects to unrotated viewport coordinates', () => {
    const current = createPdfProjectDocument(
      analysis(),
      new Map(),
      new Set(),
      new Map(),
      'blend',
      'original',
    )
    const legacy = JSON.parse(JSON.stringify(current)) as {
      version: number
      analysis: { pages: Array<Record<string, unknown>> }
    }
    legacy.version = 1
    const legacyPage = legacy.analysis.pages[0]
    if (!legacyPage)
      throw new Error('Test page is missing.')
    delete legacyPage.rotation
    delete legacyPage.viewportTransform

    const migrated = parsePdfProject(JSON.stringify(legacy))

    expect(migrated.version).toBe(2)
    expect(migrated.analysis.pages[0]).toMatchObject({
      rotation: 0,
      viewportTransform: [1, 0, 0, -1, 0, 800],
    })
  })
})
