import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../fixtures/asset-discovery'

beforeEach(() => setActivePinia(createPinia()))

it.each([false, true])('retains old coordinates when image dimensions shrink and invalidates approval/ownership (draft=%s)', (draft) => {
  const store = useProjectStore()
  const project = discoveryProject()
  if (draft) {
    store.updateCard(null, project.cards[0]!)
    store.setCardOCRCandidates(project.activeCardId, project.cards[0]!.ocrCandidates!)
    store.setAssets(project.assets)
    store.setAssetDiscovery(project.assetDiscovery!, project.activeCardId)
  }
  else {
    store.replaceProject(project)
  }
  store.updateCard(draft ? null : project.activeCardId, { ...store.activeCard, imageWidth: 30, imageHeight: 30 })
  expect(store.assetDiscovery!.occurrences[0]).toMatchObject({
    bounds: project.assetDiscovery!.occurrences[0]!.bounds,
    imageSize: { width: 200, height: 240 },
    owner: null,
    approval: null,
    decision: 'pending',
  })
  if (!draft)
    expect(parseFolderProject(serializeFolderProject(store.document!)).assetDiscovery).toEqual(store.assetDiscovery)
})

it('validates and detaches updates, preserving the prior document on invalid input', () => {
  const store = useProjectStore()
  const project = discoveryProject()
  store.replaceProject({ ...project, assetDiscovery: undefined })
  const before = savedProjectSignature(store.document!)
  store.setAssetDiscovery(project.assetDiscovery!)
  expect(savedProjectSignature(store.document!)).not.toBe(before)
  project.assetDiscovery!.groups[0]!.name = 'Outside mutation'
  expect(store.assetDiscovery!.groups[0]!.name).toBe('Synthetic group')
  const snapshot = store.snapshot()!
  const invalid = structuredClone(project.assetDiscovery!)
  invalid.occurrences[0]!.bounds.x = Number.NaN
  expect(() => store.setAssetDiscovery(invalid)).toThrow('アイコン候補')
  expect(() => store.replaceProject({ ...project, assetDiscovery: invalid })).toThrow('アイコン候補')
  expect(store.snapshot()).toEqual(snapshot)
})

it('acknowledges only saved state while retaining review edits made during writing', () => {
  const store = useProjectStore()
  store.replaceProject(discoveryProject())
  const saved = store.snapshot()!
  const changed = structuredClone(saved.assetDiscovery!)
  changed.groups[0]!.name = 'During save'
  store.setAssetDiscovery(changed)
  store.acceptSavedProject(saved, new Set())
  expect(store.assetDiscovery).toEqual(changed)
  expect(savedProjectSignature(store.document!)).not.toBe(savedProjectSignature(saved))
  expect(parseFolderProject(serializeFolderProject(store.document!)).assetDiscovery).toEqual(changed)
})

it('retains first-save draft review edits and clears draft resources after binding or project reset', () => {
  const store = useProjectStore()
  const saved = discoveryProject()
  store.updateCard(null, saved.cards[0]!)
  store.setCardOCRCandidates(saved.activeCardId, saved.cards[0]!.ocrCandidates!)
  store.setAssets(saved.assets)
  expect(() => store.setAssetDiscovery(saved.assetDiscovery!)).toThrow('カードを指定')
  store.setAssetDiscovery(saved.assetDiscovery!, saved.activeCardId)
  const changed = structuredClone(saved.assetDiscovery!)
  changed.groups[0]!.name = 'Draft changed during save'
  store.setAssetDiscovery(changed)
  store.acceptSavedProject(saved, new Set())
  expect(store.assetDiscovery).toEqual(changed)
  expect(store.draftAssetDiscovery).toBeUndefined()
  expect(savedProjectSignature(store.document!)).not.toBe(savedProjectSignature(saved))
  store.clearProject()
  expect(store.assetDiscovery).toBeUndefined()
  expect(store.draftAssetDiscovery).toBeUndefined()
})

it.each([false, true])('unassigns deleted assets without deleting candidates or changing source regions (draft=%s)', (draft) => {
  const store = useProjectStore()
  const project = discoveryProject()
  if (draft) {
    store.updateCard(null, project.cards[0]!)
    store.setCardOCRCandidates(project.activeCardId, project.cards[0]!.ocrCandidates!)
    store.setAssets(project.assets)
    store.setAssetDiscovery(project.assetDiscovery!, project.activeCardId)
  }
  else {
    store.replaceProject(project)
  }
  store.setAssets([])
  expect(store.assetDiscovery!.occurrences[0]).toMatchObject({ assetId: null, approval: null, decision: 'pending' })
  expect(store.assetDiscovery!.groups[0]!.proposedAssetId).toBeNull()
  expect(store.assetDiscovery!.occurrences).toHaveLength(1)
  expect(store.activeCard.regions).toEqual([])
  if (!draft)
    expect(() => serializeFolderProject(store.document!)).not.toThrow()
})

it('promotes candidate ownership before clearing OCR candidates and orphans it on undo without losing approval', () => {
  const store = useProjectStore()
  const project = discoveryProject()
  store.replaceProject(project)
  const editor = useCardEditor((id, card) => store.updateCard(id, card))
  editor.loadSavedProject(project.cards[0]!, project.activeCardId)
  const candidate = project.cards[0]!.ocrCandidates![0]!
  const [regionId] = editor.addRegions([{ bounds: candidate, backgroundColor: '#fff', originalText: candidate.text }])
  store.reconcileDiscoveryOwners(project.activeCardId, new Map([[candidate.id, regionId!]]))
  store.setCardOCRCandidates(project.activeCardId, null)
  expect(store.assetDiscovery!.occurrences[0]!.owner).toEqual({ kind: 'region', id: regionId })
  expect(store.activeCard.regions[0]!.sourceIcons).toBeUndefined()
  expect(() => serializeFolderProject(store.document!)).not.toThrow()
  editor.undo()
  expect(store.assetDiscovery!.occurrences[0]).toMatchObject({ owner: null, decision: 'accepted' })
  expect(store.assetDiscovery!.groups).toEqual(project.assetDiscovery!.groups)
  editor.redo()
  expect(store.assetDiscovery!.occurrences[0]!.owner).toBeNull()
  expect(() => serializeFolderProject(store.document!)).not.toThrow()
})

it('reconciles candidate resize/discard and saved card deletions without deleting surviving occurrences', () => {
  const store = useProjectStore()
  const project = discoveryProject()
  project.cards.push({ ...project.cards[0]!, id: 'other', imagePath: 'images/other.png' })
  store.replaceProject(project)
  store.setCardOCRCandidates(project.activeCardId, [{ ...project.cards[0]!.ocrCandidates![0]!, width: 10 }])
  expect(store.assetDiscovery!.occurrences[0]!.owner).toBeNull()
  store.setCardOCRCandidates(project.activeCardId, null)
  expect(store.assetDiscovery!.occurrences).toHaveLength(1)
  store.acceptSavedProject({ ...project, activeCardId: 'other', cards: [project.cards[1]!] }, new Set([project.activeCardId]))
  expect(store.document!.activeCardId).toBe('other')
  expect(store.assetDiscovery).toEqual({ occurrences: [], groups: [] })
  expect(() => serializeFolderProject(store.document!)).not.toThrow()
})
