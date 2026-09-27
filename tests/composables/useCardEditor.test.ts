import type { CardProject } from '~/types/editor'
import { describe, expect, it, vi } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'

function card(imageName: string): CardProject {
  return {
    imageName,
    imageWidth: 100,
    imageHeight: 140,
    regions: [],
  }
}

describe('card editor project synchronization', () => {
  it('rejects a guarded edit for another card before changing state, history, or persistence', () => {
    const onChange = vi.fn()
    const editor = useCardEditor(onChange)
    editor.loadSavedProject(card('same.png'), 'actual-card')
    editor.addRegion({ x: 1, y: 2, width: 30, height: 20 }, '#ffffff')
    const before = editor.project.value
    editor.loadSavedProject(before, 'actual-card')
    onChange.mockClear()
    const id = editor.project.value.regions[0]!.id
    expect(() => editor.updateRegion(id, { originalText: 'Wrong card' }, 'other-card')).toThrow('編集中のカード')
    expect(() => editor.updateRegion(id, { originalText: 'Wrong draft' }, null)).toThrow('編集中のカード')
    expect(editor.project.value).toEqual(before)
    expect(editor.canUndo.value).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    editor.updateRegion(id, { originalText: 'Correct' }, 'actual-card')
    expect(onChange).toHaveBeenCalledOnce()
    editor.undo()
    expect(editor.project.value).toEqual(before)
  })

  it('applies a batch of translations in one undo step and leaves other translations intact', () => {
    const editor = useCardEditor()
    editor.loadSavedProject(card('demo.png'), 'demo')
    for (let index = 0; index < 3; index++)
      editor.addRegion({ x: 1, y: index * 30, width: 30, height: 20 }, '#ffffff')
    const [first, second, existing] = editor.project.value.regions
    editor.updateRegion(existing!.id, { translatedText: '確認済みの訳', translationStatus: 'reviewed' })

    editor.applyTranslations(new Map([[first!.regionId, '場所'], [second!.regionId, '灯りの木立']]))
    expect(editor.project.value.regions.map(region => region.translatedText)).toEqual(['場所', '灯りの木立', '確認済みの訳'])
    expect(editor.project.value.regions.map(region => region.translationStatus)).toEqual(['draft', 'draft', 'reviewed'])

    editor.undo()
    expect(editor.project.value.regions.map(region => region.translatedText)).toEqual(['', '', '確認済みの訳'])
    editor.redo()
    expect(editor.project.value.regions.map(region => region.translatedText)).toEqual(['場所', '灯りの木立', '確認済みの訳'])
  })

  it('publishes edits, undo, and redo with the active card ID', () => {
    const onChange = vi.fn()
    const editor = useCardEditor(onChange)
    editor.loadSavedProject(card('card-1.png'), 'card-1')
    editor.addRegion({ x: 1, y: 2, width: 30, height: 20 }, '#ffffff')

    expect(onChange).toHaveBeenLastCalledWith(
      'card-1',
      expect.objectContaining({ regions: [expect.any(Object)] }),
    )

    editor.undo()
    expect(onChange).toHaveBeenLastCalledWith(
      'card-1',
      expect.objectContaining({ regions: [] }),
    )

    editor.redo()
    expect(onChange.mock.calls.at(-1)?.[1].regions).toHaveLength(1)
  })

  it('publishes restored card-specific histories to the matching card', () => {
    const onChange = vi.fn()
    const editor = useCardEditor(onChange)
    editor.loadSavedProject(card('card-1.png'), 'card-1')
    editor.addRegion({ x: 1, y: 2, width: 30, height: 20 }, '#ffffff')
    const editedCard = structuredClone(editor.project.value)
    editor.switchSavedProject('card-2', card('card-2.png'))
    editor.switchSavedProject('card-1', editedCard)
    editor.undo()

    expect(onChange).toHaveBeenLastCalledWith(
      'card-1',
      expect.objectContaining({ regions: [] }),
    )
  })

  it('publishes unsaved card edits without a persisted card ID', () => {
    const onChange = vi.fn()
    const editor = useCardEditor(onChange)
    editor.loadImageProject('draft.png', 200, 280)

    expect(onChange).toHaveBeenLastCalledWith(null, {
      imageName: 'draft.png',
      imageWidth: 200,
      imageHeight: 280,
      regions: [],
    })
  })
})

