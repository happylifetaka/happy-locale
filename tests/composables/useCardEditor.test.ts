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
