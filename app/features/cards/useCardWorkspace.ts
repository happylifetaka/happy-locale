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
  const canvasApi = ref<CardCanvasApi | null>(null)
  const autoMaskPreview = ref(false)
  const selectedExclusionId = ref<string | null>(null)
  const cardZoom = ref(50)
  const cardPreviewMode = ref<'edited' | 'original'>('edited')
  const editorTools = useEditorToolsStore()
  const { maskEditing, exclusionEditing } = storeToRefs(editorTools)
  const tabs = useInspectorTabs({ editor, hasImage: computed(() => Boolean(image.value)), hasProject })
  const preview = usePreviewDeferral([editor.selectedRegionId, currentView, tabs.inspectorTab, image])
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
    canvasApi.value = null
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
