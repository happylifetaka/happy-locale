import type { RegionDetectionReviewRequest, RegionDetectionReviewTarget } from './useRegionDetectionReview'
import type { RegionProposalChoice } from '~/services/asset-discovery/region-proposal'
import type { RegionCandidate } from '~/types/ocr'
import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useRegionDetectionReview } from './useRegionDetectionReview'

const cleanups: Array<() => void> = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
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

function setup(draft = false) {
  const store = useProjectStore()
  const document = discoveryProject()
  const original = document.cards[0]!
  const { imageName, imageWidth, imageHeight, regions } = original
  if (draft) {
    store.updateCard(null, { imageName, imageWidth, imageHeight, regions })
    store.setCardOCRCandidates(original.id, original.ocrCandidates!)
  }
  else {
    store.replaceProject(document)
  }
  const editorId = ref<string | null>(draft ? null : original.id)
  const cardId = ref(original.id)
  const editor = useCardEditor((id, card) => store.updateCard(id, card), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
  editor.loadSavedProject(store.activeCard, editorId.value ?? undefined)
  editor.addRegion({ x: 10, y: 150, width: 180, height: 70 }, '#123456')
  const regionId = editor.selectedRegionId.value!
  editor.updateRegion(regionId, { originalText: 'Keep source', translatedText: '既存の訳', translationStatus: 'reviewed', sourceIcons: [{ id: 'icon', assetId: 'asset-1', x: 30, y: 20, width: 10, height: 10 }] })
  editor.loadSavedProject(editor.project.value, editorId.value ?? undefined)
  const runtime = useProjectRuntime()
  runtime.cardSourceFile.value = new File(['source'], 'source.png')
  const busy = ref(false)
  const available = ref(true)
  const dependency = shallowRef<object>({ setting: 'initial' })
  const target = (): RegionDetectionReviewTarget | null => {
    if (!available.value || (editorId.value !== null && !store.document?.cards.some(card => card.id === editorId.value)))
      return null
    const state = store.readCardCandidateEdit(editorId.value)
    return { editorCardId: editorId.value, card: { ...state.project, id: cardId.value, ocrCandidates: state.candidates } }
  }
  const detected: RegionCandidate[] = [
    { ...original.ocrCandidates![0]!, id: 'detected-candidate', width: 150, text: 'New candidate OCR' },
    { id: 'detected-region', x: 8, y: 148, width: 184, height: 74, text: 'New source OCR', confidence: 90, selected: true, lines: [] },
    { id: 'new-candidate', x: 165, y: 5, width: 20, height: 10, text: 'New', confidence: 95, selected: true, lines: [] },
  ]
  const choices: RegionProposalChoice[] = [
    { action: 'bounds', detectedId: 'detected-candidate', target: { id: 'candidate-1', kind: 'candidate' } },
    { action: 'bounds', detectedId: 'detected-region', target: { id: regionId, kind: 'region' } },
    { action: 'add-candidate', detectedId: 'new-candidate' },
  ]
  const detect = vi.fn(async (_request: RegionDetectionReviewRequest): Promise<readonly RegionCandidate[] | null> => detected)
  const scope = effectScope()
  const controller = scope.run(() => useRegionDetectionReview({ editor, runtime, target, detect, busy: () => busy.value, scope: () => [dependency.value] }))!
  cleanups.push(() => {
    scope.stop()
    runtime.dispose()
  })
  return { store, editor, runtime, busy, available, dependency, cardId, editorId, scope, controller, detect, target, detected, choices, regionId, document }
}

it.each([false, true])('stages differences without writes, then applies selected changes with one Undo (draft=%s)', async (draft) => {
  const s = setup(draft)
  const before = s.store.readCardCandidateEdit(s.editorId.value)
  const discovery = structuredClone(s.store.assetDiscovery)
  const review = await s.controller.analyze()
  expect(review).not.toBeNull()
  expect(s.controller.review.value).toBe(review)
  expect(s.controller.running.value).toBe(false)
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  const request = s.detect.mock.calls[0]![0]
  expect(request).toMatchObject({ file: s.runtime.cardSourceFile.value, cardId: s.cardId.value, imageWidth: 200, imageHeight: 240, imageDigest: createHash('sha256').update('source').digest('hex') })
  expect(request.isCurrent()).toBe(true)
  expect(Object.isFrozen(review)).toBe(true)
  const signature = !draft ? savedProjectSignature(s.store.snapshot()!) : null
  s.controller.apply(review!, s.choices)
  expect(s.controller.review.value).toBeNull()
  expect(request.isCurrent()).toBe(false)
  const after = s.store.readCardCandidateEdit(s.editorId.value)
  expect(after.project.regions.at(-1)).toMatchObject({ x: 8, y: 148, originalText: 'Keep source', translatedText: '既存の訳', translationStatus: 'reviewed', sourceIcons: [{ x: 32, y: 22 }] })
  expect(after.candidates[0]).toMatchObject({ id: 'candidate-1', width: 150, text: 'Synthetic effect.' })
  expect(after.candidates[1]!.id).toBe('new-candidate')
  expect(s.store.assetDiscovery).toEqual(discovery)
  if (!draft)
    expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).cards[0]!.ocrCandidates).toEqual(after.candidates)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  if (!draft)
    expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
  expect(() => s.controller.apply(review!, s.choices)).toThrow(/古い/)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.editorId.value)).toEqual(after)
})

