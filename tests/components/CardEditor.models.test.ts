// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSavedEditor, ocrIO } from './helpers/card-editor'

it('uses inspector OCR layout and keeps edited correction text pending until acceptance', async () => {
  const { wrapper, canvas, inspector } = await mountSavedEditor(true, createPinia(), true)
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  await wrapper.get('#inspector-tab-ocr').trigger('click')
  await inspector.get('#inspector-panel-ocr select').setValue('single-line')
  ocrIO.recognize.mockResolvedValueOnce({ text: '0ne card', confidence: 90, blocks: [] })
  inspector.vm.$emit('recognizeText')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ layout: 'single-line' }))
  expect(inspector.props('ocrCorrectionCandidate')).toBe('one card')
  await inspector.get('.ocr-correction textarea').setValue('Manual correction')
  expect(inspector.props('ocrCorrectionCandidate')).toBe('Manual correction')
  expect(inspector.props('region').originalText).toBe('Source 0')
  inspector.vm.$emit('applyOcrCorrection')
  await nextTick()
  expect(inspector.props('ocrCandidate')).toBe('Manual correction')
  expect(inspector.props('region').originalText).toBe('Source 0')
  inspector.vm.$emit('discardOcrCandidate')
  await nextTick()
  expect(inspector.props('region').originalText).toBe('Source 0')
})

it('synchronizes automatic mask preview from the inspector to Canvas', async () => {
  const { wrapper, canvas, inspector } = await mountSavedEditor(true, createPinia(), true)
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { backgroundMode: 'auto' })
  await wrapper.get('#inspector-tab-region').trigger('click')
  const label = inspector.findAll('label').find(item => item.text().includes('補修範囲を表示'))!
  await label.get('input').setValue(true)
  expect(canvas.attributes('auto-mask-preview')).toBe('true')
  await label.get('input').setValue(false)
  expect(canvas.attributes('auto-mask-preview')).toBe('false')
})
