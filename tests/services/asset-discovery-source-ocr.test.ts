import type { SourceIconOCRContext, SourceIconOCRScope } from '~/services/asset-discovery/source-ocr'
import type { OCROptions, OCRResult, OCRTextBlock } from '~/services/ocr/types'
import type { ImageAsset } from '~/types/editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { approveOccurrence } from '~/services/asset-discovery/review'
import { prepareSourceIconOCR, recognizeSourceIconOCR, SOURCE_ICON_OCR_LIMITS, sourceIconOCRPatch, sourceIconPositionPatch } from '~/services/asset-discovery/source-ocr'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { FILE_LIMITS } from '~/utils/file-limits'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn() }))
const blob = new Blob(['synthetic OCR crop'])
beforeEach(() => vi.mocked(prepareRegionForOCR).mockReset().mockResolvedValue(blob))

const word = (text: string, x: number, y = 30, width = 15): OCRTextBlock => ({ text, x: x * 3 + 12, y: y * 3 + 12, width: width * 3, height: 15 * 3, confidence: 90 })
function result(): OCRResult {
  return { text: 'not used as replacement', confidence: 91, blocks: [], words: [word('Gain', 0), word('+2', 70), word(',', 115, 30, 4)] }
}

function setup() {
  const editor = useCardEditor()
  editor.loadImageProject('synthetic.png', 500, 700)
  editor.addRegion({ x: 20, y: 100, width: 250, height: 110 }, '#123456')
  const regionId = editor.selectedRegionId.value!
  editor.updateRegion(regionId, {
    originalText: 'Existing original.',
    translatedText: '既存の訳',
    translationStatus: 'reviewed',
    sourceIcons: [{ id: 'manual-1', assetId: 'manual', x: 90, y: 30, width: 20, height: 20 }],
    exclusionAreas: [{ id: 'protected', x: 0, y: 75, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 4, points: [{ x: 150, y: 50 }] }],
    ocrLayout: 'text-block',
  })
  const assets: ImageAsset[] = ['gem', 'manual'].map(id => ({ id, name: id, sourceImageId: 'card', sourceRect: { x: 40, y: 130, width: 20, height: 20 }, imagePath: `assets/${id}.png`, scale: 1, baselineOffset: 0, inlinePadding: 0 }))
  const imageDigest = 'a'.repeat(64)
  const assetDigest = 'b'.repeat(64)
  const occurrence = approveOccurrence({
    id: 'chosen',
    cardId: 'card',
    imageSize: { width: 500, height: 700 },
    imageDigest,
    bounds: { x: 50, y: 130, width: 20, height: 20 },
    detectedBounds: { x: 50, y: 130, width: 20, height: 20 },
    origin: 'detected',
    detectorRevision: 'synthetic-v1',
    owner: { kind: 'region', id: regionId },
    decision: 'pending',
    assetId: 'gem',
    approval: null,
  }, imageDigest, assetDigest)
  const context: SourceIconOCRContext = {
    card: { id: 'card', ...JSON.parse(JSON.stringify(editor.project.value)) },
    occurrences: [occurrence],
    assets,
    imageDigest,
    assetDigests: new Map(assets.map(asset => [asset.id, assetDigest])),
  }
  const scope: SourceIconOCRScope = { session: Symbol('review'), revision: 0 }
  const prepare = (ids: string[] = ['chosen']) => prepareSourceIconOCR(context, regionId, ids, scope)
  const provider = { recognize: vi.fn().mockResolvedValue(result()), dispose: vi.fn() }
  const image = { close: vi.fn() } as unknown as ImageBitmap
  const onProgress = vi.fn()
  const options = { image, provider, current: vi.fn((): { context: SourceIconOCRContext, scope: SourceIconOCRScope } | null => ({ context, scope })), onProgress }
  return { editor, regionId, context, scope, prepare, provider, options }
}

