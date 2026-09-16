// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useEditorToolsStore } from '~/stores/editor-tools'
import { mountSavedEditor, unmountEditor } from './helpers/card-editor'

async function setupTools(pinia = createPinia()) {
  const context = await mountSavedEditor(true, pinia, true)
  context.canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  context.inspector.vm.$emit('update', 'region-0', { backgroundMode: 'manual' })
  await nextTick()
  await context.wrapper.get('#inspector-tab-region').trigger('click')
  return { ...context, tools: useEditorToolsStore(pinia) }
}

it('updates shared brush settings from the inspector and makes mask and exclusion editing mutually exclusive', async () => {
  const { wrapper, inspector, tools } = await setupTools()
  expect(tools.$state).toMatchObject({ maskBrushSize: 28, maskBrushMode: 'paint', maskEditing: false, exclusionEditing: false })
  await inspector.get('.mask-controls input[type=range]').setValue('42')
  await inspector.get('.mask-controls select').setValue('erase')
  await inspector.get('.mask-controls button').trigger('click')
  await nextTick()
  expect(tools.$state).toMatchObject({ maskBrushSize: 42, maskBrushMode: 'erase', maskEditing: true, exclusionEditing: false })
  expect(wrapper.get('#inspector-tab-region').attributes('aria-selected')).toBe('true')
  await inspector.get('.exclusion-controls button').trigger('click')
  await nextTick()
  expect(tools.$state).toMatchObject({ maskEditing: false, exclusionEditing: true })
  await inspector.get('.mask-controls button').trigger('click')
  await nextTick()
  expect(tools.$state).toMatchObject({ maskEditing: true, exclusionEditing: false })
})

it('stops mask editing when the background no longer uses a manual mask', async () => {
  const { inspector, tools } = await setupTools()
  await inspector.get('.mask-controls button').trigger('click')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { backgroundMode: 'solid' })
  await nextTick()
  expect(tools.maskEditing).toBe(false)
})

it('retains brush settings but stops editing modes across card, view, and project switches', async () => {
  const { wrapper, toolbar, inspector, tools } = await setupTools()
  await inspector.get('.mask-controls input[type=range]').setValue('42')
  await inspector.get('.mask-controls select').setValue('erase')
  await inspector.get('.mask-controls button').trigger('click')
  await nextTick()
  toolbar.vm.$emit('view', 'assets')
  await nextTick()
  expect(tools.$state).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
  toolbar.vm.$emit('view', 'card')
  await inspector.get('.exclusion-controls button').trigger('click')
  await nextTick()
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(tools.$state).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(tools.$state).toMatchObject({ maskEditing: false, exclusionEditing: false, maskBrushSize: 42, maskBrushMode: 'erase' })
})

it('clears exclusion selection when it is removed and stops exclusion editing on region selection changes', async () => {
  const { inspector, canvas, toolbar, tools } = await setupTools()
  canvas.vm.$emit('add-exclusion', 'region-0', { x: 2, y: 2, width: 5, height: 5 })
  await nextTick()
  expect(canvas.props('selectedExclusionId')).toBeTruthy()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('selectedExclusionId')).toBeNull()
  await inspector.get('.exclusion-controls button').trigger('click')
  await nextTick()
  canvas.vm.$emit('select-region', null)
  await nextTick()
  expect(tools.exclusionEditing).toBe(false)
})

it('starts with default tools after the editor is closed and reopened', async () => {
  const pinia = createPinia()
  const { inspector } = await setupTools(pinia)
  await inspector.get('.mask-controls input[type=range]').setValue('42')
  await inspector.get('.mask-controls select').setValue('erase')
  await inspector.get('.mask-controls button').trigger('click')
  await nextTick()
  unmountEditor()
  await mountSavedEditor(true, pinia, true)
  const tools = useEditorToolsStore(pinia)
  expect(tools.$state).toMatchObject({ maskBrushSize: 28, maskBrushMode: 'paint', maskEditing: false, exclusionEditing: false })
})
