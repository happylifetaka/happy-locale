// @vitest-environment happy-dom
import type { TextRegion } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { parseTranslationCsv, serializeProjectTranslationCsv } from '~/utils/csv'
import { createTranslationReviewRows } from '~/utils/translation-review'
import { createCardThumbnailBlob, downloadText, folderProjectExists, loadFolderProjectCardImage, mountEditor, openFolderProject, pickProjectDirectory, seedProject } from './helpers/card-editor'

beforeEach(() => {
  // 画像のload/decodeだけを代替し、プロジェクトを開く処理とストア同期は実装を通す。
  vi.stubGlobal('Image', class {
    naturalWidth = 100
    naturalHeight = 140
    onload: (() => void) | null = null
    source = ''
    get src() { return this.source }
    set src(value: string) {
      this.source = value
      queueMicrotask(() => this.onload?.())
    }

    decode = vi.fn().mockResolvedValue(undefined)
    removeAttribute = vi.fn()
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(createCardThumbnailBlob).mockResolvedValue(null)
})

async function setupReview() {
  const context = await mountEditor()
  const region: TextRegion = JSON.parse(JSON.stringify(context.inspector.props('region')))
  const project = seedProject(['one', 'two', 'three'])
  project.cards.forEach((card, index) => {
    card.regions = [{ ...region, id: `region-${index}`, originalText: `Source ${index}`, translatedText: `Before ${index}`, translationStatus: 'draft' }]
  })
  const directory = { name: 'cards' } as FileSystemDirectoryHandle
  vi.mocked(pickProjectDirectory).mockResolvedValue(directory)
  vi.mocked(folderProjectExists).mockResolvedValue(true)
  vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'two.png', { type: 'image/png' }))
  vi.mocked(openFolderProject).mockResolvedValue({
    directory,
    document: project,
    card: project.cards[0]!,
    imageFile: new File(['image'], 'one.png', { type: 'image/png' }),
    assetFiles: new Map(),
  })
  const toolbar = context.wrapper.findComponent({ name: 'EditorToolbar' })
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(context.canvas.props('project').regions[0].originalText).toBe('Source 0')
  expect(context.wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  return { ...context, toolbar, project }
}

async function openReview() {
  const context = await setupReview()
  context.wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-translation')
  await nextTick()
  const dialog = context.wrapper.findComponent({ name: 'TranslationReviewDialog' })
  const rows = createTranslationReviewRows(dialog.props('cards'))
  rows.forEach((row, index) => row.translation = `After ${index}`)
  return { ...context, dialog, rows }
}

describe('card editor translation review', () => {
  it('keeps review drafts separate, applies selected cards, and undoes only the active card', async () => {
    const { dialog, rows, canvas, toolbar, wrapper } = await openReview()
    const store = useProjectStore()
    expect(store.document!.cards.map(card => card.regions[0]!.translatedText)).toEqual(['Before 0', 'Before 1', 'Before 2'])
    dialog.vm.$emit('apply', rows.slice(0, 2), false)
    await nextTick()
    expect(store.document!.cards.map(card => card.regions[0]!.translatedText)).toEqual(['After 0', 'After 1', 'Before 2'])
    expect(canvas.props('project').regions[0].translatedText).toBe('After 0')
    expect(dialog.props('appliedRows')).toEqual(rows.slice(0, 2).map(row => ({ key: row.key, translation: row.translation })))
    expect(dialog.exists()).toBe(true)
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(store.document!.cards.map(card => card.regions[0]!.translatedText)).toEqual(['Before 0', 'After 1', 'Before 2'])
    toolbar.vm.$emit('redo')
    await nextTick()
    expect(canvas.props('project').regions[0].translatedText).toBe('After 0')
    dialog.vm.$emit('apply', rows.slice(2), true)
    await nextTick()
    expect(store.document!.cards[2]!.regions[0]!.translatedText).toBe('After 2')
    expect(wrapper.findComponent({ name: 'TranslationReviewDialog' }).exists()).toBe(false)
  })

  it.each(['original', 'translation', 'removed'] as const)('rejects the whole review batch when an inactive region is %s', async (change) => {
    const { dialog, rows, canvas } = await openReview()
    const store = useProjectStore()
    const changed = store.snapshot()!
    const card = changed.cards[1]!
    if (change === 'removed')
      card.regions = []
    else if (change === 'original')
      card.regions[0]!.originalText = 'Edited source'
    else
      card.regions[0]!.translatedText = 'Manual edit'
    store.replaceProject(changed)
    const beforeApply = store.snapshot()
    dialog.vm.$emit('apply', rows.slice(0, 2), false)
    await nextTick()
    expect(store.snapshot()).toEqual(beforeApply)
    expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
    expect(dialog.props('error')).toContain('元の領域や訳文が変更されています')
    expect(dialog.props('appliedRows')).toEqual([])
  })

  it('excludes cards pending deletion from the review', async () => {
    const { wrapper } = await setupReview()
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('delete', 'two')
    await nextTick()
    await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-translation')
    await nextTick()
    const dialog = wrapper.findComponent({ name: 'TranslationReviewDialog' })
    expect(dialog.props('cards').map((card: { id: string }) => card.id)).toEqual(['one', 'three'])
    expect(useProjectStore().document!.cards).toHaveLength(3)
  })

  it('matches CSV before applying and uses the same undoable review path', async () => {
    const { project, toolbar, wrapper, canvas } = await setupReview()
    const cards = structuredClone(project.cards)
    cards.forEach(card => card.regions[0]!.translatedText = 'CSV translation')
    toolbar.vm.$emit('import-csv', new File([serializeProjectTranslationCsv(cards)], 'translations.csv'))
    await flushPromises()
    const dialog = wrapper.findComponent({ name: 'TranslationReviewDialog' })
    expect(dialog.props('initialImport').applied).toBe(3)
    expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
    const rows = createTranslationReviewRows(dialog.props('cards'))
    rows.forEach(row => row.translation = dialog.props('initialImport').translationsByCard.get(row.cardId).get(row.region.regionId))
    dialog.vm.$emit('apply', rows, true)
    await nextTick()
    expect(useProjectStore().document!.cards.map(card => card.regions[0]!.translatedText)).toEqual(Array.from({ length: 3 }).fill('CSV translation'))
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
    expect(useProjectStore().document!.cards[1]!.regions[0]!.translatedText).toBe('CSV translation')
  })

  it('exports all eligible cards or one card and skips pending deletions', async () => {
    const { toolbar, wrapper } = await setupReview()
    const list = wrapper.findComponent({ name: 'CardList' })
    list.vm.$emit('delete', 'two')
    await nextTick()
    await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
    await flushPromises()
    toolbar.vm.$emit('export-csv')
    const [csv, name, mime] = vi.mocked(downloadText).mock.calls[0]!
    expect(name).toBe('cards-translations.csv')
    expect(mime).toBe('text/csv;charset=utf-8')
    expect(parseTranslationCsv(csv).map(row => row.cardId)).toEqual(['one', 'three'])
    list.vm.$emit('export-csv', 'two')
    expect(downloadText).toHaveBeenCalledOnce()
    list.vm.$emit('export-csv', 'three')
    const [cardCsv, cardName] = vi.mocked(downloadText).mock.calls[1]!
    expect(cardName).toBe('three-translations.csv')
    expect(cardCsv.startsWith('\uFEFF')).toBe(true)
    expect(parseTranslationCsv(cardCsv).map(row => row.translation)).toEqual(['Before 2'])
  })

  it('loads a review image and locates its region through the normal card switch', async () => {
    const { dialog, wrapper, inspector } = await openReview()
    await dialog.props('loadImage')('two')
    expect(loadFolderProjectCardImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'cards' }), expect.objectContaining({ id: 'two' }))
    dialog.vm.$emit('locate', 'two', 'region-1')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TranslationReviewDialog' }).exists()).toBe(false)
    expect(useProjectStore().document!.activeCardId).toBe('two')
    expect(inspector.props('region')).toMatchObject({ id: 'region-1', translatedText: 'Before 1' })
  })
})
