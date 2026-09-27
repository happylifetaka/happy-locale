import type { OCRProvider, OCRResult } from '~/services/ocr/types'
import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { FILE_LIMITS } from '~/utils/file-limits'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useDiscoverySourceOCR } from './useDiscoverySourceOCR'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn() }))
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const cleanups: Array<() => void> = []
const bitmaps: Array<{ width: number, height: number, close: ReturnType<typeof vi.fn> }> = []
beforeEach(() => {
  setActivePinia(createPinia())
  bitmaps.length = 0
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    const bitmap = { width: 200, height: 240, close: vi.fn() }
    bitmaps.push(bitmap)
    return bitmap
  }))
  vi.mocked(prepareRegionForOCR).mockReset().mockResolvedValue(new Blob(['OCR crop']))
})
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function recognized(): OCRResult {
  return { text: 'unused raw text', confidence: 90, blocks: [], words: [
    { text: 'Gain', x: 12, y: 102, width: 60, height: 45, confidence: 90 },
    { text: '2', x: 207, y: 102, width: 30, height: 45, confidence: 90 },
  ] }
}

function setup(draft = false) {
  const store = useProjectStore()
  const document = discoveryProject()
  const card = document.cards[0]!
  if (draft) {
    store.updateCard(null, card)
    store.setAssets(document.assets)
    store.setCardOCRCandidates(card.id, card.ocrCandidates!)
  }
  else {
    store.replaceProject(document)
  }
  const editorId = ref<string | null>(draft ? null : card.id)
  const cardId = ref(card.id)
  const editor = useCardEditor((id, value) => store.updateCard(id, value))
  editor.loadSavedProject(store.activeCard, editorId.value ?? undefined)
  editor.addRegion({ x: 10, y: 20, width: 180, height: 130 }, '#223333')
  const regionId = editor.selectedRegionId.value!
  editor.updateRegion(regionId, { originalText: 'Keep original', translatedText: '既存の訳', translationStatus: 'reviewed', ocrLayout: 'text-block' })
  editor.loadSavedProject(editor.project.value, editorId.value ?? undefined)
  const occurrence = document.assetDiscovery!.occurrences[0]!
  occurrence.owner = { kind: 'region', id: regionId }
  occurrence.imageDigest = hash('source')
  occurrence.approval!.imageDigest = hash('source')
  occurrence.approval!.assetDigest = hash('latest PNG')
  store.setAssetDiscovery(document.assetDiscovery!, cardId.value)
  const runtime = useProjectRuntime()
  runtime.cardSourceFile.value = new File(['source'], 'source.png', { type: 'image/png' })
  runtime.assetFiles.value = new Map([['asset-1', new Blob(['old PNG'])]])
  runtime.setPendingAssetWrite('asset-1', new Blob(['latest PNG']))
  const busy = ref(false)
  const available = ref(true)
  const selectedId = ref(regionId)
  const dependency = shallowRef<object>({ dialog: 'open' })
  const provider = { recognize: vi.fn(async (): Promise<OCRResult> => recognized()), dispose: vi.fn() }
  const getProvider = vi.fn(async (): Promise<OCRProvider> => provider)
  const onProgress = vi.fn()
  const scope = effectScope()
  const controller = scope.run(() => useDiscoverySourceOCR({
    store,
    editor,
    runtime,
    getProvider,
    onProgress,
    target: () => available.value ? { editorCardId: editorId.value, regionId: selectedId.value, card: { ...store.activeCard, id: cardId.value } } : null,
    busy: () => busy.value,
    scope: () => [dependency.value],
  }))!
  cleanups.push(() => {
    scope.stop()
    runtime.dispose()
  })
  const prepare = () => controller.prepare(['occurrence-1'])
  return { store, editor, runtime, controller, prepare, provider, getProvider, onProgress, scope, busy, available, selectedId, cardId, editorId, regionId, dependency }
}

