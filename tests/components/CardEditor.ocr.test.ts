// @vitest-environment happy-dom
import type { OCRResult } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, mountEditor, ocrIO, unmountEditor } from './helpers/card-editor'

const recognized: OCRResult = { text: 'Draw a card', confidence: 92, blocks: [] }

beforeEach(() => ocrIO.recognize.mockResolvedValue(recognized))

async function setupOCR() {
  const context = await mountEditor()
  editorRuntime().cardImage.value = document.createElement('img')
  context.inspector.vm.$emit('update', context.inspector.props('region').id, { originalText: 'Before OCR' })
  await nextTick()
  return { ...context, toolbar: context.wrapper.findComponent({ name: 'EditorToolbar' }) }
}

async function recognize() {
  const context = await setupOCR()
  context.inspector.vm.$emit('recognize-text')
  await flushPromises()
  return context
}

describe('card editor selected region OCR', () => {
  it('reports progress, waits for acceptance, and applies the text in one undo step', async () => {
    const result = deferred<OCRResult>()
    ocrIO.recognize.mockImplementationOnce((_blob, options) => {
      options?.onProgress?.({ progress: 0.5, status: 'Recognizing' })
      return result.promise
    })
    const { inspector, wrapper, canvas, toolbar } = await setupOCR()
    inspector.vm.$emit('recognize-text')
    inspector.vm.$emit('recognize-text')
    await flushPromises()
    expect(ocrIO.recognize).toHaveBeenCalledOnce()
    expect(ocrIO.prepareRegionForOCR).toHaveBeenCalledWith(editorRuntime().cardImage.value, expect.objectContaining({ originalText: 'Before OCR' }), { scale: 3, exclusions: [] })
    expect(inspector.props()).toMatchObject({ ocrRunning: true, ocrProgress: 0.5, ocrStatus: 'Recognizing' })
    expect(wrapper.get('#inspector-tab-ocr').attributes('aria-selected')).toBe('true')
    result.resolve(recognized)
    await flushPromises()
    expect(inspector.props()).toMatchObject({ ocrCandidate: recognized.text, ocrConfidence: 92, ocrRunning: false, ocrProgress: null, ocrStatus: '' })
    expect(inspector.props('region').originalText).toBe('Before OCR')
    inspector.vm.$emit('apply-ocr-candidate')
    await nextTick()
    expect(canvas.props('project').regions[0].originalText).toBe('Draw a card')
    expect(inspector.props('ocrCandidate')).toBe('')
    expect(canvas.props('previewMode')).toBe('edited')
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(inspector.props('region').originalText).toBe('Before OCR')
    toolbar.vm.$emit('redo')
    await nextTick()
    expect(inspector.props('region').originalText).toBe('Draw a card')
  })

  it('lets the user edit and trim a candidate before accepting it', async () => {
    const { inspector } = await recognize()
    inspector.vm.$emit('update-ocr-candidate', '  Manual correction  ')
    inspector.vm.$emit('apply-ocr-candidate')
    await nextTick()
    expect(inspector.props('region').originalText).toBe('Manual correction')
  })

  it('discards a candidate without adding an undo step', async () => {
    const { inspector, toolbar } = await recognize()
    inspector.vm.$emit('discard-ocr-candidate')
    await nextTick()
    expect(inspector.props('ocrCandidate')).toBe('')
    expect(inspector.props('region').originalText).toBe('Before OCR')
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(inspector.props('region').originalText).toBe('')
  })

  it.each(['selection', 'contents', 'assets'] as const)('discards a late OCR result after %s changes', async (change) => {
    const result = deferred<OCRResult>()
    ocrIO.recognize.mockReturnValueOnce(result.promise)
    const { inspector, canvas, wrapper } = await setupOCR()
    inspector.vm.$emit('recognize-text')
    await flushPromises()
    if (change === 'selection')
      canvas.vm.$emit('select-region', null)
    else if (change === 'contents')
      inspector.vm.$emit('update', inspector.props('region').id, { originalText: 'Manual edit' })
    else
      useProjectStore().setAssets([])
    await nextTick()
    result.resolve(recognized)
    await flushPromises()
    expect(inspector.props('ocrCandidate')).toBe('')
    expect(inspector.props('ocrRunning')).toBe(false)
    expect(wrapper.get('.notice').text()).toContain('認識中に対象が変更されたため')
  })

  it('rejects an accepted candidate if the region changed after recognition', async () => {
    const { inspector, wrapper } = await recognize()
    inspector.vm.$emit('update', inspector.props('region').id, { translatedText: '手動編集' })
    await nextTick()
    inspector.vm.$emit('apply-ocr-candidate')
    await nextTick()
    expect(inspector.props('region')).toMatchObject({ originalText: 'Before OCR', translatedText: '手動編集' })
    expect(inspector.props('ocrCandidate')).toBe('')
    expect(wrapper.get('.notice').text()).toContain('領域が変更されたため')
  })

  it('offers local corrections separately and clears them when the candidate is edited', async () => {
    ocrIO.recognize.mockResolvedValueOnce({ ...recognized, text: '0ne card' })
    const { inspector } = await recognize()
    expect(inspector.props('ocrCandidate')).toBe('0ne card')
    expect(inspector.props('ocrCorrectionCandidate')).toBe('one card')
    expect(inspector.props('region').originalText).toBe('Before OCR')
    inspector.vm.$emit('apply-ocr-correction')
    await nextTick()
    expect(inspector.props('ocrCandidate')).toBe('one card')
    expect(inspector.props('ocrCorrectionCandidate')).toBe('')
    inspector.vm.$emit('add-ocr-dictionary-entry', ' one ', ' First ')
    await flushPromises()
    expect(useProjectStore().ocrDictionary).toEqual([expect.objectContaining({ source: 'one', replacement: 'First' })])
    expect(inspector.props('ocrCorrectionCandidate')).toBe('First card')
    inspector.vm.$emit('update-ocr-candidate', 'Edited candidate')
    await nextTick()
    expect(inspector.props('ocrCorrectionCandidate')).toBe('')
    expect(inspector.props('ocrCorrectionChanges')).toEqual([])
  })

  it('updates dictionary entries case-insensitively and removes their correction', async () => {
    const { inspector } = await recognize()
    inspector.vm.$emit('add-ocr-dictionary-entry', 'draw', 'Take')
    await flushPromises()
    const id = useProjectStore().ocrDictionary[0]!.id
    inspector.vm.$emit('add-ocr-dictionary-entry', 'DRAW', 'Get')
    await flushPromises()
    expect(useProjectStore().ocrDictionary).toEqual([{ id, source: 'draw', replacement: 'Get' }])
    expect(inspector.props('ocrCorrectionCandidate')).toBe('Get a card')
    inspector.vm.$emit('remove-ocr-dictionary-entry', id)
    await flushPromises()
    expect(useProjectStore().ocrDictionary).toEqual([])
    expect(inspector.props('ocrCorrectionCandidate')).toBe('')
  })

  it('restores the edited preview on an empty result and can retry after failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    ocrIO.recognize.mockRejectedValueOnce(new Error('worker failed'))
    const { inspector, canvas } = await recognize()
    expect(errors).toHaveBeenCalledWith('[HappyLocale] 選択領域のOCRに失敗しました', expect.any(Error))
    expect(inspector.props('ocrRunning')).toBe(false)
    expect(canvas.props('previewMode')).toBe('edited')
    ocrIO.recognize.mockResolvedValueOnce({ text: '', confidence: null, blocks: [] })
    inspector.vm.$emit('recognize-text')
    await flushPromises()
    expect(ocrIO.recognize).toHaveBeenCalledTimes(2)
    expect(inspector.props('ocrCandidate')).toBe('')
    expect(canvas.props('previewMode')).toBe('edited')
  })

  it('disposes the worker on unmount', async () => {
    await setupOCR()
    expect(ocrIO.dispose).not.toHaveBeenCalled()
    unmountEditor()
    expect(ocrIO.dispose).toHaveBeenCalledOnce()
  })
})

