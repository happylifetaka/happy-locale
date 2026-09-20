import type { CardProject } from '~/types/editor'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { adoptRegionProposal, compareRegionProposal } from '~/services/asset-discovery/region-proposal'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../fixtures/asset-discovery'

beforeEach(() => setActivePinia(createPinia()))

function setup(draft = false) {
  const store = useProjectStore()
  const document = discoveryProject()
  const cardId = draft ? null : document.activeCardId
  if (draft) {
    const { imageName, imageWidth, imageHeight, regions } = document.cards[0]!
    store.updateCard(null, { imageName, imageWidth, imageHeight, regions })
    store.setCardOCRCandidates(document.activeCardId, document.cards[0]!.ocrCandidates!)
    store.setAssets(document.assets)
    store.setAssetDiscovery(document.assetDiscovery!, document.activeCardId)
  }
  else {
    store.replaceProject(document)
  }
  const publish = vi.fn((id: string | null, project: CardProject) => store.updateCard(id, project))
  const apply = vi.fn(store.applyCardCandidateEdit)
  const editor = useCardEditor(publish, { read: store.readCardCandidateEdit, apply })
  editor.loadSavedProject(store.activeCard, cardId ?? undefined)
  editor.addRegion({ x: 10, y: 150, width: 180, height: 70 }, '#123456')
  const regionId = editor.selectedRegionId.value!
  editor.updateRegion(regionId, {
    originalText: 'Preserve original',
    translatedText: '既存の訳',
    translationStatus: 'reviewed',
    sourceIcons: [{ id: 'icon', assetId: 'asset-1', x: 30, y: 20, width: 10, height: 10 }],
    exclusionAreas: [{ id: 'protected', x: 50, y: 20, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 6, points: [{ x: 70, y: 25 }] }],
  })
  editor.loadSavedProject(editor.project.value, cardId ?? undefined)
  editor.selectedRegionId.value = regionId
  const before = store.readCardCandidateEdit(cardId)
  const afterCandidates = structuredClone(before.candidates)
  afterCandidates[0]!.width += 10
  const addition = { id: 'new-candidate', x: 165, y: 5, width: 20, height: 10, confidence: 95, text: 'New', selected: true, lines: [] }
  afterCandidates.push(addition)
  const changes = [{ id: regionId, bounds: { x: 8, y: 148, width: 184, height: 74 } }]
  publish.mockClear()
  return { store, editor, publish, apply, cardId, regionId, before, changes, afterCandidates, document, addition }
}

it.each([false, true])('applies confirmed bounds and candidates in one publication and Undo/Redo (draft=%s)', (draft) => {
  const s = setup(draft)
  const observations: unknown[] = []
  const stop = watch(() => [s.store.activeCard.regions, s.store.document?.cards[0]?.ocrCandidates ?? s.store.draftOCRCandidates], value => observations.push(structuredClone(value)), { flush: 'sync' })
  const discovery = structuredClone(s.store.assetDiscovery)
  const assets = structuredClone(s.store.assets)
  s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates)
  if (draft) {
    expect(s.store.$state.draftEditState.card.regions).toEqual(s.editor.project.value.regions)
    expect(s.store.$state.draftEditState.candidates).toEqual(s.afterCandidates)
  }
  expect(observations).toHaveLength(1)
  expect(s.apply).toHaveBeenCalledOnce()
  expect(s.publish).not.toHaveBeenCalled()
  expect(s.editor.selectedRegionId.value).toBe(s.regionId)
  const after = s.store.readCardCandidateEdit(s.cardId)
  expect(after.candidates).toEqual(s.afterCandidates)
  expect(after.project.regions.at(-1)).toMatchObject({ ...s.changes[0]!.bounds, originalText: 'Preserve original', translatedText: '既存の訳', translationStatus: 'reviewed', sourceIcons: [{ x: 32, y: 22 }], exclusionAreas: [{ x: 52, y: 22 }] })
  expect(after.project.regions.at(-1)!.manualMaskStrokes[0]!.points[0]).toEqual({ x: 72, y: 27 })
  expect(s.store.assetDiscovery).toEqual(discovery)
  expect(s.store.assets).toEqual(assets)
  s.afterCandidates[0]!.text = 'Caller mutation'
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.cardId)).toEqual(s.before)
  expect(s.editor.canUndo.value).toBe(false)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.cardId)).toEqual(after)
  stop()
})