describe('shared asset renames across card history', () => {
  it('migrates active and inactive undo/redo branches without adding an undo step', () => {
    const editor = useCardEditor()
    editor.loadSavedProject(card('first.png'), 'first')
    editor.addRegion({ x: 1, y: 1, width: 30, height: 20 }, '#ffffff')
    const id = editor.selectedRegionId.value!
    editor.updateRegion(id, { originalText: '[icon:sun]', translatedText: '[icon:sun]' })
    editor.updateRegion(id, { translatedText: '2 [icon:sun]' })
    editor.undo()
    const first = structuredClone(editor.project.value)
    editor.switchSavedProject('second', card('second.png'))
    editor.addRegion({ x: 1, y: 1, width: 30, height: 20 }, '#ffffff')
    const secondId = editor.selectedRegionId.value!
    editor.updateRegion(secondId, { translatedText: '[icon:sun]' })
    editor.updateRegion(secondId, { translatedText: '3 [icon:sun]' })

    editor.renameAssetToken('sun-id', 'sun', 'light')
    editor.undo()
    expect(editor.project.value.regions[0]!.translatedText).toBe('[icon:light]')
    editor.redo()
    expect(editor.project.value.regions[0]!.translatedText).toBe('3 [icon:light]')

    first.regions[0]!.originalText = '[icon:light]'
    first.regions[0]!.translatedText = '[icon:light]'
    editor.switchSavedProject('first', first)
    expect(editor.canRedo.value).toBe(true)
    editor.redo()
    expect(editor.project.value.regions[0]!.translatedText).toBe('2 [icon:light]')
    editor.undo()
    expect(editor.project.value.regions[0]!.originalText).toBe('[icon:light]')
  })
})

it('appends prepared regions with fresh identities and undoes the whole addition', () => {
  const editor = useCardEditor()
  editor.loadImageProject('sample.png', 200, 300)
  editor.addRegion({ x: 10, y: 100, width: 100, height: 60 }, '#ffffff')
  editor.updateRegion(editor.selectedRegionId.value!, { originalText: 'Source', translatedText: '訳文' })
  const original = structuredClone(editor.project.value)
  const region = original.regions[0]!
  editor.appendRegions([region, region])
  expect(editor.project.value.regions[0]).toEqual(region)
  expect(editor.project.value.regions.slice(1).map(item => item.originalText)).toEqual(['Source', 'Source'])
  expect(new Set(editor.project.value.regions.map(item => item.id)).size).toBe(3)
  expect(new Set(editor.project.value.regions.map(item => item.regionId)).size).toBe(3)
  editor.undo()
  expect(editor.project.value).toEqual(original)
  editor.redo()
  expect(editor.project.value.regions).toHaveLength(3)
})

describe('region order', () => {
  it('persists moves with one-step undo/redo, selection and card history intact', () => {
    const onChange = vi.fn()
    const editor = useCardEditor(onChange)
    editor.loadSavedProject(card('one.png'), 'one')
    for (let i = 0; i < 3; i++)
      editor.addRegion({ x: 1, y: i * 30, width: 20, height: 20 }, '#ffffff')
    const original = structuredClone(editor.project.value)
    const [a, b, c] = original.regions
    editor.loadSavedProject(original, 'one')
    editor.selectedRegionId.value = b!.id
    onChange.mockClear()
    editor.moveRegion(a!.id, c!.id, 'after')
    expect(editor.project.value.regions).toEqual([b, c, a])
    expect(editor.selectedRegionId.value).toBe(b!.id)
    expect(onChange).toHaveBeenLastCalledWith('one', editor.project.value)
    const moved = structuredClone(editor.project.value)
    editor.switchSavedProject('two', card('two.png'))
    editor.switchSavedProject('one', moved)
    editor.undo()
    expect(editor.project.value).toEqual(original)
    expect(editor.canUndo.value).toBe(false)
    editor.moveRegion(a!.id, b!.id, 'before')
    editor.moveRegion(a!.id, a!.id, 'after')
    editor.moveRegion('missing', b!.id, 'before')
    editor.moveRegion(a!.id, 'missing', 'after')
    expect(editor.canUndo.value).toBe(false)
    expect(editor.canRedo.value).toBe(true)
    editor.redo()
    expect(editor.project.value).toEqual(moved)
    editor.moveRegion(a!.id, b!.id, 'before')
    expect(editor.project.value).toEqual(original)
  })
})
