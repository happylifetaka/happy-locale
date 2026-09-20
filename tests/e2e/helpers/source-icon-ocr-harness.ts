import type { SourceIconOCRContext } from '../../../app/services/asset-discovery/source-ocr'
import type { TextRegion } from '../../../app/types/editor'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { useCardEditor } from '../../../app/composables/useCardEditor'
import { createImageDigestCache } from '../../../app/services/asset-discovery/digest'
import { approveOccurrence } from '../../../app/services/asset-discovery/review'
import { prepareSourceIconOCR, recognizeSourceIconOCR, sourceIconOCRPatch } from '../../../app/services/asset-discovery/source-ocr'
import { TesseractOCRProvider } from '../../../app/services/ocr/tesseract'
import { serializeFolderProject } from '../../../app/services/project/format'
import { useProjectStore } from '../../../app/stores/project'
import { renderCard } from '../../../app/utils/canvas/render'
import { baselineProject } from '../../fixtures/refactoring-baseline'

/** Synthetic service integration only; does not mutate the mounted app or private files. */
export async function runSourceIconOCRScenario() {
  const previousPinia = getActivePinia()
  const store = useProjectStore(createPinia())
  const digest = createImageDigestCache()
  const provider = new TesseractOCRProvider('/')
  const source = document.createElement('canvas')
  const asset = document.createElement('canvas')
  const output = document.createElement('canvas')
  let bitmap: ImageBitmap | undefined
  const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
  source.width = output.width = 600
  source.height = output.height = 240
  asset.width = asset.height = 28
  try {
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#203030'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.fillStyle = '#eeeeee'
    ctx.font = '32px serif'
    ctx.fillText('Gain +2', 40, 115)
    ctx.fillText('tokens.', 238, 115)
    ctx.fillStyle = '#dc3535'
    ctx.beginPath()
    ctx.arc(204, 100, 13, 0, Math.PI * 2)
    ctx.fill()
    asset.getContext('2d')!.drawImage(source, 190, 86, 28, 28, 0, 0, 28, 28)
    const file = new File([await png(source)], 'synthetic-source.png', { type: 'image/png' })
    const assetPNG = await png(asset)
    const imageDigest = await digest.digest(file)
    const assetDigest = await digest.digest(assetPNG)
    bitmap = await createImageBitmap(file)
    const project = baselineProject()
    project.cards[0]!.imageWidth = source.width
    project.cards[0]!.imageHeight = source.height
    project.assets = [{ id: 'gem', name: 'gem', sourceImageId: project.activeCardId, sourceRect: { x: 190, y: 86, width: 28, height: 28 }, imagePath: 'assets/gem.png', scale: 1, baselineOffset: 0, inlinePadding: 0 }]
    store.replaceProject(project)
    const editor = useCardEditor((id, card) => store.updateCard(id, card))
    editor.loadSavedProject(store.activeCard, project.activeCardId)
    editor.addRegion({ x: 20, y: 50, width: 520, height: 155 }, '#203030')
    const regionId = editor.selectedRegionId.value!
    editor.updateRegion(regionId, { originalText: 'Keep original', translatedText: 'Saved translation.', translationStatus: 'reviewed', backgroundMode: 'manual', manualMaskStrokes: [], verticalAlign: 'bottom', ocrLayout: 'single-line' })
    const occurrence = approveOccurrence({
      id: 'synthetic-icon',
      cardId: project.activeCardId,
      imageDigest,
      imageSize: { width: 600, height: 240 },
      bounds: { x: 190, y: 86, width: 28, height: 28 },
      detectedBounds: { x: 190, y: 86, width: 28, height: 28 },
      origin: 'detected',
      detectorRevision: 'synthetic-v1',
      owner: { kind: 'region', id: regionId },
      decision: 'pending',
      assetId: 'gem',
      approval: null,
    }, imageDigest, assetDigest)
    store.setAssetDiscovery({ occurrences: [occurrence], groups: [] })
    editor.loadSavedProject(editor.project.value, project.activeCardId)
    const scope = { session: Symbol('source-ocr-test'), revision: 0 }
    let active = true
    const context = (): SourceIconOCRContext => ({ card: store.document!.cards[0]!, occurrences: store.document!.assetDiscovery!.occurrences, assets: store.document!.assets, imageDigest, assetDigests: new Map([['gem', assetDigest]]) })
    const current = () => active ? { context: context(), scope } : null
    const saved = () => serializeFolderProject(store.snapshot()!)
    const rendered = (regions: readonly TextRegion[] = editor.project.value.regions) => {
      renderCard(output.getContext('2d')!, bitmap!, 600, 240, regions, store.document!.assets, new Map([['gem', asset]]))
      return output.toDataURL('image/png')
    }
    const before = saved()
    const assetsBefore = JSON.stringify(store.document!.assets)
    const beforeImage = rendered()
    const draft = prepareSourceIconOCR(context(), regionId, ['synthetic-icon'], scope)
    let progressCount = 0
    const preview = await recognizeSourceIconOCR(draft, { image: bitmap, provider, current, onProgress: () => progressCount++ })
    if (!preview)
      throw new Error('Unexpectedly cancelled source OCR')
    const previewDidNotWrite = saved() === before && rendered() === beforeImage && !editor.canUndo.value
    const patch = sourceIconOCRPatch(context(), preview, scope)
    const proposedImage = rendered([{ ...editor.project.value.regions[0]!, ...patch }])
    editor.updateRegion(regionId, patch)
    const after = saved()
    const afterImage = rendered()
    const applied = store.snapshot()!
    editor.undo()
    const undoRestoredAll = saved() === before && rendered() === beforeImage && !editor.canUndo.value
    editor.redo()
    const redoRestoredAll = saved() === after && rendered() === afterImage

    const cancelledDraft = prepareSourceIconOCR(context(), regionId, ['synthetic-icon'], scope)
    const cancelled = await recognizeSourceIconOCR(cancelledDraft, { image: bitmap, current, provider: {
      recognize: async (image, options) => {
        const result = await provider.recognize(image, options)
        active = false
        return result
      },
    } })
    const cancelledWithoutWrite = cancelled === null && saved() === after && rendered() === afterImage
    active = true
    let missingWordsRefused = false
    try {
      await recognizeSourceIconOCR(prepareSourceIconOCR(context(), regionId, ['synthetic-icon'], scope), { image: bitmap, current, provider: { recognize: async () => ({ text: 'No coordinates', confidence: 90, blocks: [] }) } })
    }
    catch {
      missingWordsRefused = true
    }
    return {
      imageDigest,
      assetDigest,
      originalText: preview.originalText,
      progressCount,
      previewDidNotWrite,
      proposedRenderingDiffers: proposedImage !== beforeImage,
      appliedRenderingMatches: proposedImage === afterImage,
      applied,
      undoRestoredAll,
      redoRestoredAll,
      cancelledWithoutWrite,
      missingWordsRefusedWithoutWrite: missingWordsRefused && saved() === after && rendered() === afterImage,
      sharedAssetsUnchanged: JSON.stringify(store.document!.assets) === assetsBefore,
      assetPixelsUnchanged: await digest.digest(await png(asset)) === assetDigest,
      sourcePixelsUnchanged: await digest.digest(await png(source)) === imageDigest,
    }
  }
  finally {
    bitmap?.close()
    source.width = source.height = asset.width = asset.height = output.width = output.height = 1
    digest.clear()
    store.$dispose()
    setActivePinia(previousPinia)
    await provider.dispose()
  }
}
