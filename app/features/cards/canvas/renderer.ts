import type { CardProject, ImageAsset, MaskStroke, RegionDraft } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { estimateBackgroundColor } from '~/utils/canvas/background'
import { drawSelection, renderCard } from '~/utils/canvas/render'
import { transformRegionContents } from '~/utils/regions'
import { drawAutomaticMaskPreview, drawExclusionOverlay, drawMaskOverlay, drawPrintArea, drawRegionCandidates, drawRegionSelection, drawUnselectedRegionOutlines } from './overlays'

export interface CanvasRenderInput {
  image: HTMLImageElement | null
  project: CardProject
  selectedRegionId: string | null
  autoMaskPreview: boolean
  selectedExclusionId: string | null
  zoom: number
  previewMode: 'edited' | 'original'
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  fontFamilies: ReadonlyMap<string, string>
  regionCandidates: RegionCandidate[]
  selectedCandidateId: string | null
  printArea: RegionDraft | null
  printAreaEditing: boolean
}

export interface CanvasDrafts {
  region: RegionDraft | null
  newRegion: RegionDraft | null
  exclusion: RegionDraft | null
  creatingExclusion: boolean
  candidate: RegionDraft | null
  maskStroke: MaskStroke | null
  printArea: RegionDraft | null
}

/** 元画像/編集済みプレビューのキャッシュを所有する。入力の画像・アセットは借用する。 */
export function createCardCanvasRenderer(readInput: () => CanvasRenderInput) {
  /** 背景色の採取などに使う、編集前の元画像Canvasのキャッシュ。 */
  let sourceCanvas: HTMLCanvasElement | null = null
  /** 元画像Canvasを作成した画像。差し替え判定に使う。 */
  let sourceCanvasImage: HTMLImageElement | null = null
  /** 同じ編集状態の再描画を避けるための合成画像キャッシュ。 */
  let editedPreviewCanvas: HTMLCanvasElement | null = null
  /** 合成画像の再利用可否を判定する入力オブジェクトの組。 */
  let editedPreviewKey: {
    image: HTMLImageElement
    project: CardProject
    assets: ImageAsset[]
    assetImages: ReadonlyMap<string, CanvasImageSource>
    fontFamilies: ReadonlyMap<string, string>
  } | null = null

  /** 背景色採取と補修には編集前の画素を使うため、元画像専用Canvasをキャッシュする。 */
  function sourceContext() {
    const props = readInput()
    if (
      !props.image
      || props.project.imageWidth <= 0
      || props.project.imageHeight <= 0
    ) {
      return null
    }
    if (
      !sourceCanvas
      || sourceCanvasImage !== props.image
      || sourceCanvas.width !== props.project.imageWidth
      || sourceCanvas.height !== props.project.imageHeight
    ) {
      sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = props.project.imageWidth
      sourceCanvas.height = props.project.imageHeight
      sourceCanvasImage = props.image
      const context = sourceCanvas.getContext('2d', { willReadFrequently: true })
      context?.drawImage(
        props.image,
        0,
        0,
        props.project.imageWidth,
        props.project.imageHeight,
      )
    }
    return sourceCanvas.getContext('2d', { willReadFrequently: true })
  }

  /** 編集データや画像の参照が変わるまで描画結果を再利用し、ズームや選択枠の操作を軽くする。 */
  function editedPreview(): HTMLCanvasElement | null {
    const props = readInput()
    if (!props.image)
      return null
    const cacheValid
      = editedPreviewCanvas
        && editedPreviewKey?.image === props.image
        && editedPreviewKey.project === props.project
        && editedPreviewKey.assets === props.assets
        && editedPreviewKey.assetImages === props.assetImages
        && editedPreviewKey.fontFamilies === props.fontFamilies
    if (cacheValid)
      return editedPreviewCanvas

    const output = document.createElement('canvas')
    output.width = props.project.imageWidth
    output.height = props.project.imageHeight
    const context = output.getContext('2d')
    if (!context)
      return null
    renderCard(
      context,
      props.image,
      output.width,
      output.height,
      props.project.regions,
      props.assets.filter(asset => props.assetImages.has(asset.id)),
      props.assetImages,
      props.fontFamilies,
    )
    editedPreviewCanvas = output
    editedPreviewKey = {
      image: props.image,
      project: props.project,
      assets: props.assets,
      assetImages: props.assetImages,
      fontFamilies: props.fontFamilies,
    }
    return output
  }

  /** 編集画像の上に選択枠・候補・マスクを重ねる。操作用の表示は書き出し画像には含めない。 */
  function redraw(element: HTMLCanvasElement | null, drafts: CanvasDrafts, maskEditing: boolean) {
    const props = readInput()
    if (
      !element
      || !props.image
      || props.project.imageWidth <= 0
      || props.project.imageHeight <= 0
    ) {
      return
    }
    const context = element.getContext('2d')
    if (!context)
      return
    const previewRegions = props.project.regions.map(region =>
      region.id === props.selectedRegionId && drafts.region
        ? {
            ...region,
            ...drafts.region,
            ...transformRegionContents(region, drafts.region),
          }
        : region,
    )
    const selected = previewRegions.find(
      region => region.id === props.selectedRegionId,
    )
    const inspectingAutomaticMask
      = props.autoMaskPreview && selected?.backgroundMode === 'auto'
    if (props.previewMode === 'original' || inspectingAutomaticMask) {
      context.clearRect(
        0,
        0,
        props.project.imageWidth,
        props.project.imageHeight,
      )
      context.drawImage(
        props.image,
        0,
        0,
        props.project.imageWidth,
        props.project.imageHeight,
      )
    }
    else {
      const cached = drafts.region ? null : editedPreview()
      if (cached) {
        context.clearRect(
          0,
          0,
          props.project.imageWidth,
          props.project.imageHeight,
        )
        context.drawImage(cached, 0, 0)
      }
      else {
        renderCard(
          context,
          props.image,
          props.project.imageWidth,
          props.project.imageHeight,
          previewRegions,
          props.assets.filter(asset => props.assetImages.has(asset.id)),
          props.assetImages,
          props.fontFamilies,
        )
      }
    }
    if (props.previewMode === 'edited' && !props.printAreaEditing)
      drawUnselectedRegionOutlines(context, previewRegions, props.selectedRegionId, props.zoom)
    if (selected && inspectingAutomaticMask)
      drawAutomaticMaskPreview(context, selected, sourceContext()?.getImageData(0, 0, props.project.imageWidth, props.project.imageHeight) ?? null)
    if (selected && !props.printAreaEditing)
      drawRegionSelection(context, selected, props.zoom)
    if (!props.printAreaEditing && selected && selected.exclusionAreas.length > 0) {
      drawExclusionOverlay(context, selected, props.zoom, props.selectedExclusionId, drafts.exclusion, drafts.creatingExclusion)
    }
    else if (
      !props.printAreaEditing
      && selected
      && drafts.creatingExclusion
      && drafts.exclusion
    ) {
      drawExclusionOverlay(context, selected, props.zoom, props.selectedExclusionId, drafts.exclusion, drafts.creatingExclusion)
    }
    if (
      !props.printAreaEditing
      && selected
      && maskEditing
      && selected.backgroundMode === 'manual'
    ) {
      drawMaskOverlay(context, selected, [
        ...selected.manualMaskStrokes,
        ...(drafts.maskStroke ? [drafts.maskStroke] : []),
      ])
    }
    if (drafts.newRegion)
      drawSelection(context, drafts.newRegion, true)
    if (props.regionCandidates.length > 0 && !props.printAreaEditing)
      drawRegionCandidates(context, props.regionCandidates, props.selectedCandidateId, drafts.candidate, props.zoom)
    if (props.printAreaEditing)
      drawPrintArea(context, drafts.printArea ?? props.printArea, props.zoom)
  }

  /** 新しい領域の背景色を元画像から推定する。 */
  function colorFromOriginalImage(bounds: RegionDraft) {
    const props = readInput()
    const context = sourceContext()
    if (!context)
      return '#ffffff'
    return estimateBackgroundColor(
      context,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      props.project.imageWidth,
      props.project.imageHeight,
    )
  }

  /** 表示倍率に関係なく元解像度で再描画し、選択枠を含まないPNG／JPEGを生成する。 */
  async function exportImage(
    type: 'image/png' | 'image/jpeg',
  ): Promise<Blob | null> {
    const props = readInput()
    if (!props.image)
      return null
    const output = document.createElement('canvas')
    output.width = props.project.imageWidth
    output.height = props.project.imageHeight
    const context = output.getContext('2d')
    if (!context)
      return null
    renderCard(
      context,
      props.image,
      output.width,
      output.height,
      props.project.regions,
      props.assets.filter(asset => props.assetImages.has(asset.id)),
      props.assetImages,
      props.fontFamilies,
    )
    return new Promise(resolve => output.toBlob(resolve, type, 0.92))
  }

  function dispose() {
    sourceCanvas = null
    sourceCanvasImage = null
    editedPreviewCanvas = null
    editedPreviewKey = null
  }

  return { redraw, colorFromOriginalImage, exportImage, dispose }
}
