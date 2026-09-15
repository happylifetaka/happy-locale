// @vitest-environment happy-dom
import type { OCRResult } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { deferred, editorRuntime, mountEditor, mountSavedEditor, ocrIO, unmountEditor } from './helpers/card-editor'

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

const recognized: OCRResult = {
  text: 'Draw cards\nGain coins',
  confidence: 95,
  blocks: [
    { text: 'Draw cards', confidence: 95, x: 20, y: 20, width: 100, height: 20 },
    { text: 'Gain coins', confidence: 95, x: 20, y: 44, width: 100, height: 20 },
  ],
}

async function setupCandidates() {
  const context = await mountSavedEditor(false)
  editorRuntime().cardImage.value = document.createElement('img')
  await nextTick()
  const panel = context.wrapper.findComponent({ name: 'RegionCandidatePanel' })
  panel.vm.$emit('detect')
  await flushPromises()
  return { ...context, panel }
}

it('moves and splits candidates with independent undo history before confirming selected candidates', async () => {
  ocrIO.recognize.mockResolvedValue(recognized)
  const { wrapper, panel, canvas } = await setupCandidates()
  const original = JSON.parse(JSON.stringify(canvas.props('regionCandidates')[0]))
  expect(original.lines).toHaveLength(2)
  const initialRegions = canvas.props('project').regions.length
  canvas.vm.$emit('update-region-candidate-bounds', original.id, { x: original.x + 10, y: original.y + 5, width: original.width * 2, height: original.height * 2 })
  await nextTick()
  expect(canvas.props('regionCandidates')[0].lines[0]).toMatchObject({
    x: original.x + 10 + (original.lines[0].x - original.x) * 2,
    y: original.y + 5 + (original.lines[0].y - original.y) * 2,
    width: original.lines[0].width * 2,
  })
  panel.vm.$emit('split', original.id)
  await nextTick()
  expect(canvas.props('regionCandidates')).toHaveLength(2)
  expect(canvas.props('selectedCandidateId')).toBe(`${original.id}_a`)
  panel.vm.$emit('undo-change')
  await nextTick()
  expect(canvas.props('regionCandidates')).toHaveLength(1)
  expect(canvas.props('selectedCandidateId')).toBeNull()
  panel.vm.$emit('undo-change')
  await nextTick()
  expect(canvas.props('regionCandidates')[0]).toEqual(original)
  expect(panel.props('canUndoChange')).toBe(false)
  expect(canvas.props('project').regions).toHaveLength(initialRegions)
  panel.vm.$emit('split', original.id)
  await nextTick()
  panel.vm.$emit('select-all', false)
  panel.vm.$emit('confirm')
  await nextTick()
  expect(wrapper.get('.notice').text()).toContain('追加する領域候補を選択')
  panel.vm.$emit('toggle', `${original.id}_b`)
  panel.vm.$emit('confirm')
  await nextTick()
  expect(canvas.props('regionCandidates')).toEqual([])
  expect(canvas.props('project').regions).toHaveLength(initialRegions + 1)
  expect(canvas.props('project').regions.at(-1).originalText).toBe('Gain coins')
  wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions).toHaveLength(initialRegions)
})

it('reports recognition failures and allows a subsequent detection', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  ocrIO.recognize.mockRejectedValueOnce(new Error('recognition failed')).mockResolvedValue(recognized)
  const { wrapper, panel, canvas } = await setupCandidates()
  expect(panel.props('running')).toBe(false)
  expect(canvas.props('previewMode')).toBe('edited')
  expect(wrapper.get('.notice').text()).toContain('診断ログを確認')
  panel.vm.$emit('detect')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(2)
  expect(canvas.props('regionCandidates')).toHaveLength(1)
  panel.vm.$emit('cancel')
  await nextTick()
  expect(canvas.props('regionCandidates')).toEqual([])
  expect(canvas.props('previewMode')).toBe('edited')
})