it.each([false, true])('verifies actual source/latest PNG bytes and applies preview with one Undo (draft=%s)', async (draftProject) => {
  const s = setup(draftProject)
  const before = s.store.readCardCandidateEdit(s.editorId.value)
  const discovery = structuredClone(s.store.assetDiscovery)
  const assets = JSON.stringify(s.store.assets)
  const signature = !draftProject ? savedProjectSignature(s.store.snapshot()!) : null
  const draft = (await s.prepare())!
  expect(draft.region.sourceIcons).toEqual([{ id: 'discovery-occurrence-1', assetId: 'asset-1', x: 30, y: 30, width: 20, height: 20 }])
  expect(s.controller.draft.value).toBe(draft)
  expect(s.getProvider).not.toHaveBeenCalled()
  expect(createImageBitmap).toHaveBeenCalledExactlyOnceWith(s.runtime.cardSourceFile.value)
  expect(bitmaps[0]!.close).toHaveBeenCalledOnce()
  const preview = (await s.controller.recognize(draft))!
  expect(preview.originalText).toBe('Gain [icon:synthetic-icon] 2')
  expect(s.controller.preview.value).toBe(preview)
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  expect(s.controller.apply(preview)).toBe(true)
  expect(s.controller.preview.value).toBeNull()
  expect(s.controller.draft.value).toBeNull()
  const after = s.store.readCardCandidateEdit(s.editorId.value)
  expect(after.project.regions[0]).toMatchObject({ originalText: preview.originalText, translatedText: '既存の訳', translationStatus: 'draft', sourceIcons: draft.region.sourceIcons })
  expect(after.candidates).toEqual(before.candidates)
  expect(s.store.assetDiscovery).toEqual(discovery)
  if (!draftProject)
    expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).cards[0]!.regions).toEqual(after.project.regions)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  if (!draftProject)
    expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(after)
  expect(JSON.stringify(s.store.assets)).toBe(assets)
  expect(s.runtime.pendingAssetWrites.value.has('asset-1')).toBe(true)
  expect(s.provider.dispose).not.toHaveBeenCalled()
  expect(bitmaps).toHaveLength(2)
  bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
})

it('permits positions only without initializing OCR, and makes duplicate application a no-op', async () => {
  const s = setup()
  const before = s.store.readCardCandidateEdit(s.editorId.value)
  expect(s.controller.applyPositions((await s.prepare())!)).toBe(true)
  expect(s.getProvider).not.toHaveBeenCalled()
  expect(s.editor.project.value.regions[0]).toMatchObject({ originalText: 'Keep original', translationStatus: 'reviewed' })
  const after = s.store.readCardCandidateEdit(s.editorId.value)
  expect(s.controller.applyPositions((await s.prepare())!)).toBe(false)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(after)
})

it('does not add Undo for identical OCR text and positions', async () => {
  const s = setup()
  const draft = (await s.prepare())!
  s.controller.apply((await s.controller.recognize(draft))!)
  s.editor.loadSavedProject(s.editor.project.value, s.cardId.value)
  expect(s.controller.apply((await s.controller.recognize((await s.prepare())!))!)).toBe(false)
  expect(s.editor.canUndo.value).toBe(false)
})

const changes = ['cancel', 'source-back', 'png-back', 'project-back', 'card-back', 'selection-back', 'edit-undo', 'external-back', 'approval', 'asset-name', 'busy-back', 'scope-back', 'unavailable', 'dispose'] as const
function change(s: ReturnType<typeof setup>, kind: typeof changes[number]) {
  if (kind === 'cancel')
    s.controller.cancel()
  if (kind === 'source-back') {
    const file = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['changed'], 'source.png')
    s.runtime.cardSourceFile.value = file
  }
  if (kind === 'png-back') {
    const writes = s.runtime.pendingAssetWrites.value
    s.runtime.setPendingAssetWrite('asset-1', new Blob(['changed']))
    s.runtime.pendingAssetWrites.value = writes
  }
  if (kind === 'project-back') {
    s.runtime.projectGeneration.value++
    s.runtime.projectGeneration.value--
  }
  if (kind === 'card-back') {
    const id = s.cardId.value
    s.cardId.value = 'other'
    s.cardId.value = id
  }
  if (kind === 'selection-back') {
    s.selectedId.value = 'other'
    s.selectedId.value = s.regionId
  }
  if (kind === 'edit-undo') {
    s.editor.updateRegion(s.regionId, { originalText: 'temporary' })
    s.editor.undo()
  }
  if (kind === 'external-back') {
    const before = s.store.activeCard
    s.store.updateCard(s.editorId.value, { ...before, regions: before.regions.map(region => ({ ...region, translatedText: 'External' })) })
    s.store.updateCard(s.editorId.value, before)
  }
  if (kind === 'approval') {
    const next = structuredClone(s.store.assetDiscovery!)
    next.occurrences[0]!.approval = null
    next.occurrences[0]!.decision = 'pending'
    s.store.setAssetDiscovery(next)
  }
  if (kind === 'asset-name')
    s.store.setAssets(s.store.assets.map(asset => ({ ...asset, name: 'renamed' })))
  if (kind === 'busy-back') {
    s.busy.value = true
    s.busy.value = false
  }
  if (kind === 'scope-back') {
    const value = s.dependency.value
    s.dependency.value = {}
    s.dependency.value = value
  }
  if (kind === 'unavailable')
    s.available.value = false
  if (kind === 'dispose')
    s.scope.stop()
}

