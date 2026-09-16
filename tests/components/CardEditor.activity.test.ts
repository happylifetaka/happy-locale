// @vitest-environment happy-dom
import type { FolderProjectDocument } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { addFolderProjectCards, deferred, loadFolderProjectCardImage, mountSavedEditor, pickProjectDirectory, saveFolderProject } from './helpers/card-editor'

it.each(['resolve', 'reject'] as const)('blocks navigation during saving and unlocks after %s', async (completion) => {
  const { wrapper, toolbar, project } = await mountSavedEditor()
  const pending = deferred<FolderProjectDocument>()
  vi.mocked(saveFolderProject).mockReturnValueOnce(pending.promise)
  const list = wrapper.getComponent({ name: 'CardList' })
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('true')
  expect(wrapper.get('.project-operation-status').text()).toContain('保存しています')
  const reads = vi.mocked(loadFolderProjectCardImage).mock.calls.length
  list.vm.$emit('select', 'two')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(reads)
  expect(saveFolderProject).toHaveBeenCalledOnce()
  if (completion === 'resolve')
    pending.resolve(project)
  else
    pending.reject(new Error('save failed'))
  await flushPromises()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  list.vm.$emit('select', 'two')
  await flushPromises()
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(reads + 1)
})

it.each(['resolve', 'reject'] as const)('blocks saving during navigation and unlocks after %s', async (completion) => {
  const { wrapper, toolbar } = await mountSavedEditor()
  const pending = deferred<File>()
  vi.mocked(loadFolderProjectCardImage).mockReturnValueOnce(pending.promise)
  const list = wrapper.getComponent({ name: 'CardList' })
  list.vm.$emit('select', 'two')
  await flushPromises()
  expect(list.props('loadingCardId')).toBe('two')
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('true')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).not.toHaveBeenCalled()
  if (completion === 'resolve')
    pending.resolve(new File(['image'], 'two.png', { type: 'image/png' }))
  else
    pending.reject(new Error('load failed'))
  await flushPromises()
  expect(list.props('loadingCardId')).toBeNull()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).toHaveBeenCalledOnce()
})

it.each(['resolve', 'reject'] as const)('blocks saving during card addition and unlocks after %s', async (completion) => {
  const { wrapper, toolbar, project } = await mountSavedEditor()
  const pending = deferred<FolderProjectDocument>()
  vi.mocked(addFolderProjectCards).mockReturnValueOnce(pending.promise)
  wrapper.getComponent({ name: 'CardList' }).vm.$emit('add', [new File(['image'], 'four.png', { type: 'image/png' })])
  await flushPromises()
  expect(addFolderProjectCards).toHaveBeenCalledOnce()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('true')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).not.toHaveBeenCalled()
  if (completion === 'resolve') {
    const additions = vi.mocked(addFolderProjectCards).mock.calls[0]![2]
    pending.resolve({ ...project, cards: [...project.cards, { ...project.cards[0]!, id: additions[0]!.id, imageName: 'four.png', regions: [] }] })
  }
  else {
    pending.reject(new Error('addition failed'))
  }
  await flushPromises()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).toHaveBeenCalledOnce()
})

it.each(['resolve', 'cancel'] as const)('blocks saving during opening and unlocks after %s', async (completion) => {
  const { wrapper, toolbar } = await mountSavedEditor()
  const pending = deferred<FileSystemDirectoryHandle>()
  vi.mocked(pickProjectDirectory).mockReturnValueOnce(pending.promise)
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('true')
  expect(wrapper.get('.project-operation-status').text()).toContain('開いています')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).not.toHaveBeenCalled()
  if (completion === 'resolve')
    pending.resolve({ name: 'cards' } as FileSystemDirectoryHandle)
  else
    pending.reject(new DOMException('cancelled', 'AbortError'))
  await flushPromises()
  expect(wrapper.get('.editor').attributes('aria-busy')).toBe('false')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(saveFolderProject).toHaveBeenCalledOnce()
})
