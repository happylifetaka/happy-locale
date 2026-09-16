// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSavedEditor, unmountEditor } from './helpers/card-editor'

async function setupTools(pinia = createPinia()) {
  const context = await mountSavedEditor(true, pinia)
  context.canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  context.inspector.vm.$emit('update', 'region-0', { backgroundMode: 'manual' })
  await nextTick()
  return context
}

it('shares brush settings with Canvas and makes mask and exclusion editing mutually exclusive', async () => {
  const { wrapper, inspector, canvas } = await setupTools()
  expect(canvas.props()).toMatchObject({ maskBrushSize: 28, maskBrushMode: 'paint', maskEditing: false, exclusionEditing: false })
  inspector.vm.$emit('update-mask-brush-size', 42)
  inspector.vm.$emit('update-mask-brush-mode', 'erase')
  inspector.vm.$emit('toggle-mask-editing')
  await nextTick()
  expect(canvas.props()).toMatchObject({ maskBrushSize: 42, maskBrushMode: 'erase', maskEditing: true, exclusionEditing: false })
  expect(wrapper.get('#inspector-tab-region').attributes('aria-selected')).toBe('true')
  inspector.vm.$emit('toggle-exclusion-editing')
  await nextTick()
  expect(canvas.props()).toMatchObject({ maskEditing: false, exclusionEditing: true })
  inspector.vm.$emit('toggle-mask-editing')
  await nextTick()
  expect(canvas.props()).toMatchObject({ maskEditing: true, exclusionEditing: false })
})

it('stops mask editing when the background no longer uses a manual mask', async () => {
  const { inspector, canvas } = await setupTools()
  inspector.vm.$emit('toggle-mask-editing')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { backgroundMode: 'solid' })
  await nextTick()
  expect(canvas.props('maskEditing')).toBe(false)
})

it('retains brush settings but stops editing modes across card, view, and project switches', async () => {
  const { wrapper, toolbar, inspector, canvas } = await setupTools()
  inspector.vm.$emit('update-mask-brush-size', 42)
  inspector.vm.$emit('update-mask-brush-mode', 'erase')
  inspector.vm.$emit('toggle-mask-editing')
  await nextTick()
  toolbar.vm.$emit('view', 'assets')
  await nextTick()
  expect(canvas.props()).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
  toolbar.vm.$emit('view', 'card')
  inspector.vm.$emit('toggle-exclusion-editing')
  await nextTick()
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(canvas.props()).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(canvas.props()).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
})

it('clears exclusion selection when it is removed and stops exclusion editing on region selection changes', async () => {
  const { inspector, canvas, toolbar } = await setupTools()
  canvas.vm.$emit('add-exclusion', 'region-0', { x: 2, y: 2, width: 5, height: 5 })
  await nextTick()
  expect(canvas.props('selectedExclusionId')).toBeTruthy()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('selectedExclusionId')).toBeNull()
  inspector.vm.$emit('toggle-exclusion-editing')
  await nextTick()
  canvas.vm.$emit('select-region', null)
  await nextTick()
  expect(canvas.props('exclusionEditing')).toBe(false)
})

it('starts with default tools after the editor is closed and reopened', async () => {
  const pinia = createPinia()
  const { inspector } = await setupTools(pinia)
  inspector.vm.$emit('update-mask-brush-size', 42)
  inspector.vm.$emit('update-mask-brush-mode', 'erase')
  inspector.vm.$emit('toggle-mask-editing')
  await nextTick()
  unmountEditor()
  const { canvas } = await mountSavedEditor(true, pinia)
  expect(canvas.props()).toMatchObject({ maskBrushSize: 28, maskBrushMode: 'paint', maskEditing: false, exclusionEditing: false })
})
