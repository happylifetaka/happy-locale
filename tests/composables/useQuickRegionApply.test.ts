import type { DiscoveryWorkspaceOptions } from '~/features/cards/useDiscoveryWorkspace'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useQuickRegionApply } from '~/features/cards/useQuickRegionApply'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/asset-discovery/analyze-regions', () => ({ analyzeIconRegions: vi.fn() }))
vi.mock('~/services/project/folder', () => ({ loadFolderProjectCardImage: vi.fn() }))
const cleanups: (() => void)[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(analyzeIconRegions).mockReset()
  vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['second'], 'second.png'))
})
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop())
  vi.unstubAllGlobals()
})

function setup() {
  const store = useProjectStore()
  const project = discoveryProject()
  const first = project.cards[0]!
  const candidate = first.ocrCandidates![0]!
  first.ocrCandidates = [{ ...candidate, id: 'new-candidate', y: 150, height: 50 }, { ...candidate, id: 'unchecked', x: 170, y: 20, width: 20, selected: false }]
  const region = regionFromCandidate(candidate, 0)
  region.originalText = 'Original'
  region.translatedText = '既存訳'
  region.translationStatus = 'reviewed'
  first.regions = [region]
  project.assetDiscovery!.occurrences[0]!.owner = null
  project.cards.push({ ...structuredClone(first), id: 'second', imageName: 'second.png', imagePath: 'images/second.png' })
  store.replaceProject(project)
  const runtime = useProjectRuntime()
  runtime.directory.value = {} as FileSystemDirectoryHandle
  runtime.cardSourceFile.value = new File(['first'], 'first.png')
  runtime.assetFiles.value = new Map([['asset-1', new Blob(['asset'])]])
  const editor = useCardEditor((id, card) => store.updateCard(id, card), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
  editor.loadSavedProject(store.activeCard, first.id)
  const options: DiscoveryWorkspaceOptions = { store, runtime, editor, currentImageId: ref(first.id), busy: ref(false), ocrRunning: ref(false), pendingDeletionIds: ref(new Set<string>()), provider: { recognize: vi.fn(), dispose: vi.fn() }, selectCard: vi.fn(), createAsset: vi.fn(), identity: {} as DiscoveryWorkspaceOptions['identity'] }
  const bitmap = { width: 200, height: 240, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  const scope = effectScope()
  const message = vi.fn()
  const model = scope.run(() => useQuickRegionApply(options, message))!
  cleanups.push(() => scope.stop())
  vi.mocked(analyzeIconRegions).mockImplementation(async ({ card }) => ({
    rows: [
      { before: card.regions[0]!, region: { ...card.regions[0]!, originalText: 'Gain [icon:synthetic-icon]', sourceIcons: [{ id: 'discovery-icon', assetId: 'asset-1', x: 30, y: 30, width: 20, height: 20 }] }, iconCount: 1 },
      { before: null, region: regionFromCandidate(card.ocrCandidates![0]!, 1), candidateId: 'new-candidate', iconCount: 0 },
    ],
    warnings: [],
    issues: [],
    candidates: card.ocrCandidates ?? [],
  }))
  return { store, runtime, editor, options, model, bitmap, message, scope, first }
}

it('applies each card without switching, retains unchecked candidates and undoes each card independently', async () => {
  const s = setup()
  const beforeFirst = s.store.readCardCandidateEdit(s.first.id)
  const beforeSecond = s.store.readCardCandidateEdit('second')
  await s.model.start([s.first.id, 'second'])
  expect(s.options.selectCard).not.toHaveBeenCalled()
  expect(s.model.completed.value).toBe(2)
  expect(s.model.issues.value).toEqual([])
  expect(s.bitmap.close).toHaveBeenCalledTimes(2)
  expect(s.store.readCardCandidateEdit('second').project.regions[0]).toMatchObject({ translatedText: '既存訳', translationStatus: 'draft' })
  expect(s.store.readCardCandidateEdit('second').candidates.map(c => c.id)).toEqual(['unchecked'])
  expect(s.editor.project.value.imageName).toBe(s.first.imageName)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.first.id)).toEqual(beforeFirst)
  const secondAfter = s.store.readCardCandidateEdit('second')
  s.editor.switchSavedProject('second', secondAfter.project)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit('second')).toEqual(beforeSecond)
  s.editor.redo()
  expect(s.store.readCardCandidateEdit('second')).toEqual(secondAfter)
})

