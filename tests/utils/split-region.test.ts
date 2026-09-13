import { describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { splitTextRegion } from '~/utils/split-region'

function fixture() {
  const editor = useCardEditor()
  editor.loadImageProject('arbitrary.png', 500, 700)
  editor.addRegion({ x: 20, y: 100, width: 200, height: 100 }, '#fff')
  editor.updateRegion(editor.selectedRegionId.value!, {
    role: '注意書き',
    originalText: 'First\nSecond',
    translatedText: '第一\n第二',
    translationStatus: 'reviewed',
    exclusionAreas: [{ id: 'across', x: 80, y: 30, width: 50, height: 40 }],
    manualMaskStrokes: [{ brushSize: 4, points: [{ x: 10, y: 10 }, { x: 180, y: 90 }] }],
  })
  return editor
}
const texts = [{ originalText: 'First', translatedText: '第一' }, { originalText: 'Second', translatedText: '第二' }] as const

describe('region splitting', () => {
  it('partitions geometry and protection at the split line without scaling strokes', () => {
    const editor = fixture()
    const region = editor.selectedRegion.value!
    const [top, bottom] = splitTextRegion(region, 'horizontal', 50, texts)
    expect(top).toMatchObject({ x: 20, y: 100, width: 200, height: 50, role: '注意書き', originalText: 'First', translationStatus: 'draft' })
    expect(bottom).toMatchObject({ x: 20, y: 150, width: 200, height: 50, originalText: 'Second' })
    expect(top.exclusionAreas[0]).toMatchObject({ x: 80, y: 30, width: 50, height: 20 })
    expect(bottom.exclusionAreas[0]).toMatchObject({ x: 80, y: 0, width: 50, height: 20 })
    expect(bottom.manualMaskStrokes[0]).toEqual({ brushSize: 4, points: [{ x: 10, y: -40 }, { x: 180, y: 40 }] })
    expect(region.height).toBe(100)
    expect(region.exclusionAreas[0]!.height).toBe(40)
  })

  it('supports vertical splitting and rejects boundary and invalid positions', () => {
    const region = fixture().selectedRegion.value!
    const [left, right] = splitTextRegion(region, 'vertical', 100, texts)
    expect(left.width).toBe(100)
    expect(right).toMatchObject({ x: 120, y: 100, width: 100, height: 100 })
    expect(left.exclusionAreas[0]!.width).toBe(20)
    expect(right.exclusionAreas[0]).toMatchObject({ x: 0, width: 30 })
    for (const position of [0, 200, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => splitTextRegion(region, 'vertical', position, texts)).toThrow()
  })

  it('keeps the first CSV identity, creates a second one, and restores the complete edit with undo', () => {
    const editor = fixture()
    const before = structuredClone(editor.project.value)
    editor.splitRegion(editor.selectedRegionId.value!, 'horizontal', 50, texts)
    const [first, second] = editor.project.value.regions
    expect(first!.id).toBe(before.regions[0]!.id)
    expect(first!.regionId).toBe(before.regions[0]!.regionId)
    expect(second!.id).not.toBe(first!.id)
    expect(second!.regionId).not.toBe(first!.regionId)
    editor.undo()
    expect(editor.project.value).toEqual(before)
    editor.redo()
    expect(editor.project.value.regions.map(region => region.originalText)).toEqual(['First', 'Second'])
  })
})
