import { afterEach, expect, it, vi } from 'vitest'
import { useEditorDiagnostics } from './useEditorDiagnostics'

afterEach(() => vi.restoreAllMocks())

it('keeps the latest 50 entries per editor and clears only its own log', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const first = useEditorDiagnostics()
  const second = useEditorDiagnostics()
  for (let index = 0; index < 52; index++)
    first.logDiagnostic(`entry-${index}`)
  expect(first.diagnostics.value).toHaveLength(50)
  expect(first.diagnostics.value[0]?.message).toBe('entry-2')
  expect(first.diagnostics.value.at(-1)).toMatchObject({ message: 'entry-51', level: 'info', details: undefined })
  expect(warn).toHaveBeenLastCalledWith('[HappyLocale] entry-51', '')
  expect(second.diagnostics.value).toEqual([])
  second.logDiagnostic('other')
  first.clearDiagnostics()
  expect(first.diagnostics.value).toEqual([])
  expect(second.diagnostics.value).toHaveLength(1)
})

it('formats supplemental details and preserves error severity without persisting the original object', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { diagnostics, logDiagnostic } = useEditorDiagnostics()
  const details = { width: 100 }
  logDiagnostic('metadata', details)
  details.width = 200
  const error = new Error('decode failed')
  logDiagnostic('failed', error, 'error')
  const circular: { self?: unknown } = {}
  circular.self = circular
  logDiagnostic('fallback', circular)
  expect(diagnostics.value.map(entry => entry.details)).toEqual([
    '{"width":100}',
    'Error: decode failed',
    '[object Object]',
  ])
  expect(diagnostics.value[1]?.level).toBe('error')
  expect(errorLog).toHaveBeenCalledWith('[HappyLocale] failed', error)
})
