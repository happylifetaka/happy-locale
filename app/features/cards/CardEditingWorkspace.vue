<script setup lang="ts">
import type { RegionDraft } from '~/types/editor'
import { onBeforeUnmount } from 'vue'
import CardCanvas from '~/components/CardCanvas.vue'
import EditorConfirmDialog from '~/components/EditorConfirmDialog.vue'
import EditorInspectorPanel from '~/components/EditorInspectorPanel.vue'
import RegionList from '~/components/RegionList.vue'
import RegionSplitDialog from '~/components/RegionSplitDialog.vue'
import SourceIconsDialog from '~/components/SourceIconsDialog.vue'
import { provideCardSourceIcons, useCardEditing, useCardOCR, useCardResources } from './cardEditingContext'
import CardRegionInspector from './CardRegionInspector.vue'
import { useSourceIcons } from './useSourceIcons'

defineProps<{
  visible: boolean
  hasCardList: boolean
  printArea: RegionDraft | null
}>()
const emit = defineEmits<{
  image: [file: File]
  diagnostic: [message: string, details?: unknown, level?: 'info' | 'error']
  updatePrintArea: [area: RegionDraft]
}>()
const { editor, workspace, cardId, notify } = useCardEditing()
const {
  canvasApi,
  cardZoom,
  cardPreviewMode,
  previewDeferred,
  autoMaskPreview,
  selectedExclusionId,
  inspectorTab,
  canOpenInspectorTab,
  switchInspectorTab,
  addRegion,
  updateRegionBounds,
  addMaskStroke,
  addExclusion,
  updateExclusion,
  selectRegionForEditing,
  renameRegion,
  requestRegionSplit,
  requestRegionDeletion,
  regionSplitRequest,
  applyRegionSplit,
  regionPendingDeletionConfirmation,
  cancelRegionDeletion,
  confirmRegionDeletion,
} = workspace
const { image, projectSelected, assets, assetImages, fontFamilies } = useCardResources()
const { candidates, region: ocr, execution: { running: ocrRunning } } = useCardOCR()
const { regionCandidates, selectedCandidateId, selectRegionCandidate, updateCandidateBounds } = candidates
// Canvas APIを登録した画面が解除も担当し、資源の所有者には触れない。
onBeforeUnmount(() => {
  canvasApi.value = null
})
/** 原文アイコンの確認は領域UI内で完結させ、確定後だけOCR候補を破棄する。 */
const sourceIcons = useSourceIcons({
  editor,
  cardId,
  assets,
  ocrRunning,
  notify,
  onApplied: () => {
    ocr.clearOCRCandidate()
    inspectorTab.value = 'ocr'
  },
})
const { request: sourceIconsRequest } = sourceIcons
provideCardSourceIcons(sourceIcons)
</script>

<template>
  <SourceIconsDialog
    v-if="sourceIconsRequest && image"
    :region="sourceIconsRequest.region"
    :image-url="image.src"
    :image-width="editor.project.value.imageWidth"
    :image-height="editor.project.value.imageHeight"
    :assets="assets"
    @apply="sourceIcons.apply"
    @close="sourceIcons.close"
  />

  <RegionSplitDialog
    v-if="regionSplitRequest && image"
    :region="regionSplitRequest.region"
    :image-url="image.src"
    :image-width="editor.project.value.imageWidth"
    :image-height="editor.project.value.imageHeight"
    @apply="applyRegionSplit"
    @close="regionSplitRequest = null"
  />
  <EditorConfirmDialog
    v-if="regionPendingDeletionConfirmation"
    id="region-delete"
    title="領域を削除しますか？"
    @cancel="cancelRegionDeletion"
    @confirm="confirmRegionDeletion"
  >
    「{{ regionPendingDeletionConfirmation.displayName.trim()
      || regionPendingDeletionConfirmation.regionId }}」を削除します。
    元テキスト、訳文、文字設定も削除されます。
  </EditorConfirmDialog>
  <div v-show="visible" class="editor-layout" :class="{ 'has-card-list': hasCardList }">
    <slot name="cards" />
    <CardCanvas
      ref="canvasApi"
      v-model:zoom="cardZoom"
      v-model:preview-mode="cardPreviewMode"
      :image="image"
      :project-selected="projectSelected"
      :project="editor.project.value"
      :preview-deferred="previewDeferred"
      :selected-region-id="editor.selectedRegionId.value"
      :auto-mask-preview="autoMaskPreview"
      :selected-exclusion-id="selectedExclusionId"
      :assets="assets"
      :asset-images="assetImages"
      :font-families="fontFamilies"
      :region-candidates="regionCandidates"
      :selected-candidate-id="selectedCandidateId"
      :print-area="printArea"
      :print-area-editing="inspectorTab === 'print'"
      @image="emit('image', $event)"
      @diagnostic="emit('diagnostic', $event)"
      @add-region="addRegion"
      @update-region-bounds="updateRegionBounds"
      @add-mask-stroke="addMaskStroke"
      @add-exclusion="addExclusion"
      @update-exclusion="updateExclusion"
      @select-exclusion="selectedExclusionId = $event"
      @select-region="selectRegionForEditing"
      @select-region-candidate="selectRegionCandidate"
      @update-region-candidate-bounds="updateCandidateBounds"
      @update-print-area="emit('updatePrintArea', $event)"
    />
    <EditorInspectorPanel
      :active-tab="inspectorTab"
      :can-open-tab="canOpenInspectorTab"
      :selection-label="editor.selectedRegion.value ? (editor.selectedRegion.value.displayName.trim() || editor.selectedRegion.value.regionId) : null"
      @select="switchInspectorTab"
    >
      <template #header>
        <slot name="header" />
      </template>
      <div
        v-show="inspectorTab === 'list'"
        id="inspector-panel-list"
        class="side-panel-tab-content"
        role="tabpanel"
        aria-labelledby="inspector-tab-list"
      >
        <RegionList
          :regions="editor.project.value.regions"
          :selected-id="editor.selectedRegionId.value"
          @select="selectRegionForEditing"
          @rename="renameRegion"
          @split="requestRegionSplit"
          @remove="requestRegionDeletion"
        />
        <slot name="layout-tools" />
        <p v-if="editor.project.value.regions.length === 0" class="muted">
          画像上をドラッグして最初の領域を追加してください。
        </p>
      </div>
      <slot name="candidates" />
      <CardRegionInspector />
      <slot name="print" />
      <slot name="fonts" />
    </EditorInspectorPanel>
  </div>
</template>
