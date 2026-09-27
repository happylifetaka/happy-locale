import { describe, expect, it } from 'vitest'
import { createRegionCandidates } from '~/services/ocr/candidates'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { baselineOCR, baselineProject } from '../fixtures/refactoring-baseline'

describe('pre-refactoring behavior contracts', () => {
  it('freezes complete candidate output including geometry, ordering, lines and selection', () => {
    const result = baselineOCR()
    const original = structuredClone(result)
    const candidates = createRegionCandidates(result.blocks, {
      imageWidth: 200,
      imageHeight: 240,
      scale: 2,
      padding: 6,
      words: result.words,
    })
    expect(candidates.map(c => c.text)).toEqual(['Synthetic Card', 'CASTLE', 'Choose an ally.\nDraw two cards.', 'noise text'])
    expect(candidates.map(c => c.selected)).toEqual([true, true, true, false])
    expect(candidates).toMatchSnapshot()
    expect(result).toEqual(original)
  })

  it('freezes serialized candidate data and restores it without any runtime resources', () => {
    const project = baselineProject()
    const ocr = baselineOCR()
    project.cards[0]!.ocrCandidates = createRegionCandidates(ocr.blocks, {
      imageWidth: 200,
      imageHeight: 240,
      scale: 2,
      padding: 6,
      words: ocr.words,
    })
    const original = structuredClone(project)
    const serialized = serializeFolderProject(project)
    expect(serialized).toMatchSnapshot()
    expect(parseFolderProject(serialized)).toEqual(project)
    // Parsing normalizes property order; freeze both representations separately.
    const normalized = serializeFolderProject(parseFolderProject(serialized))
    expect(normalized).toMatchSnapshot()
    expect(serializeFolderProject(parseFolderProject(normalized))).toBe(normalized)
    expect(project).toEqual(original)
  })
})
