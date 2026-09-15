import type { WatchSource } from 'vue'
import { onBeforeUnmount, ref, watch } from 'vue'

/** IME入力中は描画だけを待たせ、編集対象の変更時には直ちに追従させる。 */
export function usePreviewDeferral(resetSources: WatchSource[]) {
  const previewDeferred = ref(false)
  let previewTimer: ReturnType<typeof setTimeout> | undefined

  function flushPreview() {
    clearTimeout(previewTimer)
    previewTimer = undefined
    previewDeferred.value = false
  }

  function deferPreview(composing: boolean) {
    clearTimeout(previewTimer)
    previewTimer = undefined
    previewDeferred.value = true
    if (!composing)
      previewTimer = setTimeout(flushPreview, 500)
  }

  watch(resetSources, flushPreview)
  onBeforeUnmount(() => clearTimeout(previewTimer))

  return { previewDeferred, deferPreview, flushPreview }
}
