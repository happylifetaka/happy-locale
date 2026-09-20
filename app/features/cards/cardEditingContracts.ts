import type { Ref } from 'vue'
import type { InspectorDetailTab, InspectorTab } from '~/components/EditorInspectorPanel.vue'
import type { OCRCorrectionChange } from '~/services/ocr/correction-types'
import type { OCRLayout, RegionCandidate } from '~/services/ocr/types'
import type { AssetCreationDraft, CardProject, FontReference, GlossaryEntry, ImageAsset, MaskStroke, OCRDictionaryEntry, RegionDraft, TextRegion } from '~/types/editor'
import type { MergeOptions } from '~/utils/merge-regions'
import type { SplitAxis, SplitText } from '~/utils/split-region'

export interface CardCanvasApi {
  exportPng: () => Promise<Blob | null>
  exportJpeg: () => Promise<Blob | null>
  backgroundColorForBounds: (bounds: RegionDraft) => string
}

/** CanvasとInspectorが使う操作だけを列挙する。実装へのAPI追加で公開範囲を広げない。 */
export interface CardWorkspaceUI {
  canvasApi: Ref<CardCanvasApi | null>
  cardZoom: Ref<number>
  cardPreviewMode: Ref<'edited' | 'original'>
  autoMaskPreview: Ref<boolean>
  selectedExclusionId: Ref<string | null>
  inspectorTab: Ref<InspectorTab>
  activeInspectorDetailTab: Readonly<Ref<InspectorDetailTab>>
  canOpenInspectorTab: (tab: InspectorTab) => boolean
  switchInspectorTab: (tab: InspectorTab) => void
  selectRegionForEditing: (id: string | null) => void
  previewDeferred: Readonly<Ref<boolean>>
  deferPreview: (composing: boolean) => void
  flushPreview: () => void
  toggleMaskEditing: () => void
  toggleExclusionEditing: () => void
  regionSplitRequest: Ref<{ cardId: string, region: TextRegion } | null>
  regionMergeRequest: Ref<{ cardId: string, baseId: string, regions: TextRegion[] } | null>
  regionPendingDeletionConfirmation: Readonly<Ref<TextRegion | null>>
  requestRegionSplit: (id: string) => void
  applyRegionSplit: (axis: SplitAxis, position: number, texts: [SplitText, SplitText]) => void
  requestRegionMerge: (id: string) => void
  applyRegionMerge: (ids: string[], options: MergeOptions) => void
  requestRegionDeletion: (id: string) => void
  cancelRegionDeletion: () => void
  confirmRegionDeletion: () => void
  addRegion: (bounds: RegionDraft, backgroundColor: string) => void
  renameRegion: (id: string, displayName: string) => void
  updateRegionBounds: (regionId: string, bounds: RegionDraft) => void
  addMaskStroke: (regionId: string, stroke: MaskStroke) => void
  addExclusion: (regionId: string, bounds: RegionDraft) => void
  updateExclusion: (regionId: string, exclusionId: string, bounds: RegionDraft) => void
  removeExclusion: (regionId: string, exclusionId: string) => void
}

/** 保存・カード切替・履歴初期化は子画面へ公開しない。 */
export interface CardEditingContext {
  cardId: Readonly<Ref<string>>
  notify: (message: string) => void
  editor: {
    project: Readonly<Ref<CardProject>>
    selectedRegion: Readonly<Ref<TextRegion | null>>
    selectedRegionId: Readonly<Ref<string | null>>
    updateRegion: (id: string, patch: Partial<TextRegion>) => void
  }
  workspace: CardWorkspaceUI
}

/** runtimeが所有する描画資源への参照。解放・保存は所有元に残す。 */
export interface CardResourcesContext {
  createSourceIconAsset: (draft: AssetCreationDraft, source: HTMLImageElement, sourceImageId: string, isCurrent: () => boolean) => Promise<ImageAsset | null>
  image: Readonly<Ref<HTMLImageElement | null>>
  projectSelected: Readonly<Ref<boolean>>
  assets: Readonly<Ref<ImageAsset[]>>
  assetImages: Readonly<Ref<ReadonlyMap<string, CanvasImageSource>>>
  fontFamilies: Readonly<Ref<ReadonlyMap<string, string>>>
  fonts: Readonly<Ref<FontReference[]>>
  loadedFontIds: Readonly<Ref<ReadonlySet<string>>>
}

export interface CardOCRContext {
  region: {
    ocrLayout: Ref<OCRLayout>
    ocrCandidate: Readonly<Ref<string>>
    ocrConfidence: Readonly<Ref<number | null>>
    ocrCorrectionCandidate: Ref<string>
    ocrCorrectionChanges: Readonly<Ref<OCRCorrectionChange[]>>
    clearOCRCandidate: () => void
    updateOCRCandidate: (text: string) => void
    applyOCRCorrection: () => void
    discardOCRCorrection: () => void
    addOCRDictionaryEntry: (source: string, replacement: string) => Promise<void>
    removeOCRDictionaryEntry: (id: string) => void
    finishOCRCandidate: () => void
    recognizeSelectedRegion: () => Promise<void>
    applyOCRCandidate: () => void
  }
  execution: {
    running: Readonly<Ref<boolean>>
    progress: Readonly<Ref<number | null>>
    status: Readonly<Ref<string>>
  }
  dictionary: Readonly<Ref<OCRDictionaryEntry[]>>
  candidates: {
    regionCandidates: Readonly<Ref<RegionCandidate[]>>
    selectedCandidateId: Readonly<Ref<string | null>>
    selectRegionCandidate: (id: string | null) => void
    updateCandidateBounds: (id: string, bounds: RegionDraft) => void
  }
}

export interface CardTranslationContext {
  enabled: Readonly<Ref<boolean>>
  running: Readonly<Ref<boolean>>
  glossary: Readonly<Ref<GlossaryEntry[]>>
  reusableCount: Readonly<Ref<number>>
  requestReuse: () => void
  translate: () => void
}

/** 確認対象と適用はWorkspaceで所有し、Inspectorには開く操作だけを渡す。 */
export interface CardSourceIconsContext {
  open: () => void
}