it.each(changes)('discards delayed OCR after %s without writing or retaining its bitmap', async (kind) => {
  const s = setup()
  const draft = (await s.prepare())!
  const pending = deferred<OCRResult>()
  s.provider.recognize.mockReturnValueOnce(pending.promise)
  const task = s.controller.recognize(draft)
  await vi.waitFor(() => expect(s.provider.recognize).toHaveBeenCalledOnce())
  change(s, kind)
  const before = s.store.snapshot()
  pending.resolve(recognized())
  expect(await task).toBeNull()
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.preview.value).toBeNull()
  expect(s.controller.draft.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
  bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
})

it.each(changes)('refuses a completed preview after %s even if the old state returns', async (kind) => {
  const s = setup()
  const preview = (await s.controller.recognize((await s.prepare())!))!
  change(s, kind)
  const before = s.store.snapshot()
  expect(s.controller.preview.value).toBeNull()
  expect(() => s.controller.apply(preview)).toThrow('やり直し')
  expect(s.store.snapshot()).toEqual(before)
})

it('hashes existing manual icons too and rejects missing manual PNGs before decode', async () => {
  const s = setup()
  s.store.setAssets([...s.store.assets, { ...s.store.assets[0]!, id: 'manual', name: 'manual' }])
  s.editor.updateRegion(s.regionId, { sourceIcons: [{ id: 'manual', assetId: 'manual', x: 100, y: 30, width: 20, height: 20 }] })
  await expect(s.prepare()).rejects.toThrow('未読込')
  expect(createImageBitmap).not.toHaveBeenCalled()
  s.runtime.assetFiles.value = new Map(s.runtime.assetFiles.value).set('manual', new Blob(['manual PNG']))
  const draft = (await s.prepare())!
  expect(draft.region.sourceIcons).toHaveLength(2)
  s.runtime.assetFiles.value.set('manual', new Blob(['changed manual PNG']))
  expect(() => s.controller.applyPositions(draft)).toThrow('やり直し')
})

it.each(['missing-source', 'missing-png', 'unapproved', 'wrong-source', 'wrong-png', 'unsupported', 'dimensions', 'oversized', 'editor-mismatch', 'region-mismatch'] as const)('rejects %s during preparation without changing project data', async (reason) => {
  const s = setup()
  if (reason === 'missing-source')
    s.runtime.cardSourceFile.value = null
  if (reason === 'missing-png') {
    s.runtime.assetFiles.value = new Map()
    s.runtime.pendingAssetWrites.value = new Map()
  }
  if (reason === 'unapproved') {
    const state = structuredClone(s.store.assetDiscovery!)
    state.occurrences[0]!.decision = 'pending'
    state.occurrences[0]!.approval = null
    s.store.setAssetDiscovery(state)
  }
  if (reason === 'wrong-source')
    s.runtime.cardSourceFile.value = new File(['different source'], 'source.png')
  if (reason === 'wrong-png')
    s.runtime.setPendingAssetWrite('asset-1', new Blob(['different PNG']))
  if (reason === 'unsupported')
    vi.stubGlobal('createImageBitmap', undefined)
  if (reason === 'dimensions') {
    vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
      const bitmap = { width: 199, height: 240, close: vi.fn() }
      bitmaps.push(bitmap)
      return bitmap as unknown as ImageBitmap
    })
  }
  if (reason === 'oversized')
    vi.spyOn(s.runtime.cardSourceFile.value!, 'size', 'get').mockReturnValue(FILE_LIMITS.imageBytes + 1)
  if (reason === 'editor-mismatch')
    s.editorId.value = 'other'
  if (reason === 'region-mismatch')
    s.store.updateCard(s.cardId.value, { ...s.store.activeCard, regions: [] })
  const before = s.store.snapshot()
  await expect(s.prepare()).rejects.toThrow()
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.draft.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
  bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
})

it('retains a valid draft after OCR failure for retry or explicit position-only application', async () => {
  const s = setup()
  const draft = (await s.prepare())!
  s.provider.recognize.mockRejectedValueOnce(new Error('OCR unavailable'))
  const before = s.store.snapshot()
  await expect(s.controller.recognize(draft)).rejects.toThrow('OCR unavailable')
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.draft.value).toBe(draft)
  expect(s.controller.preview.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.controller.applyPositions(draft)).toBe(true)
  expect(s.editor.project.value.regions[0]!.originalText).toBe('Keep original')
})

it('rejects forged drafts/previews and preserves a valid preview on an edit-entry failure', async () => {
  const s = setup()
  const draft = (await s.prepare())!
  await expect(s.controller.recognize({ ...draft })).rejects.toThrow()
  const preview = (await s.controller.recognize(draft))!
  expect(() => s.controller.apply({ ...preview })).toThrow('確認画面')
  const edit = vi.spyOn(s.editor, 'updateRegion').mockImplementationOnce(() => {
    throw new Error('edit failure')
  })
  await expect(async () => s.controller.apply(preview)).rejects.toThrow('edit failure')
  expect(s.controller.preview.value).toBe(preview)
  edit.mockRestore()
  expect(s.controller.apply(preview)).toBe(true)
})

