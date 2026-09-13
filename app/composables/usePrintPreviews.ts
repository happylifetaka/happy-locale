import type { FolderProjectCard } from '~/types/editor'
import { onBeforeUnmount, ref, shallowRef } from 'vue'

/** 印刷用画像を順番に生成し、画面終了時には生成途中・表示済み双方のURLを解放する。 */
export function usePrintPreviews(
  cards: () => readonly FolderProjectCard[],
  render: (card: FolderProjectCard, signal: AbortSignal) => Promise<Blob | null>,
) {
  /** 生成済みの印刷画像Blobと表示用URL。カードIDで参照する。 */
  const previews = shallowRef(new Map<string, { blob: Blob, url: string }>())
  /** 印刷プレビューを順番に生成しているか。 */
  const loading = ref(false)
  /** 印刷プレビュー生成に失敗した理由。 */
  const errorMessage = ref('')
  /** 印刷画面終了時にプレビュー生成へ中止を伝えるコントローラー。 */
  const controller = new AbortController()
  /** 全カードの生成完了まで表示を保留する、仮の印刷画像とURL。 */
  const pending = new Map<string, { blob: Blob, url: string }>()
  /** プレビューの一時URLを解放して一覧を空にする。 */
  function release(items: typeof pending) {
    items.forEach(item => URL.revokeObjectURL(item.url))
    items.clear()
  }
  // 画面終了時に生成を中断し、生成途中と表示済み両方のURLを解放する。
  onBeforeUnmount(() => {
    controller.abort()
    release(pending)
    release(previews.value)
  })

  /** 印刷範囲を持つカードのプレビューを順番に作る。 */
  async function preparePreviews() {
    if (loading.value || controller.signal.aborted)
      return
    loading.value = true
    errorMessage.value = ''
    try {
      for (const card of cards()) {
        if (controller.signal.aborted)
          return
        if (!card.printArea)
          continue
        const blob = await render(card, controller.signal)
        if (controller.signal.aborted)
          return
        if (blob)
          pending.set(card.id, { blob, url: URL.createObjectURL(blob) })
      }
      // 全カードの生成が完了してから表示用Mapを差し替え、途中の結果と混在させない。
      release(previews.value)
      previews.value = new Map(pending)
      pending.clear()
    }
    catch (error) {
      if (!controller.signal.aborted)
        errorMessage.value = error instanceof Error ? error.message : '印刷プレビューを作成できませんでした。'
    }
    finally {
      release(pending)
      loading.value = false
    }
  }
  return { previews, loading, errorMessage, preparePreviews }
}
