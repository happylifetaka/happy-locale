import type { Ref } from 'vue'
import { computed, shallowRef } from 'vue'

/** エディター単位の処理中判定。各機能が所有する状態を読み取り、複製せず集約する。 */
export function useProjectActivity() {
  /** setup中に一度登録する、同じエディター寿命の処理状態。更新は各機能が担当する。 */
  const sources = shallowRef<Readonly<Ref<boolean>>[]>([])
  const busy = computed(() => sources.value.some(source => source.value))

  function track(source: Readonly<Ref<boolean>>) {
    sources.value = [...sources.value, source]
  }

  return { busy, track }
}

export type ProjectActivity = ReturnType<typeof useProjectActivity>
