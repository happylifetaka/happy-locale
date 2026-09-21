import type { CardProject } from '~/types/editor'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../fixtures/asset-discovery'

beforeEach(() => setActivePinia(createPinia()))
function setup() {
  const store = useProjectStore()
  store.replaceProject(discoveryProject())
  const id = store.document!.activeCardId
  const editor = useCardEditor((id: string | null, project: CardProject) => store.updateCard(id, project), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
  editor.loadSavedProject(store.activeCard, id)
  editor.addRegion({ x: 10, y: 150, width: 180, height: 70 }, '#123456')
  const regionId = editor.project.value.regions[0]!.id
  editor.updateRegion(regionId, { originalText: 'Old original', translatedText: '既存訳', translationStatus: 'reviewed' })
  editor.loadSavedProject(editor.project.value, id)
  const before = JSON.parse(JSON.stringify(editor.project.value)) as CardProject
  const candidates = store.readCardCandidateEdit(id).candidates
  const updated = { ...before.regions[0]!, originalText: 'Gain [icon:synthetic-icon]', translatedText: 'must not replace', sourceIcons: [{ id: 'discovery-1', assetId: 'asset-1', x: 2, y: 2, width: 5, height: 5 }] }
  const added = regionFromCandidate(candidates[0]!, before.regions.length)
  return { store, editor, id, before, candidates, updated, added }
}

it('applies multiple regions and consumes candidates atomically with one Undo, preserving existing translation and geometry', () => {
  const s = setup()
  const snapshot = s.store.snapshot()
  s.editor.applyIconAnalysis(s.before, [s.updated, s.added], s.candidates, [], s.id)
  expect(s.store.activeCard.regions[0]).toEqual({ ...s.before.regions[0], originalText: s.updated.originalText, sourceIcons: s.updated.sourceIcons, translationStatus: 'draft' })
  expect(s.store.readCardCandidateEdit(s.id).candidates).toEqual([])
  expect(s.store.activeCard.regions.at(-1)).toEqual(s.added)
  // owner is a disposable hint; adopting its candidate clears this stale reference.
  const normalizedDiscovery = structuredClone(snapshot!.assetDiscovery!)
  normalizedDiscovery.occurrences[0]!.owner = null
  expect(s.store.assetDiscovery).toEqual(normalizedDiscovery)
  const saved = parseFolderProject(serializeFolderProject(s.store.snapshot()!))
  expect(saved.cards[0]!.regions[0]!.sourceIcons).toEqual(s.updated.sourceIcons)
  const after = s.store.snapshot()
  s.editor.undo()
  expect(s.store.snapshot()).toEqual({ ...snapshot, assetDiscovery: normalizedDiscovery })
  expect(s.editor.canUndo.value).toBe(false)
  s.editor.redo()
  expect(s.store.snapshot()).toEqual(after)
})

it.each(['stale-card', 'stale-project', 'stale-candidates', 'resize', 'outside-icon', 'duplicate'] as const)('rejects %s with no writes or history', (reason) => {
  const s = setup()
  let id = s.id
  if (reason === 'stale-card')
    id = 'other'
  if (reason === 'stale-project')
    s.before.imageName = 'old.png'
  if (reason === 'stale-candidates')
    s.store.setCardOCRCandidates(s.id, [])
  if (reason === 'resize')
    s.updated.width++
  if (reason === 'outside-icon')
    s.updated.sourceIcons[0]!.x = s.updated.width
  const snapshot = s.store.snapshot()
  expect(() => s.editor.applyIconAnalysis(s.before, reason === 'duplicate' ? [s.updated, s.updated] : [s.updated], s.candidates, [], id)).toThrow()
  expect(s.store.snapshot()).toEqual(snapshot)
  expect(s.editor.canUndo.value).toBe(false)
})

it('retains reviewed status when the source text is unchanged and supports position-only Undo', () => {
  const s = setup()
  s.updated.originalText = s.before.regions[0]!.originalText
  s.editor.applyIconAnalysis(s.before, [s.updated], s.candidates, s.candidates, s.id)
  expect(s.editor.project.value.regions[0]!.translationStatus).toBe('reviewed')
  s.editor.undo()
  expect(s.editor.project.value).toEqual(s.before)
})

it('commits minimal bounds expansion, positions and source text with one Undo/Redo', () => {
  const s = setup()
  s.updated.height = 73
  s.updated.sourceIcons = [{ id: 'discovery-1', assetId: 'asset-1', x: 30, y: 53, width: 20, height: 20 }]
  s.editor.applyIconAnalysis(s.before, [s.updated], s.candidates, s.candidates, s.id)
  const after = JSON.parse(JSON.stringify(s.editor.project.value)) as CardProject
  expect(after.regions[0]).toMatchObject({ height: 73, originalText: s.updated.originalText, translatedText: '既存訳', translationStatus: 'draft', sourceIcons: s.updated.sourceIcons })
  s.editor.undo()
  expect(s.editor.project.value).toEqual(s.before)
  expect(s.editor.canUndo.value).toBe(false)
  s.editor.redo()
  expect(s.editor.project.value).toEqual(after)
})

it('rejects an expansion into another region without partial writes', () => {
  const s = setup()
  s.editor.addRegion({ x: 10, y: 222, width: 20, height: 10 }, '#123456')
  s.editor.loadSavedProject(s.editor.project.value, s.id)
  const before = JSON.parse(JSON.stringify(s.editor.project.value)) as CardProject
  s.updated.height = 73
  s.updated.sourceIcons = [{ id: 'discovery-1', assetId: 'asset-1', x: 30, y: 53, width: 20, height: 20 }]
  expect(() => s.editor.applyIconAnalysis(before, [s.updated], s.candidates, s.candidates, s.id)).toThrow('重なります')
  expect(s.editor.project.value).toEqual(before)
  expect(s.editor.canUndo.value).toBe(false)
})

it('preserves absolute manual geometry when expanding left and top, including after Undo', () => {
  const s = setup()
  s.editor.updateRegion(s.updated.id, {
    sourceIcons: [{ id: 'manual', assetId: 'asset-1', x: 30, y: 30, width: 10, height: 10 }],
    exclusionAreas: [{ id: 'protected', x: 60, y: 30, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 4, points: [{ x: 90, y: 30 }] }],
  })
  s.editor.loadSavedProject(s.editor.project.value, s.id)
  const before = JSON.parse(JSON.stringify(s.editor.project.value)) as CardProject
  const proposal = { ...before.regions[0]!, x: 7, y: 147, width: 183, height: 73, originalText: 'Gain [icon:synthetic-icon]', sourceIcons: [
    { id: 'manual', assetId: 'asset-1', x: 33, y: 33, width: 10, height: 10 },
    { id: 'discovery-1', assetId: 'asset-1', x: 0, y: 0, width: 20, height: 20 },
  ] }
  s.editor.applyIconAnalysis(before, [proposal], s.candidates, s.candidates, s.id)
  expect(s.editor.project.value.regions[0]).toMatchObject({
    x: 7,
    y: 147,
    width: 183,
    height: 73,
    sourceIcons: proposal.sourceIcons,
    exclusionAreas: [{ id: 'protected', x: 63, y: 33, width: 10, height: 10 }],
    manualMaskStrokes: [{ brushSize: 4, points: [{ x: 93, y: 33 }] }],
    translatedText: '既存訳',
  })
  s.editor.undo()
  expect(s.editor.project.value).toEqual(before)
})

it('restores consumed candidates in their original order, keeping unrelated subsequent edits', () => {
  const s = setup()
  const candidates = ['first', 'middle', 'last'].map(id => ({ ...s.candidates[0]!, id }))
  s.store.setCardOCRCandidates(s.id, candidates)
  s.editor.applyIconAnalysis(s.before, [s.updated], candidates, [candidates[2]!], s.id)
  const edited = { ...candidates[2]!, text: 'User edit' }
  s.store.setCardOCRCandidates(s.id, [edited])
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.id).candidates).toEqual([candidates[0], candidates[1], edited])
  s.editor.redo()
  expect(s.store.readCardCandidateEdit(s.id).candidates).toEqual([edited])
})

it('rejects changes to unconsumed candidates before committing any region edits', () => {
  const s = setup()
  expect(() => s.editor.applyIconAnalysis(s.before, [s.updated], s.candidates, [{ ...s.candidates[0]!, text: 'wrong' }], s.id)).toThrow('残す候補')
  expect(s.editor.project.value).toEqual(s.before)
  expect(s.editor.canUndo.value).toBe(false)
})

it('rejects a changed stored region even when candidates are not consumed and the editor copy is unchanged', () => {
  const s = setup()
  s.store.updateCard(s.id, { ...s.store.activeCard, regions: [] })
  const snapshot = s.store.snapshot()
  expect(() => s.editor.applyIconAnalysis(s.before, [s.updated], s.candidates, s.candidates, s.id)).toThrow('変わりました')
  expect(s.store.snapshot()).toEqual(snapshot)
  expect(s.editor.project.value).toEqual(s.before)
  expect(s.editor.canUndo.value).toBe(false)
})
