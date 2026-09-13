import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

/** アプリ内遷移は独自ダイアログ、タブ終了はブラウザ標準の確認で未保存編集を保護する。 */
export function useUnsavedChanges(isDirty: () => boolean, isBusy: () => boolean = () => false) {
  /** 未保存の編集を破棄して離脱するか確認しているか。 */
  const leaveConfirmationOpen = ref(false)
  /** 確認画面の回答を共有し、重複ダイアログを避けるための待機Promise。 */
  let pending: Promise<boolean> | null = null
  /** 待機中の離脱要求へ確認結果を返す関数。 */
  let resolvePending: ((leave: boolean) => void) | null = null

  /** 離脱確認の回答を待機中の遷移へ返してダイアログを閉じる。 */
  function resolveLeave(leave: boolean) {
    leaveConfirmationOpen.value = false
    resolvePending?.(leave)
    resolvePending = null
    pending = null
  }

  /** 連続した離脱要求は同じ回答を待つ。処理中は遷移せず、確認ダイアログも重ねない。 */
  function confirmLeave(): Promise<boolean> {
    if (isBusy())
      return Promise.resolve(false)
    if (!isDirty())
      return Promise.resolve(true)
    if (!pending) {
      leaveConfirmationOpen.value = true
      pending = new Promise(resolve => resolvePending = resolve)
    }
    return pending
  }

  /** 未保存または処理中の場合にブラウザ標準の離脱確認を要求する。 */
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!isDirty() && !isBusy())
      return
    event.preventDefault()
    event.returnValue = ''
  }

  // アプリ内のページ離脱前に、未保存の編集を確認する。
  onBeforeRouteLeave(() => confirmLeave())
  // タブ終了や再読み込みに備えてブラウザ標準の離脱確認を登録する。
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  // 終了時に監視を外し、残っている離脱確認を否定で解決する。
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnload)
    resolveLeave(false)
  })

  return { leaveConfirmationOpen, confirmLeave, resolveLeave }
}