it('only processes selected eligible cards and explicitly enables original-text protection', async () => {
  const s = setup()
  const before = s.store.readCardCandidateEdit(s.first.id)
  await s.model.start(['second', 'missing'])
  expect(analyzeIconRegions).toHaveBeenCalledOnce()
  expect(vi.mocked(analyzeIconRegions).mock.calls[0]![0]).toMatchObject({ card: { id: 'second' }, preserveEditedText: true })
  expect(s.store.readCardCandidateEdit(s.first.id)).toEqual(before)
  expect(s.model.total.value).toBe(1)
})

it('retains other cards issues and replaces only the completed target result', async () => {
  const s = setup()
  const original = vi.mocked(analyzeIconRegions).getMockImplementation()!
  vi.mocked(analyzeIconRegions).mockImplementation(async (args) => {
    const result = await original(args)
    return { ...result, issues: [{ message: '確認が必要', regionId: args.card.regions[0]!.id }] }
  })
  await s.model.start([s.first.id])
  expect(s.model.issues.value.map(issue => issue.cardId)).toEqual([s.first.id])
  vi.mocked(analyzeIconRegions).mockImplementation(async args => ({ rows: [], warnings: [], issues: [], candidates: args.card.ocrCandidates ?? [] }))
  await s.model.start(['second'])
  expect(s.model.issues.value.map(issue => issue.cardId)).toEqual([s.first.id])
  expect(s.model.states.value.get(s.first.id)).toMatchObject({ status: 'applied', issues: 1 })
  await s.model.start([s.first.id])
  expect(s.model.issues.value).toEqual([])
  expect(s.model.states.value.get('second')).toMatchObject({ status: 'applied', issues: 0 })
})

it('keeps failed existing regions intact but adds failed new regions without unsafe icon changes', async () => {
  const s = setup()
  const previous = s.store.readCardCandidateEdit(s.first.id)
  const base = regionFromCandidate(previous.candidates[0]!, 1)
  vi.mocked(analyzeIconRegions).mockResolvedValue({ rows: [
    { before: previous.project.regions[0]!, region: { ...previous.project.regions[0]!, originalText: 'must not apply' }, iconCount: 0, error: '曖昧' },
    { before: null, candidateId: 'new-candidate', region: { ...base, y: base.y - 2, height: base.height + 2 }, boundsBefore: base, iconCount: 0, error: 'OCR失敗' },
  ], warnings: ['候補の位置を確認'], issues: [{ message: '候補の位置を確認' }], candidates: previous.candidates })
  await s.model.start([s.first.id])
  expect(s.store.activeCard.regions[0]).toEqual(previous.project.regions[0])
  expect(s.store.activeCard.regions[1]).toEqual({ ...base, sourceIcons: [] })
  expect(s.model.issues.value[0]!.messages).toHaveLength(3)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.first.id)).toEqual(previous)
})

it.each(['cancel', 'dispose', 'generation', 'card', 'asset', 'candidate', 'discovery', 'deletion', 'edit-undo'] as const)('discards delayed results after %s', async (reason) => {
  const s = setup()
  const original = vi.mocked(analyzeIconRegions).getMockImplementation()!
  vi.mocked(analyzeIconRegions).mockImplementation(async (args) => {
    const result = await original(args)
    if (reason === 'cancel')
      s.model.cancel()
    if (reason === 'dispose')
      s.scope.stop()
    if (reason === 'generation')
      s.runtime.projectGeneration.value++
    if (reason === 'card')
      s.options.currentImageId.value = 'second'
    if (reason === 'asset')
      s.runtime.assetFiles.value = new Map([['asset-1', new Blob(['changed'])]])
    if (reason === 'candidate')
      s.store.setCardOCRCandidates(s.first.id, [])
    if (reason === 'discovery')
      s.store.setAssetDiscovery({ occurrences: [], groups: [] })
    if (reason === 'deletion')
      s.options.pendingDeletionIds.value.add(s.first.id)
    if (reason === 'edit-undo') {
      s.editor.updateRegion(s.first.regions[0]!.id, { originalText: 'edited' })
      s.editor.undo()
    }
    return result
  })
  await s.model.start([s.first.id])
  expect(s.editor.project.value.regions).toEqual(s.first.regions)
  expect(s.bitmap.close).toHaveBeenCalledOnce()
  expect(s.model.running.value).toBe(false)
  expect(s.options.ocrRunning.value).toBe(false)
})

