import type { FolderProjectDocument } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { countProjectFontUsage, removeProjectFont } from '~/services/project/cards'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { createLayoutTemplate, fitsImage, placeLayoutTemplate } from '~/utils/layout-template'
import { savedProjectSignature } from '~/utils/project-save'

function fixture() {
  const editor = useCardEditor()
  editor.loadImageProject('sample.png', 200, 300)
  editor.addRegion({ x: 10, y: 100, width: 100, height: 60 }, '#ffffff')
  const id = editor.selectedRegionId.value!
  editor.updateRegion(id, {
    role: '任務条件',
    originalText: 'Draw 2',
    translatedText: '2枚引く',
    translationStatus: 'reviewed',
    exclusionAreas: [{ id: 'protected', x: 80, y: 40, width: 20, height: 20 }],
    manualMaskStrokes: [{ brushSize: 3, points: [{ x: 5, y: 6 }] }],
  })
  return { editor, id, template: createLayoutTemplate('自由な配置', editor.project.value, [id]) }
}

describe('layout templates', () => {
  it('copies selected layout and masks without source text, translations or role requirements', () => {
    const { editor, template, id } = fixture()
    expect(template.regions[0]).toMatchObject({ role: '任務条件', originalText: '', translatedText: '', translationStatus: 'untranslated' })
    template.regions[0]!.exclusionAreas[0]!.x = 0
    expect(editor.project.value.regions[0]!.exclusionAreas[0]!.x).toBe(80)
    editor.updateRegion(id, { role: undefined })
    expect(createLayoutTemplate('未分類', editor.project.value, [id]).regions[0]!.role).toBeUndefined()
    expect(() => createLayoutTemplate('empty', editor.project.value, [])).toThrow()
  })

  it('scales masks and protection locally and shifts the region on the target image', () => {
    const { template } = fixture()
    const [placed] = placeLayoutTemplate(template, 400, 600, 5, -10)
    expect(placed).toMatchObject({ x: 25, y: 190, width: 200, height: 120 })
    expect(placed!.exclusionAreas[0]).toMatchObject({ x: 160, y: 80, width: 40, height: 40 })
    expect(placed!.manualMaskStrokes[0]).toEqual({ brushSize: 6, points: [{ x: 10, y: 12 }] })
    expect(fitsImage(placed!, 400, 600)).toBe(true)
    expect(fitsImage(placeLayoutTemplate(template, 400, 600, 400)[0]!, 400, 600)).toBe(false)
    expect(placeLayoutTemplate(template, 400, 600, 0, 0, Number.NaN)).toEqual([])
  })

  it('adds fresh identities without replacing existing edits and undoes the whole application', () => {
    const { editor, template } = fixture()
    const original = structuredClone(editor.project.value)
    const placed = placeLayoutTemplate(template, 200, 300)
    editor.appendTemplateRegions([...placed, ...placed])
    expect(editor.project.value.regions[0]).toEqual(original.regions[0])
    expect(new Set(editor.project.value.regions.map(region => region.id)).size).toBe(3)
    expect(new Set(editor.project.value.regions.map(region => region.regionId)).size).toBe(3)
    editor.undo()
    expect(editor.project.value).toEqual(original)
    editor.redo()
    expect(editor.project.value.regions).toHaveLength(3)
  })

  it('persists templates and includes edits in the unsaved signature', () => {
    const { template } = fixture()
    const doc: FolderProjectDocument = {
      version: 2,
      name: 'test',
      activeCardId: 'c',
      cards: [{ id: 'c', imagePath: 'images/c.png', imageName: 'c.png', imageWidth: 200, imageHeight: 300, regions: [], printArea: null, sourceDpi: null }],
      assets: [],
      fonts: [],
      ocrDictionary: [],
      glossary: [],
      printSettings: { columns: 3, marginMm: 10, gapMm: 0, cutMarks: false },
    }
    const previous = savedProjectSignature(doc)
    doc.layoutTemplates = [template]
    template.regions[0]!.fontId = 'custom-font'
    expect(countProjectFontUsage(doc, 'custom-font')).toBe(1)
    expect(removeProjectFont(doc, 'custom-font').layoutTemplates![0]!.regions[0]!.fontId).toBeNull()
    expect(savedProjectSignature(doc)).not.toBe(previous)
    expect(parseFolderProject(serializeFolderProject(doc))).toEqual(doc)
    const broken = { ...doc, layoutTemplates: [{ ...template, imageWidth: 0 }] }
    expect(() => parseFolderProject(JSON.stringify(broken))).toThrow('配置雛形')
    expect(() => serializeFolderProject(broken)).toThrow('配置雛形')
  })
})
