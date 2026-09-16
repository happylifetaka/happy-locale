// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSavedEditor } from './helpers/card-editor'

it('retains the same Canvas and editor state across asset and print round trips', async () => {
  const { wrapper, canvas, inspector, toolbar } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  canvas.vm.$emit('update:zoom', 125)
  canvas.vm.$emit('update:previewMode', 'original')
  await nextTick()
  await wrapper.get('#inspector-tab-text').trigger('click')
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Workspace draft' })
  await nextTick()
  const originalCanvas = canvas.vm
  for (const view of ['assets', 'print']) {
    if (view === 'assets')
      toolbar.vm.$emit('view', 'assets')
    else wrapper.findComponent({ name: 'CardList' }).vm.$emit('open-print-layout')
    await nextTick()
    expect(wrapper.get('.editor-layout').attributes('style')).toContain('display: none')
    if (view === 'assets')
      toolbar.vm.$emit('view', 'card')
    else wrapper.findComponent({ name: 'PrintLayoutWorkspace' }).vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'CardCanvas' }).vm).toBe(originalCanvas)
    expect(canvas.attributes('zoom')).toBe('125')
    expect(canvas.props('previewMode')).toBe('original')
    expect(inspector.props('region').translatedText).toBe('Workspace draft')
    expect(wrapper.get('#inspector-tab-text').attributes('aria-selected')).toBe('true')
  }
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(inspector.props('region').translatedText).toBe('Before 0')
})

it('shares a single history across Inspector edits, Canvas movement, and toolbar undo/redo', async () => {
  const { canvas, inspector, toolbar } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  const originalX = inspector.props('region').x
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Same history' })
  canvas.vm.$emit('update-region-bounds', 'region-0', { x: 15, y: 10, width: 30, height: 20 })
  await nextTick()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(inspector.props('region')).toMatchObject({ x: originalX, translatedText: 'Same history' })
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(inspector.props('region').translatedText).toBe('Before 0')
  toolbar.vm.$emit('redo')
  toolbar.vm.$emit('redo')
  await nextTick()
  expect(inspector.props('region')).toMatchObject({ x: 15, translatedText: 'Same history' })
})