it('preserves unselected regions and candidates, and keeps empty selections available', async () => {
  const s = setup()
  const before = s.store.snapshot()!
  const apply = vi.spyOn(s.editor, 'applyRegionDetection')
  const review = (await s.controller.analyze())!
  s.controller.apply(review, [])
  expect(apply).not.toHaveBeenCalled()
  expect(s.controller.review.value).toBe(review)
  s.controller.apply(review, [s.choices[1]!])
  expect(s.store.document!.cards[0]!.ocrCandidates).toEqual(before.cards[0]!.ocrCandidates)
  expect(s.editor.project.value.regions.at(-1)!.x).toBe(8)
  expect(apply).toHaveBeenCalledOnce()
})

it.each(['source', 'project', 'card', 'candidate', 'region', 'undo', 'busy', 'dependency', 'unavailable', 'dispose'] as const)('permanently rejects a review after %s changes, even if the old value is restored', async (kind) => {
  const s = setup()
  const review = (await s.controller.analyze())!
  if (kind === 'source') {
    const file = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['different'], 'source.png')
    s.runtime.cardSourceFile.value = file
  }
  if (kind === 'project') {
    s.runtime.projectGeneration.value++
    s.runtime.projectGeneration.value--
  }
  if (kind === 'card') {
    s.cardId.value = 'other'
    s.cardId.value = s.document.activeCardId
  }
  if (kind === 'candidate') {
    const candidates = s.target()!.card.ocrCandidates!
    s.store.setCardOCRCandidates(s.cardId.value, candidates.map(item => ({ ...item, selected: false })))
    s.store.setCardOCRCandidates(s.cardId.value, candidates)
  }
  if (kind === 'region') {
    const project = s.store.activeCard
    s.store.updateCard(s.cardId.value, { ...project, regions: project.regions.map(region => ({ ...region, originalText: 'External edit' })) })
    s.store.updateCard(s.cardId.value, project)
  }
  if (kind === 'undo') {
    s.editor.updateRegion(s.regionId, { translatedText: 'Temporary edit' })
    s.editor.undo()
  }
  if (kind === 'busy') {
    s.busy.value = true
    s.busy.value = false
  }
  if (kind === 'dependency') {
    const original = s.dependency.value
    s.dependency.value = {}
    s.dependency.value = original
  }
  if (kind === 'unavailable') {
    s.available.value = false
    s.available.value = true
  }
  if (kind === 'dispose')
    s.scope.stop()
  const current = s.store.snapshot()
  expect(s.controller.review.value).toBeNull()
  expect(() => s.controller.apply(review, s.choices)).toThrow(/古い/)
  expect(s.store.snapshot()).toEqual(current)
})

it('drops cancelled work during image hashing without starting detection', async () => {
  const s = setup()
  const bytes = deferred<ArrayBuffer>()
  vi.spyOn(s.runtime.cardSourceFile.value!, 'arrayBuffer').mockReturnValueOnce(bytes.promise)
  const work = s.controller.analyze()
  expect(s.controller.running.value).toBe(true)
  s.controller.cancel()
  bytes.resolve(await new Blob(['source']).arrayBuffer())
  expect(await work).toBeNull()
  expect(s.detect).not.toHaveBeenCalled()
  expect(s.controller.running.value).toBe(false)
})

it.each([
  ['resolve', false],
  ['reject', false],
  ['resolve', true],
  ['reject', true],
] as const)('ignores old detection %s after cancel/restart (new review ready=%s)', async (mode, newerReady) => {
  const s = setup()
  const old = deferred<readonly RegionCandidate[] | null>()
  const fresh = deferred<readonly RegionCandidate[] | null>()
  s.detect.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise)
  const first = s.controller.analyze()
  await vi.waitFor(() => expect(s.detect).toHaveBeenCalledOnce())
  expect(await s.controller.analyze()).toBeNull()
  s.controller.cancel()
  const second = s.controller.analyze()
  await vi.waitFor(() => expect(s.detect).toHaveBeenCalledTimes(2))
  let review
  if (newerReady) {
    fresh.resolve(s.detected)
    review = await second
  }
  if (mode === 'resolve')
    old.resolve(s.detected)
  else old.reject(new Error('late failure'))
  expect(await first).toBeNull()
  expect(s.controller.running.value).toBe(!newerReady)
  if (!newerReady) {
    fresh.resolve(s.detected)
    review = await second
  }
  expect(s.controller.review.value).toBe(review)
  expect(s.controller.running.value).toBe(false)
})