it('keeps a newer preparation intact when cancelled decoding finishes late', async () => {
  const s = setup()
  const pending = deferred<ImageBitmap>()
  vi.mocked(createImageBitmap).mockReturnValueOnce(pending.promise)
  const first = s.prepare()
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce())
  expect(await s.prepare()).toBeNull()
  s.controller.cancel()
  const second = (await s.prepare())!
  const late = { width: 200, height: 240, close: vi.fn() }
  pending.resolve(late as unknown as ImageBitmap)
  expect(await first).toBeNull()
  expect(late.close).toHaveBeenCalledOnce()
  expect(s.controller.draft.value).toBe(second)
  expect(s.controller.running.value).toBe(false)
})

it('checks the actual editor card at the final write even if the caller supplied an identical wrong card', async () => {
  const s = setup()
  s.editor.loadSavedProject(s.editor.project.value, 'identical-but-other-card')
  const before = s.store.snapshot()
  const draft = (await s.prepare())!
  expect(() => s.controller.applyPositions(draft)).toThrow('編集中のカード')
  expect(s.store.snapshot()).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
})

it('drops a provider initialized after cancellation without decoding or disposing it', async () => {
  const s = setup()
  const draft = (await s.prepare())!
  const pending = deferred<OCRProvider>()
  s.getProvider.mockReturnValueOnce(pending.promise)
  const task = s.controller.recognize(draft)
  s.controller.cancel()
  pending.resolve(s.provider)
  expect(await task).toBeNull()
  expect(createImageBitmap).toHaveBeenCalledOnce()
  expect(s.provider.recognize).not.toHaveBeenCalled()
  expect(s.provider.dispose).not.toHaveBeenCalled()
})

it('stops during source hashing when the project changes, before allocating an image', async () => {
  const s = setup()
  const pending = deferred<ArrayBuffer>()
  vi.spyOn(s.runtime.cardSourceFile.value!, 'arrayBuffer').mockReturnValueOnce(pending.promise)
  const task = s.prepare()
  s.runtime.projectGeneration.value++
  pending.resolve(new TextEncoder().encode('source').buffer)
  expect(await task).toBeNull()
  expect(createImageBitmap).not.toHaveBeenCalled()
  expect(s.controller.running.value).toBe(false)
})

it.each(['decode', 'provider', 'recognize'] as const)('discards a late %s rejection after cancellation', async (stage) => {
  const s = setup()
  const draft = (await s.prepare())!
  const pending = deferred<never>()
  const operation = stage === 'decode' ? vi.mocked(createImageBitmap) : stage === 'provider' ? s.getProvider : s.provider.recognize
  operation.mockClear()
  operation.mockReturnValueOnce(pending.promise)
  const task = s.controller.recognize(draft)
  await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
  s.controller.cancel()
  const before = s.store.snapshot()
  pending.reject(new Error('late failure'))
  expect(await task).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.controller.running.value).toBe(false)
  bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
})

it('rejects invalid selections before hashing or allocating images', async () => {
  const s = setup()
  for (const ids of [[], ['missing'], ['occurrence-1', 'occurrence-1'], Array.from({ length: 101 }, (_, i) => `${i}`)])
    await expect(s.controller.prepare(ids)).rejects.toThrow()
  expect(createImageBitmap).not.toHaveBeenCalled()
  expect(s.getProvider).not.toHaveBeenCalled()
})

it('keeps group-only changes and same-Blob save promotion valid without invalidating approval', async () => {
  const s = setup()
  const draft = (await s.prepare())!
  const discovery = structuredClone(s.store.assetDiscovery!)
  discovery.groups[0]!.name = 'Organized'
  s.store.setAssetDiscovery(discovery)
  const png = s.runtime.pendingAssetWrites.value.get('asset-1')!
  s.runtime.assetFiles.value = new Map(s.runtime.assetFiles.value).set('asset-1', png)
  s.runtime.pendingAssetWrites.value = new Map()
  expect(s.controller.draft.value).toBe(draft)
  expect(s.controller.applyPositions(draft)).toBe(true)
  expect(s.store.assetDiscovery!.groups[0]!.name).toBe('Organized')
  expect(s.store.assetDiscovery!.occurrences[0]!.approval).not.toBeNull()
})

it('ignores calls without a target, while externally busy, or after scope disposal', async () => {
  const s = setup()
  s.available.value = false
  expect(await s.prepare()).toBeNull()
  s.available.value = true
  s.busy.value = true
  expect(await s.prepare()).toBeNull()
  s.busy.value = false
  s.scope.stop()
  expect(await s.prepare()).toBeNull()
  expect(createImageBitmap).not.toHaveBeenCalled()
})
