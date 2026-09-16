import type { Ref } from 'vue'
import type { InspectorDetailTab, InspectorTab } from '~/components/EditorInspectorPanel.vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import { computed, ref, watch } from 'vue'

interface InspectorTabsOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'selectedRegionId' | 'selectedRegion'>
  hasImage: Ref<boolean>
  hasProject: Ref<boolean>
}

/** タブの利用条件、前回の詳細タブ、領域選択時の遷移を一箇所で管理する。 */
export function useInspectorTabs({ editor, hasImage, hasProject }: InspectorTabsOptions) {
  const inspectorTab = ref<InspectorTab>('list')
  /** 一覧へ移る前などに開いていた領域の詳細タブ。 */
  const lastInspectorDetailTab = ref<InspectorDetailTab>('text')
  /** 詳細画面に戻る際に表示するタブ。 */
  const activeInspectorDetailTab = computed<InspectorDetailTab>(() =>
    inspectorTab.value === 'region'
    || inspectorTab.value === 'ocr'
    || inspectorTab.value === 'text'
      ? inspectorTab.value
      : lastInspectorDetailTab.value,
  )
  // 領域選択がなくなったら、領域が必要な詳細タブから一覧へ戻す。
  watch(
    () => editor.selectedRegionId.value,
    (id) => {
      if (!id && (inspectorTab.value === 'region' || inspectorTab.value === 'text'))
        inspectorTab.value = 'list'
    },
  )

  /** 選択領域や画像の有無からタブを開けるか判定する。 */
  function canOpenInspectorTab(tab: InspectorTab) {
    if (tab === 'list')
      return true
    if (tab === 'ocr')
      return hasImage.value
    if (tab === 'print')
      return hasProject.value && hasImage.value
    return Boolean(editor.selectedRegion.value)
  }

  /** 開けるタブへ切り替え、領域の詳細タブなら次回表示用に記憶する。 */
  function switchInspectorTab(tab: InspectorTab) {
    if (!canOpenInspectorTab(tab))
      return
    inspectorTab.value = tab
    if (tab === 'region' || tab === 'ocr' || tab === 'text')
      lastInspectorDetailTab.value = tab
  }

  /** 領域を選択し、編集に使うインスペクターを表示する。 */
  function selectRegionForEditing(id: string | null) {
    editor.selectedRegionId.value = id
    if (id)
      switchInspectorTab(lastInspectorDetailTab.value)
  }

  return { inspectorTab, activeInspectorDetailTab, canOpenInspectorTab, switchInspectorTab, selectRegionForEditing }
}
