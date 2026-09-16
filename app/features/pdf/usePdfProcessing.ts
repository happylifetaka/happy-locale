import type { PdfProgress } from '~/services/pdf'
import { computed, onScopeDispose, readonly, ref, shallowRef } from 'vue'

/** PDFの解析・復元・書き出しを一度に一つ実行し、進捗と中止要求の寿命を管理する。 */
export function usePdfProcessing() {
  /** 実行中の要求。中止後も処理が完了するまでは次の開始を許可しない。 */
  const active = shallowRef<AbortController | null>(null)
  /** 現在の操作の表示名。 */
  const label = ref('')
  /** 現在の要求から届いたページ単位の進捗。 */
  const progress = shallowRef<PdfProgress | null>(null)
  /** 画面終了後の新しい要求を拒否する。 */
  let disposed = false

  function clear() {
    active.value = null
    label.value = ''
    progress.value = null
  }

  function cancel() {
    active.value?.abort()
  }

  onScopeDispose(() => {
    disposed = true
    cancel()
    clear()
  })

  /** 所有者は返された要求をtry/finallyで完了させ、待機後にsignalで中止を確認する。 */
  function begin(description: string) {
    if (disposed || active.value)
      return null
    const controller = new AbortController()
    active.value = controller
    label.value = description
    progress.value = null
    return {
      signal: controller.signal,
      /** 古い要求・中止後の通知は採用しない。通知文の更新可否も返す。 */
      reportProgress(value: PdfProgress) {
        if (active.value !== controller || controller.signal.aborted)
          return false
        progress.value = { ...value }
        return true
      },
      finish() {
        if (active.value === controller)
          clear()
      },
    }
  }

  return {
    processing: computed(() => active.value !== null),
    label: readonly(label),
    progress: readonly(progress),
    begin,
    cancel,
  }
}
