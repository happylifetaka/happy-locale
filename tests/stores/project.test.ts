import type { FolderProjectDocument } from '~/types/editor'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'

function project(): FolderProjectDocument {
  return {
    version: 2,
    name: 'cards',
    activeCardId: 'card-1',
    cards: [{
      id: 'card-1',
      imagePath: 'images/card-1.png',
      imageName: 'card.png',
      imageWidth: 100,
      imageHeight: 140,
      regions: [],
      printArea: null,
      sourceDpi: null,
    }],
    assets: [],
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
  }
}

describe('project store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps draft history and synchronizes edits after the first save', () => {
    const store = useProjectStore()
    const editor = useCardEditor((id, card) => store.updateCard(id, card))
    editor.loadImageProject('card.png', 100, 140)
    editor.addRegion({ x: 1, y: 1, width: 40, height: 30 }, '#ffffff')
    const id = editor.selectedRegionId.value!
    const saved = project()
    saved.cards[0] = { ...saved.cards[0]!, ...structuredClone(store.activeCard) }
    // A later edit must survive even when the first save is still writing.
    editor.updateRegion(id, { translatedText: 'during save' })
    store.acceptSavedProject(saved, new Set())
    editor.bindSavedCard(saved.activeCardId)
    expect(store.activeCard.regions[0]!.translatedText).toBe('during save')
    expect(editor.selectedRegionId.value).toBe(id)
    expect(savedProjectSignature(store.document!)).not.toBe(savedProjectSignature(saved))
    editor.updateRegion(id, { translatedText: 'after save' })
    expect(store.activeCard.regions[0]!.translatedText).toBe('after save')
    const firstCard = structuredClone(store.activeCard)
    editor.switchSavedProject('other', { imageName: 'other.png', imageWidth: 10, imageHeight: 10, regions: [] })
    editor.switchSavedProject(saved.activeCardId, firstCard)
    editor.undo()
    expect(store.activeCard.regions[0]!.translatedText).toBe('during save')
  })

  it('acknowledges saved deletions without overwriting subsequent edits', () => {
    const store = useProjectStore()
    const initial = project()
    initial.cards.push({ ...initial.cards[0]!, id: 'deleted', imagePath: 'images/deleted.png' })
    store.replaceProject(initial)
    const saved = project()
    store.updateCard('card-1', { ...store.activeCard, imageName: 'edited during save.png' })
    store.setGlossary([{ id: 'new', source: 'Draw', translation: '引く', note: '' }])
    store.acceptSavedProject(saved, new Set(['deleted']))
    expect(store.document!.cards).toHaveLength(1)
    expect(store.activeCard.imageName).toBe('edited during save.png')
    expect(store.glossary).toHaveLength(1)
    expect(savedProjectSignature(store.document!)).not.toBe(savedProjectSignature(saved))
  })

  it('accepts versioned image paths without losing concurrent asset edits or restoring deletions', () => {
    const store = useProjectStore()
    const initial = project()
    initial.assets = ['one', 'two'].map(id => ({
      id,
      name: id,
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: `assets/${id}.png`,
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }))
    store.replaceProject(initial)
    const saved = structuredClone(initial)
    saved.assets[0]!.imagePath = 'assets/new-version.png'
    store.setAssets([{ ...store.assets[0]!, name: 'edited during save', scale: 2 }])
    store.acceptSavedProject(saved, new Set())
    expect(store.assets).toHaveLength(1)
    expect(store.assets[0]).toMatchObject({
      name: 'edited during save',
      scale: 2,
      imagePath: 'assets/new-version.png',
    })
  })

  it('replaces the project without retaining previous state', () => {
    const store = useProjectStore()
    const first = project()
    first.assets = [{
      id: 'asset-1',
      name: 'shield',
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: 'assets/asset-1.png',
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }]
    store.replaceProject(first)
    store.replaceProject({ ...project(), name: 'replacement' })

    expect(store.document?.name).toBe('replacement')
    expect(store.assets).toEqual([])
  })

  it('keeps shared draft data before the first project save', () => {
    const store = useProjectStore()
    store.setGlossary([{
      id: 'term-1',
      source: 'Draw',
      translation: '引く',
      note: '',
    }])

    expect(store.document).toBeNull()
    expect(store.glossary).toHaveLength(1)
  })

  it('updates document fields after a project is loaded', () => {
    const store = useProjectStore()
    store.replaceProject(project())
    store.setOCRDictionary([{
      id: 'entry-1',
      source: 'lI',
      replacement: 'll',
    }])

    expect(store.document?.ocrDictionary).toEqual(store.ocrDictionary)
  })

  it('updates only the selected card through the editor boundary', () => {
    const store = useProjectStore()
    const document = project()
    document.cards.push({
      ...document.cards[0]!,
      id: 'card-2',
      imagePath: 'images/card-2.png',
      imageName: 'card-2.png',
    })
    store.replaceProject(document)

    store.updateCard('card-2', {
      imageName: 'renamed.png',
      imageWidth: 200,
      imageHeight: 280,
      regions: [],
    })

    expect(store.document?.cards[0]!.imageName).toBe('card.png')
    expect(store.document?.cards[1]!.imageName).toBe('renamed.png')
  })

  it('keeps the new card draft in the store before first save', () => {
    const store = useProjectStore()
    store.updateCard(null, {
      imageName: 'draft.png',
      imageWidth: 300,
      imageHeight: 420,
      regions: [],
    })

    expect(store.activeCard.imageName).toBe('draft.png')
    expect(store.document).toBeNull()
  })

  it('returns JSON-compatible detached snapshots', () => {
    const store = useProjectStore()
    store.replaceProject(project())
    const snapshot = store.snapshot()!
    snapshot.cards[0]!.imageName = 'changed.png'

    expect(store.document?.cards[0]!.imageName).toBe('card.png')
    expect(JSON.parse(JSON.stringify(store.snapshot()))).toEqual(store.document)
    expect(() => JSON.stringify(store.$state)).not.toThrow()
  })

  it('exposes reactive refs without duplicating shared state', () => {
    const store = useProjectStore()
    const { document, fonts } = storeToRefs(store)
    store.replaceProject(project())
    store.setFonts([{
      id: 'font-1',
      displayName: 'Font',
      familyName: 'font-1',
      fileName: 'font.ttf',
      source: 'user',
    }])

    expect(document.value?.fonts).toBe(fonts.value)
  })
})
