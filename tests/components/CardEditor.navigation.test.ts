// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, loadFolderProjectCardImage, mountSavedEditor, ocrIO, unmountEditor } from './helpers/card-editor'

it('blocks card switching while OCR is running and allows it after recognition', async () => {
  const { wrapper } = await mountSavedEditor()
  const result = deferred<import('~/services/ocr/types').OCRResult>()
  ocrIO.recognize.mockReturnValueOnce(result.promise)
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  const calls = vi.mocked(loadFolderProjectCardImage).mock.calls.length
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('select', 'two')
  await flushPromises()
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(calls)
  expect(useProjectStore().document!.activeCardId).toBe('one')
  result.resolve({ text: '', confidence: null, blocks: [] })
  await flushPromises()
  list.vm.$emit('select', 'two')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('two')
})

it.each(['resolve', 'reject'] as const)('ignores image file loading that completes after unmount with %s', async (completion) => {
  const { wrapper } = await mountSavedEditor()
  const file = deferred<File>()
  vi.mocked(loadFolderProjectCardImage).mockReturnValueOnce(file.promise)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  unmountEditor()
  const urls = vi.mocked(URL.createObjectURL).mock.calls.length
  const errors = vi.mocked(console.error).mock.calls.length
  const warnings = vi.mocked(console.warn).mock.calls.length
  if (completion === 'resolve')
    file.resolve(new File(['image'], 'two.png', { type: 'image/png' }))
  else
    file.reject(new Error('file unavailable'))
  await flushPromises()
  expect(URL.createObjectURL).toHaveBeenCalledTimes(urls)
  expect(editorRuntime().cardImage.value).toBeNull()
  expect(console.warn).toHaveBeenCalledTimes(warnings)
  expect(console.error).toHaveBeenCalledTimes(errors)
})

it('retains undo histories separately when switching cards', async () => {
  const { wrapper, canvas, inspector, toolbar } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'First edit' })
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('select', 'two')
  await flushPromises()
  canvas.vm.$emit('select-region', 'region-1')
  await nextTick()
  inspector.vm.$emit('update', 'region-1', { translatedText: 'Second edit' })
  list.vm.$emit('select', 'one')
  await flushPromises()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(useProjectStore().document!.cards[0]!.regions[0]!.translatedText).toBe('Before 0')
  expect(useProjectStore().document!.cards[1]!.regions[0]!.translatedText).toBe('Second edit')
})

it('releases an image that finishes decoding after unmount', async () => {
  const { wrapper } = await mountSavedEditor()
  const decoded = deferred<void>()
  const removeAttribute = vi.fn()
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

    decode = () => decoded.promise
    removeAttribute = removeAttribute
  })
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  unmountEditor()
  const revocations = vi.mocked(URL.revokeObjectURL).mock.calls.length
  const warnings = vi.mocked(console.warn).mock.calls.length
  decoded.resolve()
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revocations + 1)
  expect(removeAttribute).toHaveBeenCalledWith('src')
  expect(editorRuntime().cardImage.value).toBeNull()
  expect(console.warn).toHaveBeenCalledTimes(warnings)
})
