import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runSequentialOCRQueue } from '~/services/ocr/queue'
import { layoutPrintAreas } from '~/services/print-layout'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { resolveSampleCandidates, sampleRegionCandidates, sampleRegions } from '~/services/project/sample'
import { SampleTranslationProvider } from '~/services/translator/sample'
import { sourceIconProblems } from '~/utils/source-icons'

const root = new URL('../../public/sample-project/', import.meta.url)
const project = parseFolderProject(readFileSync(new URL('project.json', root), 'utf8'))

describe('bundled sample project', () => {
  it('provides translatable preset candidates for all cards in the batch queue', async () => {
    const provider = new SampleTranslationProvider()
    const summary = await runSequentialOCRQueue(project.cards.map(card => card.id), async (id) => {
      const card = project.cards.find(card => card.id === id)!
      const candidates = sampleRegionCandidates(card)
      expect(candidates).toHaveLength(4)
      const regions = resolveSampleCandidates(card, JSON.parse(JSON.stringify(candidates)))!
      expect(regions).toHaveLength(4)
      expect(regions[3]!.sourceIcons?.length).toBeGreaterThan(0)
      for (const candidate of candidates) {
        expect(candidate.selected).toBe(true)
        expect(await provider.translate(candidate.text, 'EN', 'JA')).toMatch(/[\u3040-\u9FFF]/u)
      }
      return candidates
    })
    expect(summary.review).toBe(5)
    expect(summary.errors).toBe(0)
  })

  it('accepts real OCR candidates on every demo card without template lookup', () => {
    for (const card of project.cards) {
      const region = sampleRegions(card)[0]!
      const candidate = { id: region.id, x: 10, y: 10, width: 100, height: 30, text: 'OCR text', confidence: 90, selected: true, lines: [] }
      expect(resolveSampleCandidates(card, [candidate])).toBeNull()
      const resolved = resolveSampleCandidates(card, [{ ...candidate, sampleRegionId: region.id }])!
      expect(resolved[0]!.originalText).toBe(region.originalText)
      expect(resolved[0]!.width).toBe(100)
      expect(resolved[0]!.ocrLayout).toBe('single-line')
    }
  })

  it('rejects stale demo templates from a different card', () => {
    expect(() => resolveSampleCandidates(project.cards[1]!, [{
      id: 'candidate',
      sampleRegionId: 'sample-01-0',
      x: 10,
      y: 10,
      width: 100,
      height: 30,
      text: 'LANTERN GROVE',
      confidence: null,
      selected: true,
      lines: [],
    }])).toThrow('デモ候補を表示し直してください')
  })

  it('opens as a clean five-card demo with available assets and preserves the demo preset on save', () => {
    expect(project.demoPreset).toBe('sample-v1')
    expect(parseFolderProject(serializeFolderProject(project)).demoPreset).toBe('sample-v1')
    expect(project.cards).toHaveLength(5)
    expect(project.printSettings.gapMm).toBe(1)
    expect(layoutPrintAreas(project.cards, project.printSettings).overflowingCardIds).toEqual([])
    expect(project.assets.map(asset => asset.name)).toEqual(['sun', 'drop'])
    for (const card of project.cards) {
      expect(card.regions).toEqual([])
      expect(existsSync(new URL(card.imagePath, root))).toBe(true)
    }
    for (const asset of project.assets)
      expect(existsSync(new URL(asset.imagePath, root))).toBe(true)
  })

  it('supplies valid editable candidates and registered icons that all translate offline', async () => {
    for (const card of project.cards) {
      const regions = sampleRegions(card)
      expect(regions).toHaveLength(4)
      expect(regions.every(region => !region.ruby && region.backgroundMode === 'auto')).toBe(true)
      expect(regions[3]!.autoMaskPreset).toBe(card.id === 'sample-05' ? 'light' : 'dark')
      const saved = parseFolderProject(serializeFolderProject({ ...project, cards: [{ ...card, regions }] }))
      expect(saved.cards[0]!.regions).toHaveLength(4)
      expect(saved.cards[0]!.regions.map(region => region.ocrLayout)).toEqual([
        'single-line',
        'single-line',
        'single-line',
        'text-block',
      ])
      for (const region of regions) {
        expect(sourceIconProblems(region, project.assets)).toEqual([])
        expect(region.translatedText).toBe('')
        expect(await new SampleTranslationProvider().translate(region.originalText, 'EN', 'JA')).toMatch(/[\u3040-\u9FFF]/u)
      }
      regions[0]!.originalText = 'changed'
      expect(sampleRegions(card)[0]!.originalText).not.toBe('changed')
    }
    expect(sampleRegions({ ...project.cards[0]!, id: 'unrelated' })).toEqual([])
  })
})
