import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { RegionDraft } from '~/types/editor'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useInspectorTabs } from '~/composables/useInspectorTabs'
import { usePreviewDeferral } from '~/composables/usePreviewDeferral'
import { useRegionEditing } from '~/composables/useRegionEditing'
import { useEditorToolsStore } from '~/stores/editor-tools'

export interface CardCanvasApi {
  exportPng: () => Promise<Blob | null>
  exportJpeg: () => Promise<Blob | null>
  backgroundColorForBounds: (bounds: RegionDraft) => string
}

interface CardWorkspaceOptions {
  editor: ReturnType<typeof useCardEditor>
  image: Ref<HTMLImageElement | null>
  hasProject: Ref<boolean>
  currentImageId: Ref<string>
  currentView: Ref<'card' | 'assets' | 'print'>
  projectBusy: Ref<boolean>
  ocrRunning: Ref<boolean>
  assetEditing: Ref<boolean>
  setMessage: (message: string) => void
}

/** カード画面の状態と領域操作を所有する。エディター全体で一度だけ生成し、画面往復でも保持する。 */
export function useCardWorkspace({ editor, image, hasProject, currentImageId, currentView, projectBusy, ocrRunning, assetEditing, setMessage }: CardWorkspaceOptions) {
  /** Canvasの画像書き出し・背景色取得を全体操作へ公開する参照。未マウント時はnull。 */
  const canvasApi = ref<CardCanvasApi | null>(null)
  /** 自動補修で推定した消去範囲を重ねて表示するか。画面往復でも保持する。 */
  const autoMaskPreview = ref(false)
  /** 選択中の保護領域ID。カード・翻訳領域の切替や対象の削除で解除する。 */
  const selectedExclusionId = ref<string | null>(null)
  /** カードCanvasの表示倍率。100が等倍で、アセット画面の倍率とは独立して保持する。 */
  const cardZoom = ref(50)
  /** 編集結果と元画像の表示切替。画面往復で保持し、OCRの確認操作からも変更する。 */
  const cardPreviewMode = ref<'edited' | 'original'>('edited')
  /** CanvasとInspectorが共有するブラシ設定・編集モード。エディター終了時に初期化する。 */
  const editorTools = useEditorToolsStore()
  const {
    /** 選択領域の手動マスクを描画中か。保護領域・アセットの編集とは排他的に扱う。 */
    maskEditing,
    /** 選択領域内に保護領域を作成中か。領域選択の変更や作成完了で解除する。 */
    exclusionEditing,
  } = storeToRefs(editorTools)
  /** タブの利用条件、前回の詳細タブ、領域選択に伴うタブ遷移を管理する窓口。 */
  const tabs = useInspectorTabs({ editor, hasImage: computed(() => Boolean(image.value)), hasProject })
  /** IME入力中の描画延期と、選択・画面・画像変更時の待機解除を管理する窓口。 */
  const preview = usePreviewDeferral([editor.selectedRegionId, currentView, tabs.inspectorTab, image])
  /** 領域の追加・分割・削除確認・マスク・保護領域操作を既存の編集履歴へつなぐ窓口。 */
  const regions = useRegionEditing({ editor, currentImageId, projectBusy, selectedExclusionId, exclusionEditing, switchInspectorTab: tabs.switchInspectorTab, setMessage })

  watch(ocrRunning, (running) => {
    if (running)
      tabs.switchInspectorTab('ocr')
  })
  watch(maskEditing, (editing) => {
    if (editing)
      tabs.switchInspectorTab('region')
  })
  watch(() => editor.selectedRegion.value?.backgroundMode, (mode) => {
    if (mode !== 'manual')
      maskEditing.value = false
  })
  watch(editor.selectedRegionId, () => {
    selectedExclusionId.value = null
    exclusionEditing.value = false
  })
  watch(() => editor.selectedRegion.value?.exclusionAreas, (areas) => {
    if (selectedExclusionId.value && !areas?.some(area => area.id === selectedExclusionId.value))
      selectedExclusionId.value = null
  }, { deep: true })

  function toggleMaskEditing() {
    editorTools.toggleMaskEditing()
    if (maskEditing.value)
      assetEditing.value = false
  }

  function toggleExclusionEditing() {
    editorTools.toggleExclusionEditing()
    if (exclusionEditing.value)
      assetEditing.value = false
  }

  /** カード切替後の選択解除。ツールの太さ・ブラシ設定は保持する。 */
  function resetCardSelection() {
    editorTools.stopEditing()
    selectedExclusionId.value = null
  }

  onBeforeUnmount(() => {
    editorTools.$reset()
  })

  return {
    ...tabs,
    ...preview,
    ...regions,
    canvasApi,
    autoMaskPreview,
    selectedExclusionId,
    cardZoom,
    cardPreviewMode,
    maskEditing,
    exclusionEditing,
    toggleMaskEditing,
    toggleExclusionEditing,
    stopEditing: editorTools.stopEditing,
    resetCardSelection,
  }
}
