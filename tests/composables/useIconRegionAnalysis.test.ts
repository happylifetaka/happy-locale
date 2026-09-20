import type { DiscoveryWorkspaceOptions } from '~/features/cards/useDiscoveryWorkspace'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useIconRegionAnalysis } from '~/features/cards/useIconRegionAnalysis'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/asset-discovery/analyze-regions', () => ({ analyzeIconRegions: vi.fn() }))
const cleanup: (() => void)[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(analyzeIconRegions).mockReset()
})
afterEach(() => {
  cleanup.splice(0).forEach(stop => stop())
  vi.unstubAllGlobals()
})
function setup() {
  const store = useProjectStore()
  const project = discoveryProject()
  project.cards[0]!.regions = [regionFromCandidate(project.cards[0]!.ocrCandidates![0]!, 0)]
  delete project.cards[0]!.ocrCandidates
  project.assetDiscovery!.occurrences[0]!.owner = null
  store.replaceProject(project)
  const runtime = useProjectRuntime()
  runtime.cardSourceFile.value = new File(['image'], 'synthetic.png')
  runtime.assetFiles.value = new Map([['asset-1', new Blob(['old asset'])]])
  runtime.pendingAssetWrites.value = new Map([['asset-1', new Blob(['new asset'])]])
  const editor = useCardEditor((id, card) => store.updateCard(id, card), { read: store.readCardCandidateEdit, apply: store.applyCardCandidateEdit })
  editor.loadSavedProject(store.activeCard, project.activeCardId)
  const scope = effectScope()
  const options: DiscoveryWorkspaceOptions = { store, runtime, editor, currentImageId: ref(project.activeCardId), busy: ref(false), ocrRunning: ref(false), pendingDeletionIds: ref(new Set<string>()), provider: { recognize: vi.fn(), dispose: vi.fn() }, selectCard: vi.fn(), createAsset: vi.fn(), identity: {} as DiscoveryWorkspaceOptions['identity'] }
  const bitmap = { width: 200, height: 240, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  const model = scope.run(() => useIconRegionAnalysis(options))!
  cleanup.push(() => scope.stop())
  const region = JSON.parse(JSON.stringify(editor.project.value.regions[0]!))
  const result = { rows: [{ before: region, region: { ...region, originalText: 'Gain [icon:synthetic-icon]' }, iconCount: 1 }], warnings: [] }
  vi.mocked(analyzeIconRegions).mockResolvedValue(result)
  return { store, runtime, editor, options, model, result, scope, bitmap }
}

it('previews without writing, uses real pending PNG digest, applies explicitly, and closes its bitmap', async () => {
  const s = setup()
  const before = s.store.snapshot()
  await s.model.analyze()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.model.rows.value).toHaveLength(1)
  const context = vi.mocked(analyzeIconRegions).mock.calls[0]![0]
  const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await s.runtime.pendingAssetWrites.value.get('asset-1')!.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
  expect(context.assetDigests.get('asset-1')).toBe(expected)
  expect(s.bitmap.close).toHaveBeenCalledOnce()
  expect(s.model.apply([s.result.rows[0]!.region.id])).toBe(true)
  expect(s.store.activeCard.regions[0]!.originalText).toContain('[icon:')
  s.editor.undo()
  expect(s.store.snapshot()).toEqual(before)
  expect(s.options.provider.dispose).not.toHaveBeenCalled()
})

it.each(['card', 'file', 'generation', 'region-undo', 'stored-region-undo', 'group-undo', 'asset-undo', 'deletion-undo', 'busy-undo', 'cancel', 'dispose'] as const)('rejects %s even when the prior value is restored', async (reason) => {
  const s = setup()
  await s.model.analyze()
  const before = s.store.snapshot()
  if (reason === 'card') {
    const id = s.options.currentImageId.value
    s.options.currentImageId.value = 'other'
    s.options.currentImageId.value = id
  }
  if (reason === 'file') {
    const file = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['image'], 'synthetic.png')
    s.runtime.cardSourceFile.value = file
  }
  if (reason === 'generation')
    s.runtime.projectGeneration.value++
  if (reason === 'region-undo') {
    s.editor.updateRegion(s.result.rows[0]!.region.id, { originalText: 'changed' })
    s.editor.undo()
  }
  if (reason === 'stored-region-undo') {
    const old = s.store.activeCard
    s.store.updateCard(s.options.currentImageId.value, { ...old, regions: [] })
    s.store.updateCard(s.options.currentImageId.value, old)
  }
  if (reason === 'group-undo') {
    const old = s.store.assetDiscovery!
    s.store.setAssetDiscovery({ ...old, groups: old.groups.map(group => ({ ...group, name: 'changed' })) })
    s.store.setAssetDiscovery(old)
  }
  if (reason === 'asset-undo') {
    const old = s.runtime.pendingAssetWrites.value
    s.runtime.pendingAssetWrites.value = new Map([['asset-1', new Blob(['different'])]])
    s.runtime.pendingAssetWrites.value = old
  }
  if (reason === 'deletion-undo') {
    s.options.pendingDeletionIds.value.add(s.options.currentImageId.value)
    s.options.pendingDeletionIds.value.clear()
  }
  if (reason === 'busy-undo') {
    // The caller supplies a mutable ref exposed as readonly in the public contract.
    Object.assign(s.options.busy, { value: true })
    Object.assign(s.options.busy, { value: false })
  }
  if (reason === 'cancel')
    s.model.cancel()
  if (reason === 'dispose')
    s.scope.stop()
  expect(s.model.rows.value).toEqual([])
  expect(s.model.apply([s.result.rows[0]!.region.id])).toBe(false)
  expect(s.store.snapshot()).toEqual(before)
})

it('keeps the shared OCR lock until delayed cancellation finishes and discards the result', async () => {
  const s = setup()
  let finish!: (value: typeof s.result) => void
  vi.mocked(analyzeIconRegions).mockImplementation(() => new Promise((resolve) => {
    finish = resolve
  }))
  const before = s.store.snapshot()
  const pending = s.model.analyze()
  await vi.waitFor(() => expect(analyzeIconRegions).toHaveBeenCalledOnce())
  s.model.cancel()
  expect(s.options.ocrRunning.value).toBe(true)
  expect(s.model.running.value).toBe(true)
  await s.model.analyze()
  expect(analyzeIconRegions).toHaveBeenCalledOnce()
  finish(s.result)
  await pending
  expect(s.options.ocrRunning.value).toBe(false)
  expect(s.model.rows.value).toEqual([])
  expect(s.store.snapshot()).toEqual(before)
  expect(s.bitmap.close).toHaveBeenCalledOnce()
})