describe('approved icon OCR working copy', () => {
  it('adds only selected approved occurrences, keeps manual data, and freezes an independent copy', () => {
    const s = setup()
    s.context.occurrences = [...s.context.occurrences, { ...s.context.occurrences[0]!, id: 'unselected', decision: 'pending', approval: null }]
    const before = JSON.stringify(s.context)
    const draft = s.prepare()
    expect(draft.region.sourceIcons).toEqual([
      s.context.card.regions[0]!.sourceIcons![0],
      { id: 'discovery-chosen', assetId: 'gem', x: 30, y: 30, width: 20, height: 20 },
    ])
    expect(draft.region).toMatchObject({ originalText: 'Existing original.', translatedText: '既存の訳', translationStatus: 'reviewed' })
    expect(draft.region.exclusionAreas).toEqual(s.context.card.regions[0]!.exclusionAreas)
    expect(draft.region.manualMaskStrokes).toEqual(s.context.card.regions[0]!.manualMaskStrokes)
    expect(draft.region.exclusionAreas).not.toBe(s.context.card.regions[0]!.exclusionAreas)
    expect(Object.isFrozen(draft.region.sourceIcons![0])).toBe(true)
    expect(() => {
      draft.region.sourceIcons![0]!.x = 99
    }).toThrow()
    expect(JSON.stringify(s.context)).toBe(before)
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
  })

  it('deduplicates the same asset and exact bounds without replacing a manual ID', () => {
    const s = setup()
    s.context.card.regions[0]!.sourceIcons!.push({ id: 'hand-drawn', assetId: 'gem', x: 30, y: 30, width: 20, height: 20 })
    expect(s.prepare().region.sourceIcons!.map(icon => icon.id)).toEqual(['manual-1', 'hand-drawn'])
  })

  it.each(['pending', 'excluded', 'owner', 'card', 'dimensions', 'bounds', 'image-hash', 'asset-hash', 'manual-conflict', 'duplicate-icon-id', 'missing-manual-asset', 'missing-manual-digest', 'invalid-name', 'duplicate-name'] as const)('rejects %s rather than silently replacing or applying it', (reason) => {
    const s = setup()
    const occurrence = s.context.occurrences[0]!
    if (reason === 'pending' || reason === 'excluded') {
      occurrence.decision = reason
      occurrence.approval = null
    }
    if (reason === 'owner')
      occurrence.owner = null
    if (reason === 'card')
      occurrence.cardId = 'other'
    if (reason === 'dimensions')
      occurrence.imageSize.width = 501
    if (reason === 'bounds')
      occurrence.bounds.x++
    if (reason === 'image-hash')
      s.context.imageDigest = 'c'.repeat(64)
    if (reason === 'asset-hash')
      s.context.assetDigests = new Map([['gem', 'c'.repeat(64)]])
    if (reason === 'manual-conflict')
      s.context.card.regions[0]!.sourceIcons![0]!.x = 35
    if (reason === 'duplicate-icon-id')
      s.context.card.regions[0]!.sourceIcons!.push({ ...s.context.card.regions[0]!.sourceIcons![0]! })
    if (reason === 'missing-manual-asset')
      s.context.assets = [s.context.assets[0]!]
    if (reason === 'missing-manual-digest')
      s.context.assetDigests = new Map([['gem', 'b'.repeat(64)]])
    if (reason === 'invalid-name')
      s.context.assets[0]!.name = '[icon:wrong]'
    if (reason === 'duplicate-name')
      s.context.assets[0]!.name = 'manual'
    const before = JSON.stringify(s.context)
    expect(() => s.prepare()).toThrow()
    expect(JSON.stringify(s.context)).toBe(before)
  })

  it.each([{ ids: [] }, { ids: ['missing'] }, { ids: ['chosen', 'chosen'] }])('rejects invalid selection $ids', ({ ids }) => {
    const s = setup()
    expect(() => s.prepare(ids)).toThrow()
  })

  it('rejects invalid dimensions, a missing target, invalid scope, and oversized collections', () => {
    const s = setup()
    expect(() => prepareSourceIconOCR(s.context, 'missing', ['chosen'], s.scope)).toThrow()
    expect(() => s.prepare(Array.from({ length: 101 }, (_, i) => `${i}`))).toThrow()
    s.scope.revision = -1
    expect(() => s.prepare()).toThrow()
    s.scope.revision = 0
    s.context.card.imageWidth = Infinity
    expect(() => s.prepare()).toThrow()
    s.context.card.imageWidth = 500
    s.context.occurrences = Array.from({ length: 2001 }, () => s.context.occurrences[0]!)
    expect(() => s.prepare()).toThrow()
  })

  it('keeps position-only patches independent and rejects cloned or changed drafts', () => {
    const s = setup()
    const draft = s.prepare()
    const patch = sourceIconPositionPatch(s.context, draft, s.scope)
    expect(Object.keys(patch)).toEqual(['sourceIcons'])
    patch.sourceIcons[0]!.x = 0
    expect(sourceIconPositionPatch(s.context, draft, s.scope).sourceIcons[0]!.x).toBe(90)
    expect(() => sourceIconPositionPatch(s.context, structuredClone(draft), s.scope)).toThrow('やり直し')
    expect(() => sourceIconPositionPatch(s.context, draft, { ...s.scope, session: Symbol('another') })).toThrow()
    s.scope.revision++
    expect(() => sourceIconPositionPatch(s.context, draft, s.scope)).toThrow()
  })
})