it('retains completed cards on cancellation and does not start the next card', async () => {
  const s = setup()
  const original = vi.mocked(analyzeIconRegions).getMockImplementation()!
  vi.mocked(analyzeIconRegions).mockImplementation(async (args) => {
    const result = await original(args)
    if (args.card.id === 'second')
      s.model.cancel()
    return result
  })
  const beforeSecond = s.store.readCardCandidateEdit('second')
  await s.model.start([s.first.id, 'second'])
  expect(s.model.completed.value).toBe(1)
  expect(s.store.activeCard.regions).toHaveLength(2)
  expect(s.store.readCardCandidateEdit('second')).toEqual(beforeSecond)
  expect(s.model.status.value).toContain('中止')
})

it('continues past card errors and skips cards already changed while queued', async () => {
  const s = setup()
  vi.mocked(analyzeIconRegions).mockImplementationOnce(async () => {
    const second = s.store.readCardCandidateEdit('second').project
    s.store.updateCard('second', { ...second, imageName: 'renamed.png' })
    throw new Error('synthetic OCR failure')
  })
  await s.model.start([s.first.id, 'second'])
  expect(analyzeIconRegions).toHaveBeenCalledOnce()
  expect(s.model.issues.value).toHaveLength(2)
  expect(s.model.completed.value).toBe(2)
})

it('latches edits restored during a later card, after publishing the first card', async () => {
  const s = setup()
  const original = vi.mocked(analyzeIconRegions).getMockImplementation()!
  const beforeSecond = s.store.readCardCandidateEdit('second')
  vi.mocked(analyzeIconRegions).mockImplementation(async (args) => {
    const result = await original(args)
    if (args.card.id === 'second') {
      s.store.updateCard('second', { ...beforeSecond.project, imageName: 'changed' })
      s.store.updateCard('second', beforeSecond.project)
    }
    return result
  })
  await s.model.start([s.first.id, 'second'])
  expect(s.model.issues.value).toHaveLength(1)
  expect(s.store.readCardCandidateEdit('second')).toEqual(beforeSecond)
  expect(s.store.activeCard.regions).toHaveLength(2)
})

it.each([true, false])('keeps newly detected unchecked candidates atomically, including no selected regions (selected=%s)', async (selected) => {
  const s = setup()
  const candidates = s.store.readCardCandidateEdit(s.first.id).candidates
  s.store.updateCard(s.first.id, { ...s.store.activeCard, regions: [] })
  s.store.setCardOCRCandidates(s.first.id, [])
  s.editor.loadSavedProject(s.store.activeCard, s.first.id)
  const before = s.store.readCardCandidateEdit(s.first.id)
  const found = selected ? candidates : candidates.map(c => ({ ...c, selected: false }))
  vi.mocked(analyzeIconRegions).mockResolvedValue({
    rows: selected ? [{ before: null, region: regionFromCandidate(found[0]!, 0), candidateId: found[0]!.id, iconCount: 0 }] : [],
    warnings: [],
    issues: [],
    candidates: found,
  })
  await s.model.start([s.first.id])
  expect(s.model.issues.value).toEqual([])
  expect(s.store.readCardCandidateEdit(s.first.id).candidates).toEqual(selected ? [found[1]] : found)
  expect(s.store.activeCard.regions).toHaveLength(selected ? 1 : 0)
  s.editor.undo()
  expect(s.store.readCardCandidateEdit(s.first.id)).toEqual(before)
})