it.each([
  ['prepare', 'resolve'],
  ['prepare', 'reject'],
  ['recognize', 'resolve'],
  ['recognize', 'reject'],
] as const)('ignores %s completing with %s after closing and reopening the editor', async (stage, outcome) => {
  const preparation = deferred<Blob>()
  const recognition = deferred<OCRResult>()
  if (stage === 'prepare')
    ocrIO.prepareRegionForOCR.mockReturnValueOnce(preparation.promise)
  else ocrIO.recognize.mockReturnValueOnce(recognition.promise)
  const previous = await setupOCR()
  previous.inspector.vm.$emit('recognize-text')
  await flushPromises()
  unmountEditor()
  const current = await setupOCR()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const warningCount = vi.mocked(console.warn).mock.calls.length
  const recognizeCount = ocrIO.recognize.mock.calls.length
  const timers = vi.getTimerCount()
  if (stage === 'prepare') {
    if (outcome === 'resolve')
      preparation.resolve(new Blob(['prepared']))
    else preparation.reject(new Error('late preparation error'))
  }
  else if (outcome === 'resolve') {
    recognition.resolve(recognized)
  }
  else {
    recognition.reject(new Error('late recognition error'))
  }
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(recognizeCount)
  expect(console.warn).toHaveBeenCalledTimes(warningCount)
  expect(errors).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(timers)
  expect(current.inspector.props('ocrCandidate')).toBe('')
  expect(current.inspector.props('ocrRunning')).toBe(false)
})