describe('source OCR and explicit application', () => {
  it('rejects an oversized scaled OCR image before allocating its Canvas', async () => {
    const s = setup()
    s.context.card.imageWidth = 20000
    s.context.card.regions[0]!.width = 12000
    s.context.occurrences[0]!.imageSize.width = 20000
    await expect(recognizeSourceIconOCR(s.prepare(), s.options)).rejects.toThrow('再OCR画像')
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
    expect(s.provider.recognize).not.toHaveBeenCalled()
  })

  it('masks working icons plus exclusions and reconstructs local word positions without string replacement', async () => {
    const s = setup()
    const before = JSON.stringify(s.editor.project.value)
    const draft = s.prepare()
    const preview = await recognizeSourceIconOCR(draft, s.options)
    expect(prepareRegionForOCR).toHaveBeenCalledExactlyOnceWith(s.options.image, draft.region, { scale: 3, padding: 12, exclusions: [...draft.region.exclusionAreas, ...draft.region.sourceIcons!] })
    expect(s.provider.recognize).toHaveBeenCalledExactlyOnceWith(blob, expect.objectContaining({ language: 'eng', layout: 'text-block', onProgress: expect.any(Function) }))
    expect(preview).toMatchObject({ originalText: 'Gain [icon:gem] +2 [icon:manual] ,', confidence: 91, draft })
    expect(Object.isFrozen(preview)).toBe(true)
    expect(JSON.stringify(s.editor.project.value)).toBe(before)
    expect(s.provider.dispose).not.toHaveBeenCalled()
    expect(s.options.image.close).not.toHaveBeenCalled()
  })

  it('keeps repeated adjacent icons, numbers and punctuation and removes only fully masked OCR noise', async () => {
    const s = setup()
    s.context.occurrences = [...s.context.occurrences, approveOccurrence({ ...s.context.occurrences[0]!, id: 'second', bounds: { x: 70, y: 130, width: 20, height: 20 } }, s.context.imageDigest, 'b'.repeat(64))]
    s.provider.recognize.mockResolvedValueOnce({ ...result(), words: [word('Gain', 0), word('masked', 32, 32, 4), word('+2', 70), word(',', 115, 30, 4), word('masked', 120, 70)] })
    const preview = await recognizeSourceIconOCR(s.prepare(['chosen', 'second']), s.options)
    expect(preview!.originalText).toBe('Gain [icon:gem] [icon:gem] +2 [icon:manual] ,\nmasked')
  })

  it.each(['no-words', 'empty-words', 'whitespace', 'nan', 'zero-height', 'word-limit', 'text-limit', 'invalid-confidence', 'unknown-tag', 'duplicate-tag', 'broken-tag'] as const)('refuses unsafe OCR output %s without modifying the region', async (reason) => {
    const s = setup()
    const r = result()
    if (reason === 'no-words')
      delete r.words
    if (reason === 'empty-words')
      r.words = []
    if (reason === 'whitespace')
      r.words = [word(' ', 0)]
    if (reason === 'nan')
      r.words![0]!.x = Number.NaN
    if (reason === 'zero-height')
      r.words![0]!.height = 0
    if (reason === 'word-limit')
      r.words = Array.from({ length: SOURCE_ICON_OCR_LIMITS.words + 1 }, () => word('a', 0))
    if (reason === 'text-limit')
      r.words![0]!.text = 'a'.repeat(FILE_LIMITS.projectStringLength + 1)
    if (reason === 'invalid-confidence')
      r.confidence = Infinity
    if (reason === 'unknown-tag')
      r.words![0]!.text = '[icon:unknown]'
    if (reason === 'duplicate-tag')
      r.words![0]!.text = '[icon:gem]'
    if (reason === 'broken-tag')
      r.words![0]!.text = '[ICON:'
    s.provider.recognize.mockResolvedValueOnce(r)
    const before = JSON.stringify(s.editor.project.value)
    await expect(recognizeSourceIconOCR(s.prepare(), s.options)).rejects.toThrow()
    expect(JSON.stringify(s.editor.project.value)).toBe(before)
  })

  it('applies text and positions as one ordinary edit/Undo/Redo, keeping translation and shared assets', async () => {
    const s = setup()
    const before = JSON.stringify(s.editor.project.value)
    const assetsBefore = JSON.stringify(s.context.assets)
    const preview = (await recognizeSourceIconOCR(s.prepare(), s.options))!
    const patch = sourceIconOCRPatch(s.context, preview, s.scope)
    expect(Object.keys(patch).sort()).toEqual(['lastOcrText', 'originalText', 'sourceIcons'])
    expect(patch.lastOcrText).toBe(preview.originalText)
    expect(() => sourceIconOCRPatch(s.context, { ...preview }, s.scope)).toThrow('セッション')
    s.editor.updateRegion(s.regionId, patch)
    expect(s.editor.project.value.regions[0]).toMatchObject({ originalText: preview.originalText, sourceIcons: patch.sourceIcons, translatedText: '既存の訳', translationStatus: 'draft' })
    const applied = JSON.stringify(s.editor.project.value)
    s.editor.undo()
    expect(JSON.stringify(s.editor.project.value)).toBe(before)
    s.editor.redo()
    expect(JSON.stringify(s.editor.project.value)).toBe(applied)
    expect(JSON.stringify(s.context.assets)).toBe(assetsBefore)
    s.context.card.regions = s.editor.project.value.regions
    expect(() => sourceIconOCRPatch(s.context, preview, s.scope)).toThrow()
  })

  it('applies positions alone independently of cancelling OCR and leaves original/reviewed translation intact', async () => {
    const s = setup()
    const draft = s.prepare()
    const before = JSON.stringify(s.editor.project.value)
    s.editor.updateRegion(s.regionId, sourceIconPositionPatch(s.context, draft, s.scope))
    const withPositions = JSON.stringify(s.editor.project.value)
    s.context.card.regions = s.editor.project.value.regions
    expect(await recognizeSourceIconOCR(draft, s.options)).toBeNull()
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
    expect(JSON.stringify(s.editor.project.value)).toBe(withPositions)
    expect(s.editor.project.value.regions[0]).toMatchObject({ originalText: 'Existing original.', translationStatus: 'reviewed' })
    s.editor.undo()
    expect(JSON.stringify(s.editor.project.value)).toBe(before)
  })

  it.each(['original', 'translation', 'manual-icon', 'bounds', 'owner', 'approval', 'asset-name', 'asset-hash', 'image', 'revision'] as const)('revalidates %s after preview before making a patch', async (change) => {
    const s = setup()
    const preview = (await recognizeSourceIconOCR(s.prepare(), s.options))!
    const region = s.context.card.regions[0]!
    if (change === 'original')
      region.originalText += 'edited'
    if (change === 'translation')
      region.translatedText += '編集'
    if (change === 'manual-icon')
      region.sourceIcons![0]!.x++
    if (change === 'bounds')
      region.x++
    if (change === 'owner')
      s.context.occurrences[0]!.owner = null
    if (change === 'approval') {
      s.context.occurrences[0]!.approval = null
      s.context.occurrences[0]!.decision = 'pending'
    }
    if (change === 'asset-name')
      s.context.assets[0]!.name = 'renamed'
    if (change === 'asset-hash')
      s.context.assetDigests = new Map([['gem', 'c'.repeat(64)], ['manual', 'b'.repeat(64)]])
    if (change === 'image')
      s.context.imageDigest = 'c'.repeat(64)
    if (change === 'revision')
      s.scope.revision++
    expect(() => sourceIconOCRPatch(s.context, preview, s.scope)).toThrow()
  })
})