it('adopts mixed comparison choices without replacing text or immediately confirming new candidates', () => {
  const s = setup()
  const card = s.store.document!.cards[0]!
  const scope = { imageDigest: 'a'.repeat(64), revision: 1, session: Symbol('review') }
  const detected = [
    { ...s.afterCandidates[0]!, id: 'detected-candidate', text: 'New OCR candidate text' },
    { ...s.addition, id: 'detected-region', ...s.changes[0]!.bounds, text: 'New OCR region text' },
    s.addition,
  ]
  const review = compareRegionProposal(card, { cardId: card.id, imageDigest: scope.imageDigest, imageWidth: card.imageWidth, imageHeight: card.imageHeight, candidates: detected }, scope)
  const next = adoptRegionProposal(card, review, [
    { action: 'bounds', detectedId: 'detected-candidate', target: { id: 'candidate-1', kind: 'candidate' } },
    { action: 'bounds', detectedId: 'detected-region', target: { id: s.regionId, kind: 'region' } },
    { action: 'add-candidate', detectedId: 'new-candidate' },
  ], scope)
  const signature = savedProjectSignature(s.store.snapshot()!)
  s.editor.applyRegionDetection([{ id: s.regionId, bounds: next.regions.find(region => region.id === s.regionId)! }], card.ocrCandidates!, next.ocrCandidates!)
  expect(s.editor.project.value.regions).toEqual(next.regions)
  expect(s.store.document!.cards[0]!.ocrCandidates).toEqual(next.ocrCandidates)
  expect(s.editor.project.value.regions).toHaveLength(card.regions.length)
  expect(savedProjectSignature(s.store.snapshot()!)).not.toBe(signature)
  expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).cards[0]!.ocrCandidates).toEqual(next.ocrCandidates)
  s.editor.undo()
  expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
})

it('keeps candidate-only edits in order with ordinary text edits and subsequent mixed edits', () => {
  const s = setup()
  s.editor.applyRegionDetection([], s.before.candidates, s.afterCandidates)
  s.editor.updateRegion(s.regionId, { translatedText: '次の訳' })
  const currentCandidates = s.store.readCardCandidateEdit(s.cardId).candidates
  const nextCandidates = structuredClone(currentCandidates)
  nextCandidates[0]!.height -= 5
  s.editor.applyRegionDetection(s.changes, currentCandidates, nextCandidates)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.cardId).candidates).toEqual(currentCandidates)
  expect(s.editor.project.value.regions.at(-1)!.translatedText).toBe('次の訳')
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.cardId).candidates).toEqual(currentCandidates)
  expect(s.editor.project.value.regions.at(-1)!.translatedText).toBe('既存の訳')
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.cardId)).toEqual(s.before)
  s.editor.redo()
  s.editor.redo()
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.cardId).candidates).toEqual(nextCandidates)
})

it.each(['stale-candidates', 'stale-region', 'outside', 'duplicate', 'delete', 'text', 'selected', 'clipped-icon', 'write-failure'] as const)('rejects %s without partial writes or consuming history', (kind) => {
  const s = setup()
  if (kind === 'stale-candidates')
    s.store.setCardOCRCandidates(s.cardId!, [])
  if (kind === 'stale-region')
    s.store.updateCard(s.cardId, { ...s.store.activeCard, regions: [] })
  if (kind === 'outside')
    s.afterCandidates[0]!.width = 1000
  if (kind === 'duplicate')
    s.afterCandidates[1]!.id = s.afterCandidates[0]!.id
  if (kind === 'delete')
    s.afterCandidates.shift()
  if (kind === 'text')
    s.afterCandidates[0]!.text = 'Replacement text'
  if (kind === 'selected')
    s.afterCandidates[0]!.selected = false
  if (kind === 'clipped-icon')
    s.changes[0]!.bounds.width = 20
  if (kind === 'write-failure')
    s.apply.mockImplementationOnce(() => { throw new Error('write failed') })
  const original = s.store.snapshot()
  expect(() => s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates)).toThrow()
  expect(s.store.snapshot()).toEqual(original)
  expect(s.editor.project.value).toEqual(s.before.project)
  expect(s.editor.canUndo.value).toBe(false)
  expect(s.editor.canRedo.value).toBe(false)
  expect(s.publish).not.toHaveBeenCalled()
})

