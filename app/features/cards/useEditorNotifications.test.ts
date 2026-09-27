// @vitest-environment happy-dom
import type { EffectScope } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useEditorNotifications } from './useEditorNotifications'

let scope: EffectScope
beforeEach(() => {
  vi.useFakeTimers()
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

it('expires after four seconds without clearing a newer different message', () => {
  const notifications = scope.run(useEditorNotifications)!
  notifications.setMessage('first')
  vi.advanceTimersByTime(2000)
  notifications.setMessage('second')
  vi.advanceTimersByTime(2000)
  expect(notifications.message.value).toBe('second')
  vi.advanceTimersByTime(1999)
  expect(notifications.message.value).toBe('second')
  vi.advanceTimersByTime(1)
  expect(notifications.message.value).toBe('')
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves the existing same-text expiry policy', () => {
  const notifications = scope.run(useEditorNotifications)!
  notifications.setMessage('same')
  vi.advanceTimersByTime(2000)
  notifications.setMessage('same')
  vi.advanceTimersByTime(2000)
  expect(notifications.message.value).toBe('')
  vi.advanceTimersByTime(2000)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels all pending timers on disposal and ignores late notifications', () => {
  const notifications = scope.run(useEditorNotifications)!
  notifications.setMessage('one')
  notifications.setMessage('two')
  expect(vi.getTimerCount()).toBe(2)
  scope.stop()
  expect(vi.getTimerCount()).toBe(0)
  notifications.setMessage('late')
  expect(vi.getTimerCount()).toBe(0)
  expect(notifications.message.value).toBe('two')
})
