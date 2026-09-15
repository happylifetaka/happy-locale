// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { addFolderProjectCards, createCardThumbnailBlob, deferred, editorRuntime, loadFolderProjectCardImage, mountSavedEditor, unmountEditor } from './helpers/card-editor'

it('renames the active card and reorders cards without losing its edits', async () => {
  const { wrapper, canvas } = await mountSavedEditor()
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('rename', 'one', '  renamed.png  ')
  list.vm.$emit('move', 'one', 1)
  await nextTick()
  expect(useProjectStore().document!.cards.map(card => card.id)).toEqual(['two', 'one', 'three'])
  expect(useProjectStore().document!.cards[1]!.imageName).toBe('renamed.png')
  expect(canvas.props('project').imageName).toBe('renamed.png')
  expect(canvas.props('project').regions).toHaveLength(1)
})

it('moves away from a deleted card, keeps deletion pending, and allows cancellation', async () => {
  const { wrapper } = await mountSavedEditor()
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('delete', 'one')
  await nextTick()
  await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('two')
  expect(useProjectStore().document!.cards).toHaveLength(3)
  expect(list.props('pendingDeletionIds').has('one')).toBe(true)
  list.vm.$emit('cancel-delete', 'one')
  await nextTick()
  expect(list.props('pendingDeletionIds').size).toBe(0)
})

it('does not mark the current card for deletion if the replacement image cannot be loaded', async () => {
  const { wrapper } = await mountSavedEditor()
  const list = wrapper.findComponent({ name: 'CardList' })
  vi.mocked(loadFolderProjectCardImage).mockRejectedValueOnce(new Error('missing image'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  list.vm.$emit('delete', 'one')
  await nextTick()
  await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('one')
  expect(list.props('pendingDeletionIds').size).toBe(0)
})

it('keeps the last remaining card and prevents reordering while deletions are pending', async () => {
  const { wrapper } = await mountSavedEditor()
  const list = wrapper.findComponent({ name: 'CardList' })
  for (const id of ['two', 'three']) {
    list.vm.$emit('delete', id)
    await nextTick()
    await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
    await flushPromises()
  }
  list.vm.$emit('move', 'one', 1)
  list.vm.$emit('delete', 'one')
  await nextTick()
  expect(useProjectStore().document!.cards.map(card => card.id)).toEqual(['one', 'two', 'three'])
  expect(wrapper.find('[aria-labelledby="card-delete-title"]').exists()).toBe(false)
  expect(wrapper.get('.notice').text()).toContain('最後の1枚')
})

it('adds saved cards without replacing edits or asset images made while saving', async () => {
  const { wrapper, canvas, inspector, project } = await mountSavedEditor()
  const result = deferred<typeof project>()
  vi.mocked(addFolderProjectCards).mockReturnValueOnce(result.promise)
  const before = new Blob(['before'])
  const after = new Blob(['after'])
  editorRuntime().setPendingAssetWrite('asset', before)
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('add', [new File(['image'], 'four.png', { type: 'image/png' })])
  await flushPromises()
  expect(addFolderProjectCards).toHaveBeenCalledOnce()
  const additions = vi.mocked(addFolderProjectCards).mock.calls[0]![2]
  expect(additions).toHaveLength(1)
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Later edit' })
  editorRuntime().setPendingAssetWrite('asset', after)
  result.resolve({ ...project, cards: [...project.cards, { ...project.cards[0]!, id: additions[0]!.id, imageName: 'four.png', regions: [] }] })
  await flushPromises()
  expect(useProjectStore().document!.cards).toHaveLength(4)
  expect(useProjectStore().document!.cards[0]!.regions[0]!.translatedText).toBe('Later edit')
  expect(editorRuntime().pendingAssetWrites.value.get('asset')).toBe(after)
})

it('releases a staged image when thumbnail generation fails before adding cards', async () => {
  const { wrapper } = await mountSavedEditor()
  vi.mocked(createCardThumbnailBlob).mockRejectedValueOnce(new Error('thumbnail failed'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const revocations = vi.mocked(URL.revokeObjectURL).mock.calls.length
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('add', [new File(['image'], 'four.png', { type: 'image/png' })])
  await flushPromises()
  expect(addFolderProjectCards).not.toHaveBeenCalled()
  expect(useProjectStore().document!.cards).toHaveLength(3)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revocations + 1)
})

it('does not start saving additions after unmount during thumbnail preparation', async () => {
  const { wrapper } = await mountSavedEditor()
  const thumbnail = deferred<Blob | null>()
  vi.mocked(createCardThumbnailBlob).mockReturnValueOnce(thumbnail.promise)
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('add', [new File(['image'], 'four.png', { type: 'image/png' })])
  await flushPromises()
  unmountEditor()
  thumbnail.resolve(new Blob(['thumbnail']))
  await flushPromises()
  expect(addFolderProjectCards).not.toHaveBeenCalled()
})
