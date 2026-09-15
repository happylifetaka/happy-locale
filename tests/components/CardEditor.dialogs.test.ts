// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountEditor } from './helpers/card-editor'

it.each(['escape', 'backdrop', 'button'] as const)('cancels region deletion with %s without changing history', async (method) => {
  const { wrapper, canvas } = await mountEditor()
  const original = canvas.props('project').regions[0]
  wrapper.findComponent({ name: 'RegionList' }).vm.$emit('remove', original.id)
  await nextTick()
  const dialog = wrapper.get('[aria-labelledby="region-delete-title"]')
  if (method === 'escape')
    await dialog.trigger('keydown', { key: 'Escape' })
  else if (method === 'backdrop')
    await wrapper.get('.confirmation-backdrop').trigger('click')
  else
    await dialog.get('button').trigger('click')
  expect(wrapper.find('[aria-labelledby="region-delete-title"]').exists()).toBe(false)
  expect(canvas.props('project').regions).toHaveLength(1)
})

it('confirms region deletion and restores it with undo', async () => {
  const { wrapper, canvas } = await mountEditor()
  wrapper.findComponent({ name: 'RegionList' }).vm.$emit('remove', canvas.props('project').regions[0].id)
  await nextTick()
  await wrapper.get('[aria-labelledby="region-delete-title"] .confirmation-danger').trigger('click')
  expect(canvas.props('project').regions).toEqual([])
  wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions).toHaveLength(1)
})

it('blocks undo while a confirmation is open and restores normal undo after closing it', async () => {
  const { wrapper, canvas } = await mountEditor()
  wrapper.findComponent({ name: 'RegionList' }).vm.$emit('remove', canvas.props('project').regions[0].id)
  await nextTick()
  const blocked = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  window.dispatchEvent(blocked)
  await nextTick()
  expect(canvas.props('project').regions).toHaveLength(1)
  expect(blocked.defaultPrevented).toBe(false)
  await wrapper.get('[aria-labelledby="region-delete-title"]').trigger('keydown', { key: 'Escape' })
  const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  window.dispatchEvent(undo)
  await nextTick()
  expect(canvas.props('project').regions).toEqual([])
  expect(undo.defaultPrevented).toBe(true)
})

it('shows diagnostic details, clears the log, and closes on escape', async () => {
  const { wrapper } = await mountEditor()
  const toolbar = wrapper.findComponent({ name: 'EditorToolbar' })
  toolbar.vm.$emit('diagnostic', 'Test diagnostic', { detail: 'test-detail' })
  toolbar.vm.$emit('open-diagnostics')
  await nextTick()
  const dialog = wrapper.get('[aria-labelledby="diagnostics-title"]')
  expect(dialog.text()).toContain('Test diagnostic')
  expect(dialog.get('code').text()).toBeTruthy()
  await dialog.get('.diagnostics-dialog-actions button').trigger('click')
  expect(dialog.text()).toContain('ログはまだありません')
  expect(dialog.get('.diagnostics-dialog-actions button').attributes('disabled')).toBeDefined()
  await dialog.trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('[aria-labelledby="diagnostics-title"]').exists()).toBe(false)
})

it('does not intercept undo from a text input', async () => {
  const { canvas } = await mountEditor()
  const input = document.createElement('input')
  document.body.append(input)
  try {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(false)
    expect(canvas.props('project').regions).toHaveLength(1)
  }
  finally {
    input.remove()
  }
})
