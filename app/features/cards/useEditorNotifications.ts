import { onScopeDispose, ref } from 'vue'

/** 通知の表示と期限を画面のスコープに閉じ込め、終了後にタイマーを残さない。 */
export function useEditorNotifications() {
  const message = ref('')
  const timers = new Set<number>()
  let disposed = false

  function setMessage(value: string) {
    if (disposed)
      return
    message.value = value
    if (typeof window === 'undefined')
      return
    // 既存の「通知時から4秒後、同じ文言なら消す」という条件を維持する。
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      if (message.value === value)
        message.value = ''
    }, 4000)
    timers.add(timer)
  }

  onScopeDispose(() => {
    disposed = true
    for (const timer of timers)
      window.clearTimeout(timer)
    timers.clear()
  })

  return { message, setMessage }
}
