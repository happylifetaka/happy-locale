// @vitest-environment happy-dom
import type { FolderProjectDocument } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { createFolderProject, deferred, editorRuntime, folderProjectExists, loadFolderProjectCardImage, mountSavedEditor, saveFolderProject } from './helpers/card-editor'

it('keeps edits, pending asset images and card deletions after a save failure', async () => {
  const { wrapper, toolbar, canvas, inspector } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Unsaved edit' })
  const pending = new Blob(['asset'])
  editorRuntime().setPendingAssetWrite('asset-one', pending)
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('delete', 'three')
  await nextTick()
  await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
  vi.mocked(saveFolderProject).mockRejectedValueOnce(new Error('disk full'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).toHaveBeenCalledOnce()
  expect(inspector.props('region').translatedText).toBe('Unsaved edit')
  expect(editorRuntime().pendingAssetWrites.value.get('asset-one')).toBe(pending)
  expect(list.props('pendingDeletionIds').has('three')).toBe(true)
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  expect(wrapper.get('.notice').text()).toContain('disk full')
})

it('acknowledges only the saved snapshot while retaining edits and replacement asset images made during saving', async () => {
  const result = deferred<FolderProjectDocument>()
  const { toolbar, canvas, inspector, project } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Saved edit' })
  await nextTick()
  const saved = JSON.parse(JSON.stringify(useProjectStore().document!)) as FolderProjectDocument
  const before = new Blob(['before'])
  const after = new Blob(['after'])
  editorRuntime().setPendingAssetWrite('asset-one', before)
  vi.mocked(saveFolderProject).mockReturnValueOnce(result.promise)
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).toHaveBeenCalledOnce()
  expect(vi.mocked(saveFolderProject).mock.calls[0]![6]!.get('asset-one')).toBe(before)
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Later edit' })
  editorRuntime().setPendingAssetWrite('asset-one', after)
  result.resolve(saved)
  await flushPromises()
  expect(inspector.props('region').translatedText).toBe('Later edit')
  expect(editorRuntime().pendingAssetWrites.value.get('asset-one')).toBe(after)
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  expect(useProjectStore().document!.cards).toHaveLength(project.cards.length)
})

it('preserves the current card and its undo history when loading the next image fails', async () => {
  const { wrapper, canvas, inspector, toolbar } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Changed' })
  vi.mocked(loadFolderProjectCardImage).mockRejectedValueOnce(new Error('missing image'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('one')
  expect(inspector.props('region').translatedText).toBe('Changed')
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(inspector.props('region').translatedText).toBe('Before 0')
})

it('marks a successful snapshot saved and clears only its pending asset images', async () => {
  const { toolbar, canvas, inspector } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Saved edit' })
  await nextTick()
  const saved = JSON.parse(JSON.stringify(useProjectStore().document!)) as FolderProjectDocument
  editorRuntime().setPendingAssetWrite('asset-one', new Blob(['asset']))
  vi.mocked(saveFolderProject).mockResolvedValueOnce(saved)
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(toolbar.props('saveStatus')).toBe('saved')
  expect(editorRuntime().pendingAssetWrites.value.size).toBe(0)
})

it('keeps undo history when the first save binds the draft to a saved card', async () => {
  const { toolbar, canvas, project } = await mountSavedEditor()
  vi.mocked(folderProjectExists).mockResolvedValueOnce(false)
  toolbar.vm.$emit('open-project')
  await flushPromises()
  canvas.vm.$emit('image', new File(['image'], 'draft.png', { type: 'image/png' }))
  await flushPromises()
  canvas.vm.$emit('add-region', { x: 2, y: 2, width: 20, height: 20 }, '#ffffff')
  await nextTick()
  expect(canvas.props('project').regions).toHaveLength(1)
  vi.mocked(createFolderProject).mockImplementationOnce(async (_directory, card, _file, id) => ({
    ...project,
    activeCardId: id!,
    cards: [{ ...JSON.parse(JSON.stringify(card)), id: id!, imagePath: 'images/draft.png', printArea: null, sourceDpi: null }],
  }))
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(createFolderProject).toHaveBeenCalledOnce()
  expect(toolbar.props('saveStatus')).toBe('saved')
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions).toEqual([])
  expect(useProjectStore().document!.cards[0]!.regions).toEqual([])
  expect(toolbar.props('saveStatus')).toBe('unsaved')
})
