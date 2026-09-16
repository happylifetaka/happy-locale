import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { FolderProjectCard, GlossaryEntry, TextRegion } from '~/types/editor'
import type { ReusableTranslation } from '~/utils/translation-reuse'
import { computed, shallowRef } from 'vue'
import { findReusableTranslations } from '~/utils/translation-reuse'
import { statusForTranslation } from '~/utils/translation-status'

interface TranslationReuseOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegion' | 'updateRegion'>
  currentImageId: Ref<string>
  projectCards: Ref<FolderProjectCard[]>
  glossary: Ref<GlossaryEntry[]>
  setMessage: (message: string) => void
}

/** 既存訳候補を提示し、確認開始時の領域が変わっていない場合だけ履歴へ反映する。 */
export function useTranslationReuse({ editor, currentImageId, projectCards, glossary, setMessage }: TranslationReuseOptions) {
  /** 選択領域と同じ原文を持つ用語集・他領域の既存訳。 */
  const reusableTranslations = computed(() => {
    const region = editor.selectedRegion.value
    return region ? findReusableTranslations(region, currentImageId.value, projectCards.value.map(card => card.id === currentImageId.value ? { ...card, regions: editor.project.value.regions } : card), glossary.value) : []
  })
  /** 既存訳の再利用を確認する対象領域と候補一覧。 */
  const reuseRequest = shallowRef<{ cardId: string, region: TextRegion, candidates: ReusableTranslation[] } | null>(null)
  /** 選択領域に使える既存訳を再利用の確認画面へ渡す。 */
  function requestTranslationReuse() {
    const region = editor.selectedRegion.value
    if (!region || !reusableTranslations.value.length)
      return
    reuseRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)), candidates: reusableTranslations.value }
  }
  /** 確認した既存訳を対象領域へ反映する。 */
  function applyReusedTranslation(translation: string) {
    const request = reuseRequest.value
    if (!request)
      return
    const region = editor.project.value.regions.find(item => item.id === request.region.id)
    reuseRequest.value = null
    if (request.cardId !== currentImageId.value || !region || JSON.stringify(region) !== JSON.stringify(request.region)) {
      setMessage('対象が変更されたため、既存訳を反映しませんでした。候補を開き直してください。')
      return
    }
    editor.updateRegion(region.id, { translatedText: translation, translationStatus: statusForTranslation(translation) })
    setMessage('既存訳を下書きとして反映しました。')
  }
  return { reusableTranslations, reuseRequest, requestTranslationReuse, applyReusedTranslation }
}
