import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { ExclusionArea, MaskStroke, RegionDraft, TextRegion } from '~/types/editor'
import type { SplitAxis, SplitText } from '~/utils/split-region'
import { computed, shallowRef } from 'vue'
import { transformRegionContents } from '~/utils/regions'

interface RegionEditingOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'addRegion' | 'updateRegion' | 'removeRegion' | 'splitRegion'>
  currentImageId: Ref<string>
  projectBusy: Ref<boolean>
  selectedExclusionId: Ref<string | null>
  exclusionEditing: Ref<boolean>
  switchInspectorTab: (tab: 'list' | 'region') => void
  setMessage: (message: string) => void
}

/** 領域操作と確認中の状態を管理し、文書とUndo/Redoの更新はeditorへ委ねる。 */
export function useRegionEditing({ editor, currentImageId, projectBusy, selectedExclusionId, exclusionEditing, switchInspectorTab, setMessage }: RegionEditingOptions) {
  /** 削除確認を開いた時点のカードと領域。現在の編集状態とは独立した控えを保持する。 */
  const regionDeletionRequest = shallowRef<{ cardId: string, region: TextRegion } | null>(null)
  /** ダイアログに表示する削除対象。取消・確定は専用操作から行う。 */
  const regionPendingDeletionConfirmation = computed(() => regionDeletionRequest.value?.region ?? null)

  /** 分割確認を開いた時点のカードと領域の情報。 */
  const regionSplitRequest = shallowRef<{ cardId: string, region: TextRegion } | null>(null)

  /** 領域の現在値を控えて分割確認を開く。 */
  function requestRegionSplit(id: string) {
    const region = editor.project.value.regions.find(item => item.id === id)
    if (!region || projectBusy.value)
      return
    regionSplitRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)) as TextRegion }
  }

  /** 確認した分割位置と本文を二つの編集領域へ反映する。 */
  function applyRegionSplit(axis: SplitAxis, position: number, texts: [SplitText, SplitText]) {
    const request = regionSplitRequest.value
    if (!request)
      return
    const current = editor.project.value.regions.find(item => item.id === request.region.id)
    if (request.cardId !== currentImageId.value || JSON.stringify(current) !== JSON.stringify(request.region)) {
      regionSplitRequest.value = null
      setMessage('領域が変更されたため分割を中止しました。現在の内容でやり直してください。')
      return
    }
    editor.splitRegion(request.region.id, axis, position, texts)
    regionSplitRequest.value = null
    switchInspectorTab('list')
    setMessage('領域を分割しました。原文・訳文と保護領域を確認してください。')
  }

  /** 指定範囲に新しい翻訳領域を追加する。 */
  function addRegion(bounds: RegionDraft, backgroundColor: string) {
    editor.addRegion(bounds, backgroundColor)
    switchInspectorTab('region')
  }

  /** 翻訳領域の表示名を変更する。 */
  function renameRegion(id: string, displayName: string) {
    const name = displayName.trim()
    if (!name)
      return
    editor.updateRegion(id, { displayName: name })
    setMessage(`領域名を「${name}」へ変更しました。`)
  }

  /** 領域削除の確認を開く。 */
  function requestRegionDeletion(id: string) {
    const region = editor.project.value.regions.find(region => region.id === id)
    if (!region || projectBusy.value)
      return
    regionDeletionRequest.value = { cardId: currentImageId.value, region: JSON.parse(JSON.stringify(region)) as TextRegion }
  }

  /** 領域削除の確認を閉じる。 */
  function cancelRegionDeletion() {
    regionDeletionRequest.value = null
  }

  /** 確認した翻訳領域を削除する。 */
  function confirmRegionDeletion() {
    const request = regionDeletionRequest.value
    if (!request)
      return
    const { region } = request
    const current = editor.project.value.regions.find(item => item.id === region.id)
    if (request.cardId !== currentImageId.value || JSON.stringify(current) !== JSON.stringify(region)) {
      regionDeletionRequest.value = null
      setMessage('領域が変更されたため削除を中止しました。現在の内容でやり直してください。')
      return
    }
    editor.removeRegion(region.id)
    regionDeletionRequest.value = null
    setMessage(`「${region.displayName.trim() || region.regionId}」を削除しました。`)
  }

  /** 領域と内部マスク・保護範囲の座標を合わせて変更する。 */
  function updateRegionBounds(regionId: string, bounds: RegionDraft) {
    const region = editor.project.value.regions.find(
      item => item.id === regionId,
    )
    if (!region)
      return
    editor.updateRegion(regionId, {
      ...bounds,
      ...transformRegionContents(region, bounds),
    })
  }

  /** 一筆分の手動マスクを領域へ追加する。 */
  function addMaskStroke(regionId: string, stroke: MaskStroke) {
    const region = editor.project.value.regions.find(
      item => item.id === regionId,
    )
    if (!region)
      return
    const savedStroke: MaskStroke = {
      brushSize: stroke.brushSize,
      mode: stroke.mode,
      points: stroke.points.map(point => ({ ...point })),
    }
    editor.updateRegion(regionId, {
      manualMaskStrokes: [...region.manualMaskStrokes, savedStroke],
    })
  }

  /** 原文領域の内部へ保護矩形を追加する。 */
  function addExclusion(regionId: string, bounds: RegionDraft) {
    const region = editor.project.value.regions.find(
      item => item.id === regionId,
    )
    if (!region)
      return
    const area: ExclusionArea = {
      id: crypto.randomUUID(),
      ...bounds,
    }
    editor.updateRegion(regionId, {
      exclusionAreas: [...region.exclusionAreas, area],
    })
    selectedExclusionId.value = area.id
    exclusionEditing.value = false
  }

  /** 指定した保護領域の位置と大きさを変更する。 */
  function updateExclusion(
    regionId: string,
    exclusionId: string,
    bounds: RegionDraft,
  ) {
    const region = editor.project.value.regions.find(
      item => item.id === regionId,
    )
    if (!region)
      return
    editor.updateRegion(regionId, {
      exclusionAreas: region.exclusionAreas.map(area =>
        area.id === exclusionId ? { ...area, ...bounds } : area,
      ),
    })
  }

  /** 指定した保護領域を削除する。 */
  function removeExclusion(regionId: string, exclusionId: string) {
    const region = editor.project.value.regions.find(
      item => item.id === regionId,
    )
    if (!region)
      return
    editor.updateRegion(regionId, {
      exclusionAreas: region.exclusionAreas.filter(
        area => area.id !== exclusionId,
      ),
    })
    selectedExclusionId.value = null
  }
  return { regionPendingDeletionConfirmation, regionSplitRequest, requestRegionSplit, applyRegionSplit, addRegion, renameRegion, requestRegionDeletion, cancelRegionDeletion, confirmRegionDeletion, updateRegionBounds, addMaskStroke, addExclusion, updateExclusion, removeExclusion }
}
