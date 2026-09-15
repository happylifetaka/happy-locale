// @vitest-environment happy-dom
import type { OCRResult } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { deferred, editorRuntime, mountEditor, ocrIO, unmountEditor } from './helpers/card-editor'

it('does not start whole-image OCR after unmount during image preparation', async () => {
  const prepared = deferred<Blob>()
  ocrIO.prepareRegionForOCR.mockReturnValueOnce(prepared.promise)
  ocrIO.recognize.mockResolvedValue({ text: '', confidence: null, blocks: [] })
  const { wrapper } = await mountEditor()
  editorRuntime().cardImage.value = document.createElement('img')
  await nextTick()
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  expect(ocrIO.prepareRegionForOCR).toHaveBeenCalledOnce()
  expect(ocrIO.recognize).not.toHaveBeenCalled()

  unmountEditor()
  expect(ocrIO.dispose).toHaveBeenCalledOnce()
  prepared.resolve(new Blob(['prepared']))
  await flushPromises()
  expect(ocrIO.recognize).not.toHaveBeenCalled()
})

it.each(['resolved', 'rejected'] as const)('ignores whole-image OCR completion after unmount when the request is %s', async (completion) => {
  const result = deferred<OCRResult>()
  ocrIO.recognize.mockReturnValueOnce(result.promise)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { wrapper } = await mountEditor()
  editorRuntime().cardImage.value = document.createElement('img')
  await nextTick()
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledOnce()

  unmountEditor()
  expect(ocrIO.dispose).toHaveBeenCalledOnce()
  const warnings = vi.mocked(console.warn).mock.calls.length
  const errors = vi.mocked(console.error).mock.calls.length
  const timers = vi.getTimerCount()
  if (completion === 'resolved')
    result.resolve({ text: '', confidence: null, blocks: [] })
  else
    result.reject(new Error('worker terminated'))
  await flushPromises()
  expect(console.warn).toHaveBeenCalledTimes(warnings)
  expect(console.error).toHaveBeenCalledTimes(errors)
  expect(vi.getTimerCount()).toBe(timers)
})
