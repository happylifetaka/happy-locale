import type { DiagnosticEntry } from '~/types/diagnostics'
import { ref } from 'vue'

function diagnosticDetails(value: unknown): string | undefined {
  if (value === undefined)
    return undefined
  if (value instanceof Error)
    return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

/** 各エディターの直近50件を保持する。永続プロジェクトや別画面とは共有しない。 */
export function useEditorDiagnostics() {
  const diagnostics = ref<DiagnosticEntry[]>([])

  function logDiagnostic(message: string, details?: unknown, level: 'info' | 'error' = 'info') {
    diagnostics.value = [...diagnostics.value.slice(-49), {
      time: new Date().toLocaleTimeString('ja-JP'),
      message,
      details: diagnosticDetails(details),
      level,
    }]
    const logger = level === 'error' ? console.error : console.warn
    logger(`[HappyLocale] ${message}`, details ?? '')
  }

  function clearDiagnostics() {
    diagnostics.value = []
  }

  return { diagnostics, logDiagnostic, clearDiagnostics }
}
