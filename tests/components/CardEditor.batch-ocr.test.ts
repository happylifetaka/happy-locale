// @vitest-environment happy-dom
import type { OCRResult } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, loadFolderProjectCardImage, mountEditor, mountSavedEditor, ocrIO, seedProject, unmountEditor } from './helpers/card-editor'

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

const detectedResult: OCRResult = {
  text: 'Draw a card',
  confidence: 95,
  blocks: [{ text: 'Draw a card', confidence: 95, x: 10, y: 20, width: 100, height: 20 }],
}

it('runs cards sequentially, continues after failure, and confirms results in one undo step', async () => {
  const first = deferred<OCRResult>()
  const second = deferred<OCRResult>()
  const third = deferred<OCRResult>()
  ocrIO.recognize.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => ({ width: 100, height: 140, close })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { wrapper, canvas, toolbar } = await mountSavedEditor(false)
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('start-batch-ocr')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledOnce()
  expect([...list.props('batchOcrStates').values()]).toEqual([{ status: 'processing' }, { status: 'queued' }, { status: 'queued' }])
  first.resolve(detectedResult)
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(2)
  second.reject(new Error('unreadable card'))
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(3)
  third.resolve({ text: '', confidence: null, blocks: [] })
  await flushPromises()
  expect(close).toHaveBeenCalledTimes(3)
  expect(list.props('batchOcrStates')).toEqual(new Map([
    ['one', { status: 'review', candidates: 1 }],
    ['two', { status: 'error', message: 'unreadable card' }],
    ['three', { status: 'empty' }],
  ]))
  expect(list.props('batchOcrCompleted')).toBe(3)
  expect(list.props('batchOcrRunning')).toBe(false)
  expect(canvas.props('project').regions).toEqual([])
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('confirm')
  await flushPromises()
  expect(useProjectStore().document!.cards[0]!.regions).toEqual([expect.objectContaining({ originalText: 'Draw a card' })])
  expect(list.props('batchOcrStates').has('one')).toBe(false)
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(useProjectStore().document!.cards[0]!.regions).toEqual([])
})

it('preserves edited candidates across card switches and advances review after discarding a card', async () => {
  ocrIO.recognize.mockResolvedValue(detectedResult)
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => ({ width: 100, height: 140, close: vi.fn() })))
  const { wrapper, canvas } = await mountSavedEditor(false)
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('start-batch-ocr')
  await flushPromises()
  const firstCandidate = canvas.props('regionCandidates')[0]
  const bounds = { x: 12, y: 20, width: 60, height: 30 }
  canvas.vm.$emit('update-region-candidate-bounds', firstCandidate.id, bounds)
  await nextTick()
  list.vm.$emit('select', 'two')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('two')
  expect(canvas.props('regionCandidates')[0].x).not.toBe(bounds.x)
  list.vm.$emit('select', 'one')
  await flushPromises()
  expect(canvas.props('regionCandidates')[0]).toMatchObject({ id: firstCandidate.id, ...bounds })
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('cancel')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('two')
  expect(list.props('batchOcrStates').has('one')).toBe(false)
  expect(canvas.props('regionCandidates')).toHaveLength(1)
})

it('does not run when fewer than two eligible cards remain after edits and pending deletion', async () => {
  const { wrapper, canvas } = await mountSavedEditor(false)
  canvas.vm.$emit('add-region', { x: 1, y: 1, width: 30, height: 20 }, '#ffffff')
  await nextTick()
  const list = wrapper.findComponent({ name: 'CardList' })
  list.vm.$emit('delete', 'three')
  await nextTick()
  await wrapper.get('[aria-labelledby="card-delete-title"] .confirmation-danger').trigger('click')
  await flushPromises()
  list.vm.$emit('start-batch-ocr')
  await flushPromises()
  expect(ocrIO.recognize).not.toHaveBeenCalled()
  expect(wrapper.get('.notice').text()).toContain('領域未作成のカードが2枚以上')
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
