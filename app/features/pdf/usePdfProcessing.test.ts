import { afterEach, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { usePdfProcessing } from './usePdfProcessing'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

function setup() {
  const scope = effectScope()
  scopes.push(scope)
  return { scope, processing: scope.run(() => usePdfProcessing())! }
}

it('keeps a cancelled operation exclusive until its work finishes', () => {
  const { processing } = setup()
  const operation = processing.begin('Analyze')!
  expect(processing.processing.value).toBe(true)
  expect(processing.label.value).toBe('Analyze')
  expect(operation.reportProgress({ current: 1, total: 4 })).toBe(true)
  processing.cancel()
  expect(operation.signal.aborted).toBe(true)
  expect(processing.begin('Export')).toBeNull()
  expect(operation.reportProgress({ current: 2, total: 4 })).toBe(false)
  expect(processing.progress.value).toEqual({ current: 1, total: 4 })
  operation.finish()
  expect(processing.processing.value).toBe(false)
  expect(processing.label.value).toBe('')
  expect(processing.progress.value).toBeNull()
  expect(processing.begin('Export')).not.toBeNull()
})

it('does not let old completion or progress overwrite the next operation', () => {
  const { processing } = setup()
  const previous = processing.begin('Analyze')!
  previous.finish()
  const next = processing.begin('Export')!
  next.reportProgress({ current: 3, total: 5 })
  previous.finish()
  expect(previous.reportProgress({ current: 1, total: 1 })).toBe(false)
  expect(processing.processing.value).toBe(true)
  expect(processing.label.value).toBe('Export')
  expect(processing.progress.value).toEqual({ current: 3, total: 5 })
  expect(next.signal.aborted).toBe(false)
})

it('aborts and clears on disposal without affecting a new editor', () => {
  const old = setup()
  const operation = old.processing.begin('Analyze')!
  operation.reportProgress({ current: 1, total: 2 })
  old.scope.stop()
  const current = setup()
  const next = current.processing.begin('Restore')!
  expect(operation.signal.aborted).toBe(true)
  expect(old.processing.processing.value).toBe(false)
  expect(old.processing.label.value).toBe('')
  expect(old.processing.progress.value).toBeNull()
  expect(old.processing.begin('Late request')).toBeNull()
  expect(operation.reportProgress({ current: 2, total: 2 })).toBe(false)
  operation.finish()
  expect(current.processing.processing.value).toBe(true)
  expect(current.processing.label.value).toBe('Restore')
  expect(next.signal.aborted).toBe(false)
})
