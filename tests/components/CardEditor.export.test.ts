// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { canvasExports, deferred, downloadBlob, mountSavedEditor, unmountEditor } from './helpers/card-editor'

it.each(['png', 'jpeg'] as const)('exports eligible cards in sequence as %s and restores the original card', async (format) => {
  const { wrapper } = await mountSavedEditor()
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('select', 'two')
  await flushPromises()
  list.vm.$emit('delete', 'three')
  await nextTick()
  await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
  const blob = new Blob(['export'])
  const exportedIds: string[] = []
  const render = format === 'png' ? canvasExports.exportPng : canvasExports.exportJpeg
  render.mockImplementation(async () => {
    exportedIds.push(useProjectStore().document!.activeCardId)
    return blob
  })
  list.vm.$emit('export-all', format)
  await flushPromises()
  expect(exportedIds).toEqual(['one', 'two'])
  expect(vi.mocked(downloadBlob).mock.calls.map(call => call[1])).toEqual([
    `001-one-ja.${format === 'png' ? 'png' : 'jpg'}`,
    `002-two-ja.${format === 'png' ? 'png' : 'jpg'}`,
  ])
  expect(useProjectStore().document!.activeCardId).toBe('two')
})

it('skips an empty render and ignores a duplicate batch request', async () => {
  const { wrapper } = await mountSavedEditor()
  const first = deferred<Blob | null>()
  canvasExports.exportPng.mockReturnValueOnce(first.promise).mockResolvedValue(new Blob(['image']))
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('export-all', 'png')
  list.vm.$emit('export-all', 'png')
  await flushPromises()
  expect(canvasExports.exportPng).toHaveBeenCalledOnce()
  first.resolve(null)
  await flushPromises()
  expect(canvasExports.exportPng).toHaveBeenCalledTimes(3)
  expect(downloadBlob).toHaveBeenCalledTimes(2)
  expect(wrapper.get('.notice').text()).toContain('2枚')
  expect(useProjectStore().document!.activeCardId).toBe('one')
})

it.each(['single', 'batch'] as const)('does not download a pending %s export after unmount', async (mode) => {
  const { wrapper } = await mountSavedEditor()
  const rendered = deferred<Blob | null>()
  canvasExports.exportPng.mockReturnValueOnce(rendered.promise)
  const list = wrapper.findComponent({ name: 'CardList' })
  if (mode === 'single')
    list.vm.$emit('export-png', 'one')
  else
    list.vm.$emit('export-all', 'png')
  await flushPromises()
  expect(canvasExports.exportPng).toHaveBeenCalledOnce()
  unmountEditor()
  rendered.resolve(new Blob(['image']))
  await flushPromises()
  expect(downloadBlob).not.toHaveBeenCalled()
  expect(canvasExports.exportPng).toHaveBeenCalledOnce()
})
