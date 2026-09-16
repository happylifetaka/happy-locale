import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { ImageAsset, SourceIcon, TextRegion } from '~/types/editor'
import { shallowRef } from 'vue'
import { sourceIconProblems } from '~/utils/source-icons'

interface SourceIconsOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegion' | 'updateRegion'>
  cardId: Readonly<Ref<string>>
  assets: Readonly<Ref<ImageAsset[]>>
  ocrRunning: Readonly<Ref<boolean>>
  onApplied: () => void
  notify: (message: string) => void
}

/** 原文アイコンの確認対象を保持し、対象が変わっていない場合だけ編集履歴へ反映する。 */
export function useSourceIcons({ editor, cardId, assets, ocrRunning, onApplied, notify }: SourceIconsOptions) {
  /** ダイアログを開いた時点のカードIDと領域の写し。確定・取消で解除する。 */
  const request = shallowRef<{ cardId: string, region: TextRegion } | null>(null)

  function open() {
    const region = editor.selectedRegion.value
    if (!region || ocrRunning.value)
      return
    request.value = { cardId: cardId.value, region: JSON.parse(JSON.stringify(region)) as TextRegion }
  }

  function apply(icons: SourceIcon[]) {
    const pending = request.value
    if (!pending)
      return
    const current = editor.project.value.regions.find(region => region.id === pending.region.id)
    if (cardId.value !== pending.cardId || JSON.stringify(current) !== JSON.stringify(pending.region)) {
      request.value = null
      notify('対象の領域が変更されました。現在の内容でアイコンを指定し直してください。')
      return
    }
    if (sourceIconProblems({ ...pending.region, sourceIcons: icons }, assets.value).length)
      return
    editor.updateRegion(pending.region.id, { sourceIcons: icons })
    request.value = null
    onApplied()
    notify('アイコンの位置を記録しました。OCRを実行して原文候補を確認してください。')
  }

  function close() {
    request.value = null
  }

  return { request, open, apply, close }
}
