import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useRegionEditing } from '~/composables/useRegionEditing'
import { mergeTextRegions } from '~/utils/merge-regions'

function fixture() {
  const editor = useCardEditor()
  editor.loadImageProject('card.png', 500, 700)
  for (const y of [100, 170, 300]) {
    editor.addRegion({ x: 20, y, width: 200, height: 50 }, '#fff')
    editor.updateRegion(editor.selectedRegionId.value!, { originalText: `Line ${y}`, translatedText: `訳${y}`, translationStatus: 'reviewed', textStyles: [{ start: 0, end: 1, textColor: '#f00' }], exclusionAreas: [{ id: 'same', x: 5, y: 10, width: 10, height: 10 }], sourceIcons: [{ id: 'same', assetId: 'sun', x: 20, y: 5, width: 10, height: 10 }], manualMaskStrokes: [{ brushSize: 4, points: [{ x: 10, y: 10 }] }] })
  }
  return editor
}
describe('region merging', () => {
  it('preserves image coordinates, inline style offsets and base identity without mutating sources', () => {
    const editor = fixture()
    const regions = editor.project.value.regions.slice(0, 2)
    const before = structuredClone(regions)
    const merged = mergeTextRegions(regions, { baseId: regions[1]!.id, separator: '\n' })
    expect(merged).toMatchObject({ id: regions[1]!.id, x: 20, y: 100, width: 200, height: 120, originalText: 'Line 100\nLine 170', translatedText: '訳100\n訳170', translationStatus: 'draft' })
    expect(merged.exclusionAreas.map(area => area.y)).toEqual([10, 80])
    expect(new Set(merged.exclusionAreas.map(area => area.id)).size).toBe(2)
    expect(merged.sourceIcons!.map(icon => icon.y)).toEqual([5, 75])
    expect(merged.manualMaskStrokes[1]!.points[0]).toEqual({ x: 10, y: 80 })
    expect(merged.textStyles.map(style => style.start)).toEqual([0, 5])
    expect(regions).toEqual(before)
  })
  it('restores all source regions in one undo and supports redo', () => {
    const editor = fixture()
    const before = structuredClone(editor.project.value)
    const ids = before.regions.slice(0, 2).map(region => region.id)
    editor.mergeRegions(ids, { baseId: ids[0]!, separator: ' ', translatedText: '編集済み' })
    expect(editor.project.value.regions).toHaveLength(2)
    expect(editor.project.value.regions[0]!.translatedText).toBe('編集済み')
    editor.undo()
    expect(editor.project.value).toEqual(before)
    editor.redo()
    expect(editor.project.value.regions).toHaveLength(2)
    expect(editor.project.value.regions[1]).toEqual(before.regions[2])
  })
  it('rejects invalid selections and keeps untranslated text empty', () => {
    const regions = fixture().project.value.regions.slice(0, 2)
    expect(() => mergeTextRegions([regions[0]!], { baseId: regions[0]!.id, separator: '' })).toThrow()
    expect(() => mergeTextRegions([regions[0]!, regions[0]!], { baseId: regions[0]!.id, separator: '' })).toThrow()
    const merged = mergeTextRegions(regions.map(region => ({ ...region, translatedText: '' })), { baseId: regions[0]!.id, separator: '\n' })
    expect(merged.translationStatus).toBe('untranslated')
    expect(merged.translatedText).toBe('')
  })
  it('cancels stale merge requests after source edits or a card switch', () => {
    const editor = fixture()
    const cardId = ref('one')
    const messages: string[] = []
    const actions = useRegionEditing({ editor, currentImageId: cardId, projectBusy: ref(false), selectedExclusionId: ref(null), exclusionEditing: ref(false), switchInspectorTab: () => {}, setMessage: message => messages.push(message) })
    const ids = editor.project.value.regions.slice(0, 2).map(region => region.id)
    actions.requestRegionMerge(ids[0]!)
    editor.updateRegion(ids[1]!, { originalText: 'Changed' })
    actions.applyRegionMerge(ids, { baseId: ids[0]!, separator: '\n' })
    expect(editor.project.value.regions).toHaveLength(3)
    expect(actions.regionMergeRequest.value).toBeNull()
    actions.requestRegionMerge(ids[0]!)
    cardId.value = 'two'
    actions.applyRegionMerge(ids, { baseId: ids[0]!, separator: '\n' })
    expect(editor.project.value.regions).toHaveLength(3)
    expect(messages).toHaveLength(2)
  })
})