it('rejects pending results when candidates change, but permits a fresh retry', async () => {
  const s = setup()
  const pending = deferred<readonly RegionCandidate[] | null>()
  s.detect.mockImplementationOnce(() => pending.promise)
  const work = s.controller.analyze()
  await vi.waitFor(() => expect(s.detect).toHaveBeenCalledOnce())
  s.store.setCardOCRCandidates(s.cardId.value, [])
  pending.resolve(s.detected)
  expect(await work).toBeNull()
  expect(s.controller.review.value).toBeNull()
  expect((await s.controller.analyze())?.differences.some(item => item.status === 'new')).toBe(true)
})

it.each(['hash', 'detect', 'invalid-result'] as const)('reports current %s failures without writes and releases running for retry', async (kind) => {
  const s = setup()
  const before = s.store.snapshot()
  if (kind === 'hash')
    vi.spyOn(s.runtime.cardSourceFile.value!, 'arrayBuffer').mockRejectedValueOnce(new Error('hash failed'))
  if (kind === 'detect')
    s.detect.mockRejectedValueOnce(new Error('detection failed'))
  if (kind === 'invalid-result')
    s.detect.mockResolvedValueOnce([{ ...s.detected[0]!, width: Infinity }])
  await expect(s.controller.analyze()).rejects.toThrow()
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.review.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
  expect(await s.controller.analyze()).not.toBeNull()
})

it('retains a valid review after invalid choices or a failed atomic write so the user can retry', async () => {
  const s = setup()
  const review = (await s.controller.analyze())!
  const before = s.store.snapshot()
  expect(() => s.controller.apply(review, [s.choices[0]!, { action: 'add-candidate', detectedId: 'missing' }])).toThrow()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.controller.review.value).toBe(review)
  vi.spyOn(s.editor, 'applyRegionDetection').mockImplementationOnce(() => {
    throw new Error('write failed')
  })
  expect(() => s.controller.apply(review, s.choices)).toThrow('write failed')
  expect(s.controller.review.value).toBe(review)
  expect(s.store.snapshot()).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
  s.controller.apply(review, s.choices)
  expect(s.controller.review.value).toBeNull()
})

it('rejects copied and older review objects, while a fresh identical detection does not duplicate candidates', async () => {
  const s = setup()
  const first = (await s.controller.analyze())!
  const second = (await s.controller.analyze())!
  expect(() => s.controller.apply(first, s.choices)).toThrow()
  expect(() => s.controller.apply(structuredClone(second), s.choices)).toThrow()
  s.controller.apply(second, s.choices)
  const before = s.store.snapshot()
  const third = (await s.controller.analyze())!
  expect(() => s.controller.apply(third, [{ action: 'add-candidate', detectedId: 'new-candidate' }])).toThrow(/既存/)
  expect(s.store.snapshot()).toEqual(before)
})

it('does not analyze without a target/source or when unavailable, and handles detector cancellation', async () => {
  const s = setup()
  s.available.value = false
  expect(await s.controller.analyze()).toBeNull()
  s.available.value = true
  s.busy.value = true
  expect(await s.controller.analyze()).toBeNull()
  s.busy.value = false
  const file = s.runtime.cardSourceFile.value
  s.runtime.cardSourceFile.value = null
  await expect(s.controller.analyze()).rejects.toThrow(/元画像/)
  s.runtime.cardSourceFile.value = file
  s.detect.mockResolvedValueOnce(null)
  expect(await s.controller.analyze()).toBeNull()
  expect(s.controller.running.value).toBe(false)
  s.scope.stop()
  expect(await s.controller.analyze()).toBeNull()
})

it('stops before detection when the editor and target card have diverged', async () => {
  const s = setup()
  s.cardId.value = 'other'
  await expect(s.controller.analyze()).rejects.toThrow(/一致/)
  s.cardId.value = s.document.activeCardId
  s.store.updateCard(s.cardId.value, { ...s.store.activeCard, regions: [] })
  await expect(s.controller.analyze()).rejects.toThrow(/編集状態/)
  expect(s.detect).not.toHaveBeenCalled()
})