it('preserves unrelated external candidate edits, but refuses Undo/Redo over edits to the affected candidate', () => {
  const s = setup()
  s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates)
  const unrelated = { ...s.addition, id: 'unrelated', text: 'Keep my edit' }
  s.store.setCardOCRCandidates(s.cardId!, [...s.afterCandidates, unrelated])
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.cardId).candidates).toEqual([...s.before.candidates, unrelated])
  const changed = { ...s.before.candidates[0]!, selected: false }
  s.store.setCardOCRCandidates(s.cardId!, [changed, unrelated])
  expect(() => s.editor.redo()).toThrow(/OCR候補/)
  expect(s.editor.canRedo.value).toBe(true)
  expect(s.editor.project.value).toEqual(s.before.project)
  s.store.setCardOCRCandidates(s.cardId!, [...s.before.candidates, unrelated])
  s.editor.redo()
  const now = s.store.readCardCandidateEdit(s.cardId)
  s.store.setCardOCRCandidates(s.cardId!, now.candidates.map(item => item.id === 'new-candidate' ? { ...item, text: 'Edited new candidate' } : item))
  const beforeUndo = s.store.snapshot()
  expect(() => s.editor.undo()).toThrow(/OCR候補/)
  expect(s.store.snapshot()).toEqual(beforeUndo)
  expect(s.editor.canUndo.value).toBe(true)
})

it('does not consume a no-op or clear redo, and retains mixed history across card switches', () => {
  const s = setup()
  s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates)
  s.editor.undo()
  s.apply.mockClear()
  s.editor.applyRegionDetection([], s.before.candidates, s.before.candidates)
  expect(s.apply).not.toHaveBeenCalled()
  expect(s.editor.canRedo.value).toBe(true)
  s.editor.switchSavedProject('other', { ...s.before.project, regions: [] })
  s.editor.switchSavedProject(s.cardId!, s.before.project)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.cardId).candidates).toEqual(s.afterCandidates)
})

it('retains draft mixed history across the first save and binds it to the saved card', () => {
  const s = setup(true)
  s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates)
  s.store.acceptSavedProject(s.document, new Set())
  s.editor.bindSavedCard(s.document.activeCardId)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.document.activeCardId)).toEqual(s.before)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.document.activeCardId).candidates).toEqual(s.afterCandidates)
})

it('invalidates an owner whose candidate frame shrinks without deleting the icon or silently reassigning it on Undo', () => {
  const s = setup()
  const after = [{ ...s.before.candidates[0]!, width: 20 }]
  s.editor.applyRegionDetection(s.changes, s.before.candidates, after)
  const occurrence = s.store.assetDiscovery!.occurrences[0]!
  expect(occurrence.owner).toBeNull()
  expect(occurrence.bounds).toEqual(s.document.assetDiscovery!.occurrences[0]!.bounds)
  s.editor.undo()
  expect(s.store.assetDiscovery!.occurrences[0]!.owner).toBeNull()
  expect(s.store.readCardCandidateEdit(s.cardId)).toEqual(s.before)
})

it('refuses a different expected card even if its geometry and candidate values are identical', () => {
  const s = setup()
  const before = s.store.snapshot()
  expect(() => s.editor.applyRegionDetection(s.changes, s.before.candidates, s.afterCandidates, 'other-card')).toThrow(/カード/)
  expect(s.store.snapshot()).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
})
