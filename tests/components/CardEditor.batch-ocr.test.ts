// @vitest-environment happy-dom
import type { OCRResult } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { deferred, editorRuntime, loadFolderProjectCardImage, mountEditor, ocrIO, seedProject, unmountEditor } from './helpers/card-editor'

it.each(['resolved', 'rejected'] as const)('does not start another batch OCR card after unmount when the active request is %s', async (completion) => {
  const firstResult = deferred<OCRResult>()
  const emptyResult: OCRResult = { text: '', confidence: null, blocks: [] }
  ocrIO.recognize.mockReturnValueOnce(firstResult.promise).mockResolvedValue(emptyResult)
  vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'card.png', { type: 'image/png' }))
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => ({ width: 100, height: 140, close: vi.fn() })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { wrapper } = await mountEditor()
  editorRuntime().setDirectory({ name: 'cards' } as FileSystemDirectoryHandle)
  seedProject(['one', 'two', 'three'])
  await nextTick()
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-ocr')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledOnce()
  expect(loadFolderProjectCardImage).toHaveBeenCalledOnce()

  unmountEditor()
  expect(ocrIO.dispose).toHaveBeenCalledOnce()
  const warningsBeforeResult = vi.mocked(console.warn).mock.calls.length
  const errorsBeforeResult = vi.mocked(console.error).mock.calls.length
  const timersBeforeResult = vi.getTimerCount()
  // 終了と最初の結果が競合しても、待機している次のカードは開始してはいけない。
  if (completion === 'resolved')
    firstResult.resolve(emptyResult)
  else
    firstResult.reject(new Error('worker terminated'))
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledOnce()
  expect(loadFolderProjectCardImage).toHaveBeenCalledOnce()
  expect(console.warn).toHaveBeenCalledTimes(warningsBeforeResult)
  expect(console.error).toHaveBeenCalledTimes(errorsBeforeResult)
  expect(vi.getTimerCount()).toBe(timersBeforeResult)
})

it('keeps the current result for review when the user cancels between cards', async () => {
  const firstResult = deferred<OCRResult>()
  ocrIO.recognize.mockReturnValueOnce(firstResult.promise)
  vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'card.png', { type: 'image/png' }))
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 140, close }))
  const { wrapper, canvas } = await mountEditor()
  editorRuntime().setDirectory({ name: 'cards' } as FileSystemDirectoryHandle)
  editorRuntime().cardImage.value = document.createElement('img')
  await nextTick()
  const list = wrapper.findComponent({ name: 'CardList' })
  const cardId = list.props('activeCardId')
  expect(cardId).toEqual(expect.any(String))
  seedProject([cardId, 'two', 'three'])
  await nextTick()
  list.vm.$emit('start-batch-ocr')
  await flushPromises()
  list.vm.$emit('cancel-batch-ocr')
  firstResult.resolve({ text: 'Draw a card', confidence: 95, blocks: [
    { text: 'Draw a card', confidence: 95, x: 10, y: 20, width: 100, height: 20 },
  ] })
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledOnce()
  expect(loadFolderProjectCardImage).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(list.props('batchOcrRunning')).toBe(false)
  expect([...list.props('batchOcrStates').entries()]).toEqual([[cardId, { status: 'review', candidates: 1 }]])
  expect(canvas.props('regionCandidates')).toEqual([expect.objectContaining({ text: 'Draw a card' })])
  expect(ocrIO.dispose).not.toHaveBeenCalled()
})

it.each(['image read', 'bitmap decode', 'preprocessing'] as const)('does not start OCR after unmount during %s and releases decoded images', async (stage) => {
  const file = new File(['image'], 'card.png', { type: 'image/png' })
  const fileResult = deferred<File>()
  const bitmapResult = deferred<ImageBitmap>()
  const cropResult = deferred<Blob>()
  const close = vi.fn()
  const bitmap = { width: 100, height: 140, close } as unknown as ImageBitmap
  vi.mocked(loadFolderProjectCardImage).mockReturnValue(stage === 'image read' ? fileResult.promise : Promise.resolve(file))
  const decode = vi.fn().mockReturnValue(stage === 'bitmap decode' ? bitmapResult.promise : Promise.resolve(bitmap))
  vi.stubGlobal('createImageBitmap', decode)
  if (stage === 'preprocessing')
    ocrIO.prepareRegionForOCR.mockReturnValueOnce(cropResult.promise)
  ocrIO.recognize.mockResolvedValue({ text: '', confidence: null, blocks: [] })
  const { wrapper } = await mountEditor()
  editorRuntime().setDirectory({ name: 'cards' } as FileSystemDirectoryHandle)
  seedProject(['one', 'two'])
  await nextTick()
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-ocr')
  await flushPromises()
  unmountEditor()
  fileResult.resolve(file)
  bitmapResult.resolve(bitmap)
  cropResult.resolve(new Blob(['crop']))
  await flushPromises()
  expect(ocrIO.recognize).not.toHaveBeenCalled()
  expect(loadFolderProjectCardImage).toHaveBeenCalledOnce()
  if (stage === 'image read')
    expect(decode).not.toHaveBeenCalled()
  else
    expect(close).toHaveBeenCalledOnce()
})
