import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUnsavedChanges } from '~/composables/useUnsavedChanges'

const hooks = vi.hoisted(() => ({
  mounted: (() => {}) as () => void,
  unmount: (() => {}) as () => void,
  leave: (() => Promise.resolve(true)) as () => Promise<boolean>,
}))
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted = callback,
  onBeforeUnmount: (callback: () => void) => hooks.unmount = callback,
}))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (callback: () => Promise<boolean>) => hooks.leave = callback,
}))

beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(() => vi.unstubAllGlobals())

it('waits for the modal choice and cancels navigation when returning to editing', async () => {
  const guard = useUnsavedChanges(() => true)
  const leave = hooks.leave()
  expect(guard.leaveConfirmationOpen.value).toBe(true)
  expect(guard.confirmLeave()).toBe(leave)
  guard.resolveLeave(false)
  await expect(leave).resolves.toBe(false)
  expect(guard.leaveConfirmationOpen.value).toBe(false)
  const retry = hooks.leave()
  guard.resolveLeave(true)
  await expect(retry).resolves.toBe(true)
})

it('allows saved work to leave directly and blocks leaving during a write', async () => {
  let busy = false
  const guard = useUnsavedChanges(() => false, () => busy)
  await expect(hooks.leave()).resolves.toBe(true)
  busy = true
  await expect(hooks.leave()).resolves.toBe(false)
  expect(guard.leaveConfirmationOpen.value).toBe(false)
})

it('protects tab closing and removes the handler when unmounted', async () => {
  let dirty = true
  const guard = useUnsavedChanges(() => dirty)
  hooks.mounted()
  const first = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(first)
  expect(first.defaultPrevented).toBe(true)
  dirty = false
  const saved = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(saved)
  expect(saved.defaultPrevented).toBe(false)
  dirty = true
  const pending = guard.confirmLeave()
  hooks.unmount()
  await expect(pending).resolves.toBe(false)
  const unmounted = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unmounted)
  expect(unmounted.defaultPrevented).toBe(false)
})