describe('asynchronous source OCR lifetime', () => {
  it('does not run for copied drafts or already cancelled requests', async () => {
    const s = setup()
    const draft = s.prepare()
    await expect(recognizeSourceIconOCR(structuredClone(draft), s.options)).rejects.toThrow('セッション')
    s.options.current.mockReturnValue(null)
    expect(await recognizeSourceIconOCR(draft, s.options)).toBeNull()
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
    expect(s.provider.recognize).not.toHaveBeenCalled()
  })

  it.each(['preprocess', 'recognize'] as const)('discards completion after cancellation during %s', async (stage) => {
    const s = setup()
    let complete!: () => void
    const ready = new Promise<void>((resolve) => {
      complete = resolve
    })
    if (stage === 'preprocess') {
      vi.mocked(prepareRegionForOCR).mockImplementationOnce(async () => {
        await ready
        return blob
      })
    }
    else {
      s.provider.recognize.mockImplementationOnce(async () => {
        await ready
        return result()
      })
    }
    const task = recognizeSourceIconOCR(s.prepare(), s.options)
    await Promise.resolve()
    s.options.current.mockReturnValue(null)
    complete()
    expect(await task).toBeNull()
    if (stage === 'preprocess')
      expect(s.provider.recognize).not.toHaveBeenCalled()
  })

  it.each(['preprocess', 'recognize'] as const)('reports current %s errors but ignores late errors after cancellation', async (stage) => {
    const s = setup()
    const operation = stage === 'preprocess' ? vi.mocked(prepareRegionForOCR) : s.provider.recognize
    operation.mockRejectedValueOnce(new Error('current failure'))
    await expect(recognizeSourceIconOCR(s.prepare(), s.options)).rejects.toThrow('current failure')
    operation.mockImplementationOnce(async () => {
      s.options.current.mockReturnValue(null)
      throw new Error('late failure')
    })
    expect(await recognizeSourceIconOCR(s.prepare(), s.options)).toBeNull()
  })

  it('latches stale progress, drops late progress, and never revives an edited/undone request', async () => {
    const s = setup()
    s.provider.recognize.mockImplementationOnce(async (_blob: Blob, options: OCROptions) => {
      options.onProgress!({ status: 'before', progress: 0.1 })
      const name = s.context.assets[0]!.name
      s.context.assets[0]!.name = 'changed'
      options.onProgress!({ status: 'stale', progress: 0.2 })
      s.context.assets[0]!.name = name
      options.onProgress!({ status: 'restored', progress: 1 })
      return result()
    })
    expect(await recognizeSourceIconOCR(s.prepare(), s.options)).toBeNull()
    expect(s.options.onProgress).toHaveBeenCalledExactlyOnceWith({ status: 'before', progress: 0.1 })

    let lateProgress!: OCROptions['onProgress']
    s.provider.recognize.mockImplementationOnce(async (_blob: Blob, options: OCROptions) => {
      lateProgress = options.onProgress
      return result()
    })
    expect(await recognizeSourceIconOCR(s.prepare(), s.options)).not.toBeNull()
    lateProgress!({ status: 'late', progress: 1 })
    expect(s.options.onProgress).toHaveBeenCalledOnce()

    s.provider.recognize.mockImplementationOnce(async () => {
      s.scope.revision += 2
      return result()
    })
    expect(await recognizeSourceIconOCR(s.prepare(), s.options)).toBeNull()
  })

  it('treats a lost/disposed current context as cancellation', async () => {
    const s = setup()
    s.options.current.mockImplementation(() => {
      throw new Error('disposed')
    })
    expect(await recognizeSourceIconOCR(s.prepare(), s.options)).toBeNull()
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
  })
})
