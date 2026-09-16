<script setup lang="ts">
import RegionInspector from '~/components/RegionInspector.vue'
import { useCardEditing, useCardOCR, useCardResources, useCardTranslation } from './cardEditingContext'

const { editor, workspace } = useCardEditing()
const {
  inspectorTab,
  activeInspectorDetailTab,
  autoMaskPreview,
  selectedExclusionId,
  cardPreviewMode,
  deferPreview,
  flushPreview,
  toggleMaskEditing,
  toggleExclusionEditing,
  removeExclusion,
  requestRegionSplit,
} = workspace
const { fonts, loadedFontIds, assets, assetImages } = useCardResources()
const { region: ocr, execution, dictionary: ocrDictionary, requestSourceIcons } = useCardOCR()
const { running: ocrRunning, progress: ocrProgress, status: ocrStatus } = execution
const {
  ocrLayout,
  ocrCorrectionCandidate,
  ocrCandidate,
  ocrConfidence,
  ocrCorrectionChanges,
  recognizeSelectedRegion,
  updateOCRCandidate,
  applyOCRCandidate,
  finishOCRCandidate,
  applyOCRCorrection,
  discardOCRCorrection,
  addOCRDictionaryEntry,
  removeOCRDictionaryEntry,
} = ocr
const {
  enabled: translationEnabled,
  running: translationRunning,
  glossary,
  reusableCount,
  requestReuse: requestTranslationReuse,
  translate: translateSelectedRegion,
} = useCardTranslation()
</script>

<template>
  <RegionInspector
    v-show="inspectorTab === 'region' || inspectorTab === 'ocr' || inspectorTab === 'text'"
    v-model:auto-mask-preview="autoMaskPreview"
    v-model:ocr-layout="ocrLayout"
    v-model:ocr-correction-candidate="ocrCorrectionCandidate"
    :region="editor.selectedRegion.value"
    :active-tab="activeInspectorDetailTab"
    :selected-exclusion-id="selectedExclusionId"
    :fonts="fonts"
    :loaded-font-ids="loadedFontIds"
    :assets="assets"
    :asset-images="assetImages"
    :ocr-running="ocrRunning"
    :ocr-progress="ocrProgress"
    :ocr-status="ocrStatus"
    :ocr-candidate="ocrCandidate"
    :ocr-confidence="ocrConfidence"
    :ocr-fill-enabled="cardPreviewMode === 'edited'"
    :ocr-correction-changes="ocrCorrectionChanges"
    :ocr-dictionary="ocrDictionary"
    :translation-enabled="translationEnabled"
    :translation-running="translationRunning"
    :glossary="glossary"
    :reusable-translation-count="reusableCount"
    @reuse-translation="requestTranslationReuse"
    @update="editor.updateRegion"
    @defer-preview="deferPreview"
    @flush-preview="flushPreview"
    @toggle-mask-editing="toggleMaskEditing"
    @clear-mask="editor.updateRegion($event, { manualMaskStrokes: [] })"
    @toggle-exclusion-editing="toggleExclusionEditing"
    @select-exclusion="selectedExclusionId = $event"
    @remove-exclusion="removeExclusion"
    @recognize-text="recognizeSelectedRegion"
    @update-ocr-candidate="updateOCRCandidate"
    @apply-ocr-candidate="applyOCRCandidate"
    @discard-ocr-candidate="finishOCRCandidate"
    @apply-ocr-correction="applyOCRCorrection"
    @discard-ocr-correction="discardOCRCorrection"
    @add-ocr-dictionary-entry="addOCRDictionaryEntry"
    @remove-ocr-dictionary-entry="removeOCRDictionaryEntry"
    @update-ocr-fill-enabled="
      cardPreviewMode = $event ? 'edited' : 'original'
    "
    @translate="translateSelectedRegion"
    @split="editor.selectedRegionId.value && requestRegionSplit(editor.selectedRegionId.value)"
    @source-icons="requestSourceIcons"
  />
</template>
