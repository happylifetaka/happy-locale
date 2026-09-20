// @vitest-environment happy-dom
import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { useEditorHistoryShortcuts } from './useEditorHistoryShortcuts'

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.replaceChildren()
})

function setup() {
  const enabled = ref(true)
  const undo = vi.fn()
  const redo = vi.fn()
  wrapper = mount(defineComponent({
    setup() {
      useEditorHistoryShortcuts({ enabled: () => enabled.value, undo, redo })
      return () => null
    },
  }))
  return { enabled, undo, redo }
}

function keydown(init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

it('reads the current enabled state and detaches on unmount', () => {
  const { enabled, undo, redo } = setup()
  expect(keydown().defaultPrevented).toBe(true)
  expect(undo).toHaveBeenCalledOnce()
  expect(keydown({ shiftKey: true }).defaultPrevented).toBe(true)
  expect(redo).toHaveBeenCalledOnce()
  enabled.value = false
  expect(keydown().defaultPrevented).toBe(false)
  enabled.value = true
  wrapper!.unmount()
  wrapper = undefined
  expect(keydown().defaultPrevented).toBe(false)
  expect(undo).toHaveBeenCalledOnce()
  setup()
  expect(keydown().defaultPrevented).toBe(true)
  expect(undo).toHaveBeenCalledOnce()
})

it.each(['dialog', 'alertdialog'])('respects input fields and an open %s', (role) => {
  const { undo } = setup()
  const input = document.createElement('input')
  document.body.append(input)
  expect(keydown({}, input).defaultPrevented).toBe(false)
  const modal = document.createElement('section')
  modal.setAttribute('role', role)
  modal.setAttribute('aria-modal', 'true')
  document.body.append(modal)
  expect(keydown().defaultPrevented).toBe(false)
  expect(undo).not.toHaveBeenCalled()
  modal.remove()
  expect(keydown().defaultPrevented).toBe(true)
  expect(undo).toHaveBeenCalledOnce()
})
