import type { Ref } from 'vue'
import type { Point, ResizeHandle } from './geometry'
import type { CanvasDrafts } from './renderer'
import type { CardProject, ExclusionArea, MaskStroke, RegionDraft, TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { printAreaPointerCompletion, usablePrintArea } from '~/utils/print-area'
import { changedBounds, resizeHandleAtPoint as geometryResizeHandleAtPoint, imagePoint, lastBoundsAtPoint, normalizedBounds, pointInsideBounds, relativePoint, roundedBounds } from './geometry'

export interface CanvasInteractionInput {
  image: HTMLImageElement | null
  project: CardProject
  selectedRegionId: string | null
  selectedExclusionId: string | null
  zoom: number
  regionCandidates: RegionCandidate[]
  selectedCandidateId: string | null
  printArea: RegionDraft | null
  printAreaEditing: boolean
}

export interface CanvasInteractionTools {
  maskEditing: boolean
  maskBrushSize: number
  maskBrushMode: 'paint' | 'erase'
  exclusionEditing: boolean
}

export interface CanvasInteractionActions {
  addRegion: (bounds: RegionDraft, backgroundColor: string) => void
  updateRegionBounds: (regionId: string, bounds: RegionDraft) => void
  selectRegion: (id: string | null) => void
  addMaskStroke: (regionId: string, stroke: MaskStroke) => void
  addExclusion: (regionId: string, bounds: RegionDraft) => void
  updateExclusion: (regionId: string, exclusionId: string, bounds: RegionDraft) => void
  selectExclusion: (id: string | null) => void
  selectRegionCandidate: (id: string | null) => void
  updateRegionCandidateBounds: (id: string, bounds: RegionDraft) => void
  updatePrintArea: (bounds: RegionDraft) => void
}

/** 編集中の仮状態を所有し、確定操作だけを呼出元へ通知する。描画・Store・履歴は所有しない。 */
export function useCanvasInteractions(
  props: CanvasInteractionInput,
  canvas: Ref<HTMLCanvasElement | null>,
  editorTools: CanvasInteractionTools,
  actions: CanvasInteractionActions,
  colorFromOriginalImage: (bounds: RegionDraft) => string,
) {
  /** ドラッグ開始位置。元画像の画素座標。 */
  const dragStart = ref<{ x: number, y: number } | null>(null)
  /** 作成中の翻訳領域の矩形。元画像の画素座標。 */
  const draft = ref<RegionDraft | null>(null)
  /** カード上で描いている途中の消去・復元マスク。 */
  const draftMaskStroke = ref<MaskStroke | null>(null)
  /** どのモードでも同時に一つのポインターだけを受け付ける。 */
  let activePointerId: number | null = null
  let captureElement: HTMLCanvasElement | null = null
  let disposed = false
  let target: {
    image: HTMLImageElement | null
    project: CardProject
    regionId: string | null
    candidates: RegionCandidate[]
    printArea: RegionDraft | null
    printAreaEditing: boolean
    maskEditing: boolean
    exclusionEditing: boolean
    zoom: number
  } | null = null
  interface ExclusionInteraction {
    kind: 'create' | 'move' | 'resize'
    start: { x: number, y: number }
    original?: ExclusionArea
    handle?: ResizeHandle
  }
  /** 保護領域の移動・リサイズ開始時の状態。 */
  const exclusionInteraction = ref<ExclusionInteraction | null>(null)
  /** 操作中の保護領域の仮の矩形。 */
  const draftExclusion = ref<RegionDraft | null>(null)
  interface RegionInteraction {
    kind: 'move' | 'resize'
    start: { x: number, y: number }
    original: RegionDraft
    handle?: ResizeHandle
  }
  /** 翻訳領域の移動・リサイズ開始時の状態。 */
  const regionInteraction = ref<RegionInteraction | null>(null)
  /** 操作中の翻訳領域の仮の矩形。 */
  const draftRegion = ref<RegionDraft | null>(null)
  interface CandidateInteraction {
    kind: 'move' | 'resize'
    id: string
    start: { x: number, y: number }
    original: RegionDraft
    handle?: ResizeHandle
  }
  /** OCR候補の移動・リサイズ開始時の状態。 */
  const candidateInteraction = ref<CandidateInteraction | null>(null)
  /** 操作中のOCR候補の仮の矩形。 */
  const draftCandidate = ref<RegionDraft | null>(null)
  /** 印刷範囲の作成・移動・リサイズ開始時の状態。 */
  const printAreaInteraction = ref<RegionInteraction | null>(null)
  /** 操作中の印刷範囲の仮の矩形。 */
  const draftPrintArea = ref<RegionDraft | null>(null)

  /** 表示倍率の影響を取り除き、ポインター位置を元画像の画素座標へ変換する。 */
  function pointFromEvent(event: PointerEvent) {
    const element = canvas.value!
    return imagePoint(event, element.getBoundingClientRect(), element)
  }

  /** 現在選択されている翻訳領域を取得する。 */
  function selectedRegion() {
    return props.project.regions.find(
      region => region.id === props.selectedRegionId,
    )
  }

  /** ポインター位置にある保護領域を探す。 */
  function exclusionAtPoint(point: Point) {
    const region = selectedRegion()
    return region ? lastBoundsAtPoint(region.exclusionAreas, relativePoint(point, region)) ?? null : null
  }

  /** ポインターが触れている矩形のリサイズハンドルを判定する。 */
  function resizeHandleAtPoint(point: Point, area: ExclusionArea, region: TextRegion): ResizeHandle | null {
    return geometryResizeHandleAtPoint(relativePoint(point, region), area, props.zoom)
  }

  /** 翻訳領域のどのリサイズハンドルを操作するか判定する。 */
  function regionResizeHandleAtPoint(point: Point, region: RegionDraft): ResizeHandle | null {
    return geometryResizeHandleAtPoint(point, region, props.zoom)
  }

  /** OCR候補のどのリサイズハンドルを操作するか判定する。 */
  function candidateResizeHandleAtPoint(point: Point, candidate: RegionDraft): ResizeHandle | null {
    return geometryResizeHandleAtPoint(point, candidate, props.zoom, true)
  }

  /** 印刷範囲の変更を親コンポーネントへ通知する。 */
  function emitPrintArea(bounds: RegionDraft) {
    actions.updatePrintArea(roundedBounds(bounds))
  }

  /** 印刷範囲のドラッグに使った一時状態を解除する。 */
  function clearPrintAreaInteraction() {
    printAreaInteraction.value = null
    draftPrintArea.value = null
  }

  /** 印刷範囲・候補・マスク・保護領域などのモードから、このドラッグで扱う対象を決める。 */
  function startInteraction(event: PointerEvent) {
    const candidatePoint = pointFromEvent(event)
    if (props.printAreaEditing) {
      const pendingClickSelection = printAreaInteraction.value
      if (
        pendingClickSelection
        && pendingClickSelection.original.width === 0
        && pendingClickSelection.original.height === 0
      ) {
        const bounds = normalizedBounds(
          pendingClickSelection.start,
          candidatePoint,
        )
        draftPrintArea.value = bounds
        if (usablePrintArea(bounds)) {
          emitPrintArea(bounds)
          clearPrintAreaInteraction()
        }
        return
      }
      const area = props.printArea
      const handle = area ? regionResizeHandleAtPoint(candidatePoint, area) : null
      if (area && (handle || pointInsideBounds(candidatePoint, area))) {
        printAreaInteraction.value = {
          kind: handle ? 'resize' : 'move',
          start: candidatePoint,
          original: { ...area },
          handle: handle ?? undefined,
        }
        draftPrintArea.value = { ...area }
      }
      else {
        printAreaInteraction.value = {
          kind: 'resize',
          start: candidatePoint,
          original: {
            x: candidatePoint.x,
            y: candidatePoint.y,
            width: 0,
            height: 0,
          },
          handle: 'se',
        }
        draftPrintArea.value = { ...printAreaInteraction.value.original }
      }
      return
    }
    if (props.regionCandidates.length > 0) {
      const selectedCandidate = props.regionCandidates.find(
        item => item.id === props.selectedCandidateId,
      )
      const handle = selectedCandidate
        ? candidateResizeHandleAtPoint(candidatePoint, selectedCandidate)
        : null
      const candidate = handle
        ? selectedCandidate!
        : props.regionCandidates.findLast(item =>
            pointInsideBounds(candidatePoint, item),
          )
      if (!candidate) {
        actions.selectRegionCandidate(null)
        return
      }
      actions.selectRegionCandidate(candidate.id)
      candidateInteraction.value = {
        kind: handle ? 'resize' : 'move',
        id: candidate.id,
        start: candidatePoint,
        original: {
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height,
        },
        handle: handle ?? undefined,
      }
      draftCandidate.value = { ...candidateInteraction.value.original }
      return
    }
    const selected = selectedRegion()
    if (editorTools.maskEditing && selected?.backgroundMode === 'manual') {
      const point = pointFromEvent(event)
      if (!pointInsideBounds(point, selected))
        return
      draftMaskStroke.value = {
        brushSize: editorTools.maskBrushSize,
        mode: editorTools.maskBrushMode,
        points: [
          {
            x: Math.max(0, Math.min(selected.width, point.x - selected.x)),
            y: Math.max(0, Math.min(selected.height, point.y - selected.y)),
          },
        ],
      }
      return
    }
    const point = pointFromEvent(event)
    if (editorTools.exclusionEditing) {
      // 保護領域の追加中は通常領域の作成へフォールスルーさせない。
      // 選択領域の外から始めたドラッグは何もせず終了する。
      if (!selected || !pointInsideBounds(point, selected))
        return
      const local = relativePoint(point, selected)
      actions.selectExclusion(null)
      exclusionInteraction.value = { kind: 'create', start: local }
      draftExclusion.value = { x: local.x, y: local.y, width: 0, height: 0 }
      return
    }
    if (selected) {
      const selectedArea = selected.exclusionAreas.find(
        area => area.id === props.selectedExclusionId,
      )
      const handle = selectedArea
        ? resizeHandleAtPoint(point, selectedArea, selected)
        : null
      const hitArea = handle ? selectedArea! : exclusionAtPoint(point)
      if (hitArea) {
        const local = relativePoint(point, selected)
        actions.selectExclusion(hitArea.id)
        exclusionInteraction.value = {
          kind: handle ? 'resize' : 'move',
          start: local,
          original: { ...hitArea },
          handle: handle ?? undefined,
        }
        draftExclusion.value = { ...hitArea }
        return
      }
      const regionHandle = regionResizeHandleAtPoint(point, selected)
      if (regionHandle || pointInsideBounds(point, selected)) {
        actions.selectExclusion(null)
        regionInteraction.value = {
          kind: regionHandle ? 'resize' : 'move',
          start: point,
          original: {
            x: selected.x,
            y: selected.y,
            width: selected.width,
            height: selected.height,
          },
          handle: regionHandle ?? undefined,
        }
        draftRegion.value = { ...regionInteraction.value.original }
        return
      }
    }
    dragStart.value = point
    draft.value = null
  }

  /** ドラッグ量から保護領域の変更後の矩形を計算する。 */
  function resizedExclusion(interaction: ExclusionInteraction, point: Point, region: TextRegion): RegionDraft {
    return changedBounds({ ...interaction, kind: interaction.kind === 'move' ? 'move' : 'resize', original: interaction.original! }, point, region)
  }

  /** 開始時の領域と現在のポインターから移動・リサイズ後の範囲を求める。 */
  function changedRegionBounds(interaction: RegionInteraction, point: Point): RegionDraft {
    return changedBounds(interaction, point, { width: props.project.imageWidth, height: props.project.imageHeight })
  }

  /** 候補の開始位置から変更後の矩形を計算する。 */
  function changedCandidateBounds(
    interaction: CandidateInteraction,
    point: { x: number, y: number },
  ): RegionDraft {
    return changedRegionBounds(interaction, point)
  }

  /** 描画中のマスクを一筆分の確定操作として親へ渡す。 */
  function commitDraftMaskStroke() {
    if (draftMaskStroke.value && props.selectedRegionId) {
      actions.addMaskStroke(props.selectedRegionId, draftMaskStroke.value)
    }
    draftMaskStroke.value = null
  }

  /** 現在の編集モードに応じてドラッグ中の範囲やマスクを更新する。 */
  function updateDraft(event: PointerEvent) {
    if (printAreaInteraction.value) {
      const interaction = printAreaInteraction.value
      draftPrintArea.value = interaction.original.width === 0
        && interaction.original.height === 0
        ? normalizedBounds(interaction.start, pointFromEvent(event))
        : changedRegionBounds(interaction, pointFromEvent(event))
      return
    }
    if (candidateInteraction.value) {
      draftCandidate.value = changedCandidateBounds(
        candidateInteraction.value,
        pointFromEvent(event),
      )
      return
    }
    if (draftMaskStroke.value && event.pointerId === activePointerId) {
      const selected = props.project.regions.find(
        region => region.id === props.selectedRegionId,
      )
      if (!selected)
        return
      const point = pointFromEvent(event)
      draftMaskStroke.value.points.push({
        x: Math.max(0, Math.min(selected.width, point.x - selected.x)),
        y: Math.max(0, Math.min(selected.height, point.y - selected.y)),
      })
      draftMaskStroke.value = { ...draftMaskStroke.value }
      return
    }
    if (exclusionInteraction.value) {
      const selected = selectedRegion()
      if (!selected)
        return
      const point = relativePoint(pointFromEvent(event), selected)
      if (exclusionInteraction.value.kind === 'create') {
        draftExclusion.value = normalizedBounds(
          exclusionInteraction.value.start,
          point,
        )
      }
      else {
        draftExclusion.value = resizedExclusion(
          exclusionInteraction.value,
          point,
          selected,
        )
      }
      return
    }
    if (regionInteraction.value) {
      draftRegion.value = changedRegionBounds(
        regionInteraction.value,
        pointFromEvent(event),
      )
      return
    }
    if (!dragStart.value)
      return
    draft.value = normalizedBounds(dragStart.value, pointFromEvent(event))
  }

  /** ポインター位置にある翻訳領域を探す。 */
  function findRegion(point: Point) {
    return lastBoundsAtPoint(props.project.regions, point)
  }

  /** 操作対象ごとの確定条件を判定し、確定した範囲やマスクを親へ通知する。 */
  function commitInteraction(event: PointerEvent) {
    if (printAreaInteraction.value) {
      const bounds = draftPrintArea.value
      const completion = printAreaPointerCompletion(
        printAreaInteraction.value.original,
        bounds,
      )
      if (completion === 'commit' && bounds) {
        emitPrintArea(bounds)
        clearPrintAreaInteraction()
      }
      else if (completion === 'cancel') {
        clearPrintAreaInteraction()
      }
      return
    }
    if (candidateInteraction.value) {
      const bounds = draftCandidate.value
      const interaction = candidateInteraction.value
      if (bounds) {
        const rounded = roundedBounds(bounds)
        if (
          rounded.x !== interaction.original.x
          || rounded.y !== interaction.original.y
          || rounded.width !== interaction.original.width
          || rounded.height !== interaction.original.height
        ) {
          actions.updateRegionCandidateBounds(interaction.id, rounded)
        }
      }
      candidateInteraction.value = null
      draftCandidate.value = null
      return
    }
    if (draftMaskStroke.value && event.pointerId === activePointerId) {
      commitDraftMaskStroke()
      return
    }
    if (exclusionInteraction.value) {
      const selected = selectedRegion()
      const bounds = draftExclusion.value
      if (selected && bounds && bounds.width >= 5 && bounds.height >= 5) {
        const rounded = roundedBounds(bounds)
        if (exclusionInteraction.value.kind === 'create') {
          actions.addExclusion(selected.id, rounded)
        }
        else if (exclusionInteraction.value.original) {
          actions.updateExclusion(selected.id, exclusionInteraction.value.original.id, rounded)
        }
      }
      exclusionInteraction.value = null
      draftExclusion.value = null
      return
    }
    if (regionInteraction.value && props.selectedRegionId) {
      const bounds = draftRegion.value
      const original = regionInteraction.value.original
      if (bounds) {
        const rounded = roundedBounds(bounds)
        if (
          rounded.x !== original.x
          || rounded.y !== original.y
          || rounded.width !== original.width
          || rounded.height !== original.height
        ) {
          actions.updateRegionBounds(props.selectedRegionId, rounded)
        }
      }
      regionInteraction.value = null
      draftRegion.value = null
      return
    }
    if (!dragStart.value)
      return
    const point = pointFromEvent(event)
    const bounds = normalizedBounds(dragStart.value, point)
    if (bounds.width >= 5 && bounds.height >= 5) {
      actions.addRegion(bounds, colorFromOriginalImage(bounds))
    }
    else {
      actions.selectRegion(findRegion(point)?.id ?? null)
    }
    dragStart.value = null
    draft.value = null
  }

  /** 中断されたドラッグの仮状態を捨て、途中の範囲やマスクが確定されるのを防ぐ。 */
  function clearDrafts() {
    dragStart.value = null
    draft.value = null
    draftMaskStroke.value = null
    exclusionInteraction.value = null
    draftExclusion.value = null
    regionInteraction.value = null
    draftRegion.value = null
    candidateInteraction.value = null
    draftCandidate.value = null
    printAreaInteraction.value = null
    draftPrintArea.value = null
  }

  function targetIsCurrent() {
    return !disposed && target !== null
      && target.image === props.image && target.project === props.project
      && target.regionId === props.selectedRegionId && target.candidates === props.regionCandidates
      && (!candidateInteraction.value || props.selectedCandidateId === candidateInteraction.value.id)
      && (!exclusionInteraction.value?.original || props.selectedExclusionId === exclusionInteraction.value.original.id)
      && target.printAreaEditing === props.printAreaEditing
      && (!target.printAreaEditing || target.printArea === props.printArea)
      && target.maskEditing === editorTools.maskEditing && target.exclusionEditing === editorTools.exclusionEditing
      && target.zoom === props.zoom
  }

  /** 解除に伴うlostpointercaptureが再確定を起こさないよう、所有を先に解く。 */
  function releasePointer() {
    const id = activePointerId
    const element = captureElement
    activePointerId = null
    captureElement = null
    if (id !== null && element?.hasPointerCapture?.(id))
      element.releasePointerCapture(id)
  }

  function cancelInteraction() {
    clearDrafts()
    target = null
    releasePointer()
  }

  function hasInteraction() {
    return dragStart.value || regionInteraction.value || candidateInteraction.value
      || exclusionInteraction.value || draftMaskStroke.value || printAreaInteraction.value
  }

  function onPointerDown(event: PointerEvent) {
    if (disposed || !props.image || !canvas.value || event.button !== 0)
      return
    if (target && !targetIsCurrent())
      cancelInteraction()
    if (activePointerId !== null)
      return
    activePointerId = event.pointerId
    startInteraction(event)
    if (!hasInteraction()) {
      target = null
      releasePointer()
      return
    }
    target = {
      image: props.image,
      project: props.project,
      regionId: props.selectedRegionId,
      candidates: props.regionCandidates,
      printArea: props.printArea,
      printAreaEditing: props.printAreaEditing,
      maskEditing: editorTools.maskEditing,
      exclusionEditing: editorTools.exclusionEditing,
      zoom: props.zoom,
    }
    captureElement = canvas.value
    captureElement.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: PointerEvent) {
    if (!target)
      return
    if (!targetIsCurrent()) {
      cancelInteraction()
      return
    }
    // 印刷範囲の2クリック選択では、最初のrelease後もホバーで終点を示す。
    if (activePointerId !== null && event.pointerId !== activePointerId)
      return
    if (activePointerId === null && !printAreaInteraction.value)
      return
    updateDraft(event)
  }

  function onPointerUp(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId)
      return
    if (!targetIsCurrent()) {
      cancelInteraction()
      return
    }
    try {
      commitInteraction(event)
    }
    finally {
      // continueだけは仮の印刷範囲を残す。通常の捕捉解除では消さない。
      if (!printAreaInteraction.value) {
        clearDrafts()
        target = null
      }
      releasePointer()
    }
  }

  function onPointerCancel(event?: PointerEvent) {
    if (event && activePointerId !== null && event.pointerId !== activePointerId)
      return
    cancelInteraction()
  }

  /** ブラシは既存どおり一筆を確定し、それ以外の捕捉喪失は仮状態を捨てる。 */
  function onLostPointerCapture(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId)
      return
    try {
      if (targetIsCurrent() && draftMaskStroke.value)
        commitDraftMaskStroke()
    }
    finally {
      cancelInteraction()
    }
  }

  watch(
    () => [props.image, props.project, props.selectedRegionId, props.regionCandidates, props.printArea, props.printAreaEditing, props.zoom, editorTools.maskEditing, editorTools.exclusionEditing],
    () => {
      if (target && !targetIsCurrent())
        cancelInteraction()
    },
  )
  watch(() => props.selectedCandidateId, (id) => {
    if (candidateInteraction.value && id !== candidateInteraction.value.id)
      cancelInteraction()
  })
  watch(() => props.selectedExclusionId, (id) => {
    if (exclusionInteraction.value?.original && id !== exclusionInteraction.value.original.id)
      cancelInteraction()
  })
  onScopeDispose(() => {
    disposed = true
    cancelInteraction()
  })

  const drafts = computed<CanvasDrafts>(() => ({
    region: draftRegion.value,
    newRegion: draft.value,
    exclusion: draftExclusion.value,
    creatingExclusion: exclusionInteraction.value?.kind === 'create',
    candidate: draftCandidate.value,
    maskStroke: draftMaskStroke.value,
    printArea: draftPrintArea.value,
  }))

  return { drafts, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }
}
