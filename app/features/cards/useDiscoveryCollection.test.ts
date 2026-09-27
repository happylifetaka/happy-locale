import type { CardIconProposal } from '~/services/asset-discovery/collect'
import type { OCRProvider } from '~/services/ocr/types'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { collectCardIconCandidates } from '~/services/asset-discovery/collect'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from '~/services/asset-discovery/types'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { discoveryProject, discoveryProposal } from '../../../tests/fixtures/asset-discovery'
import { useDiscoveryCollection } from './useDiscoveryCollection'

vi.mock('~/services/asset-discovery/collect', () => ({ collectCardIconCandidates: vi.fn() }))
vi.mock('~/services/project/folder', () => ({ loadFolderProjectCardImage: vi.fn() }))
const cleanups: Array<() => void> = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(loadFolderProjectCardImage).mockReset().mockImplementation(async (_directory, card) => new File([card.id], `${card.id}.png`))
  vi.mocked(collectCardIconCandidates).mockReset().mockImplementation(async ({ card }) => {
    const proposal = discoveryProposal()
    proposal.cardId = card.id
    proposal.occurrences[0]!.id = `found-${card.id}`
    proposal.occurrences[0]!.cardId = card.id
    return proposal
  })
})
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
  const project = discoveryProject()
  delete project.assetDiscovery
  const base = project.cards[0]!
  project.cards = ['one', 'two', 'three'].map(id => ({ ...structuredClone(base), id, imagePath: `images/${id}.png` }))
  project.activeCardId = 'one'
  if (draft) {
    store.updateCard(null, project.cards[0]!)
    store.setCardOCRCandidates('one', base.ocrCandidates!)
  }
  else {
    store.replaceProject(project)
  }
  const runtime = useProjectRuntime()
  if (!draft)
    runtime.setDirectory({ name: 'synthetic-directory' } as FileSystemDirectoryHandle)
  runtime.cardSourceFile.value = new File(['visible image'], 'one.png')
  const cardId = ref('one')
  const busy = ref(false)
  const deletions = shallowRef<ReadonlySet<string>>(new Set())
  const settings = shallowRef({ ...DEFAULT_ICON_DISCOVERY_SETTINGS })
  const dependency = shallowRef({ editor: 'original' })
  const provider = { recognize: vi.fn(), dispose: vi.fn() }
  const getProvider = vi.fn(async (): Promise<OCRProvider> => provider)
  const scope = effectScope()
  const controller = scope.run(() => useDiscoveryCollection({
    store,
    runtime,
    getProvider,
    currentImageId: () => cardId.value,
    pendingDeletionIds: () => deletions.value,
    settings: () => settings.value,
    scope: () => [dependency.value],
    busy: () => busy.value,
  }))!
  cleanups.push(() => {
    scope.stop()
    runtime.dispose()
  })
  const start = () => controller.start(draft ? ['one'] : ['one', 'two', 'three'])
  return { store, project, runtime, provider, getProvider, controller, scope, start, cardId, busy, deletions, settings, dependency }
}

it.each([false, true])('collects into real Store without invalidating its own writes (draft=%s)', async (draft) => {
  const s = setup(draft)
  expect(s.getProvider).not.toHaveBeenCalled()
  const before = s.store.readCardCandidateEdit(draft ? null : 'one')
  const run = s.start()
  expect(s.controller.running.value).toBe(true)
  const result = (await run)!
  expect(result.staged.map(item => item.status)).toEqual(draft ? ['stored'] : ['stored', 'stored', 'stored'])
  expect(s.controller.result.value).toBe(result)
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.progress.value).toEqual({ total: draft ? 1 : 3, started: draft ? 1 : 3, cardId: null })
  expect(vi.mocked(collectCardIconCandidates).mock.calls[0]![0].file).toBe(s.runtime.cardSourceFile.value)
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(draft ? 0 : 2)
  expect(s.store.readCardCandidateEdit(draft ? null : 'one')).toEqual(before)
  expect(s.store.assetDiscovery!.occurrences).toHaveLength(draft ? 1 : 3)
  if (!draft)
    expect(parseFolderProject(serializeFolderProject(s.store.snapshot()!)).assetDiscovery).toEqual(s.store.assetDiscovery)
  expect(s.provider.dispose).not.toHaveBeenCalled()
})

it('keeps repeated collection as a separate comparison without rewriting review state', async () => {
  const s = setup()
  await s.start()
  const edited = structuredClone(s.store.assetDiscovery!)
  edited.occurrences[0]!.decision = 'excluded'
  s.store.setAssetDiscovery(edited)
  expect(s.controller.result.value).toBeNull()
  const before = s.store.snapshot()
  const write = vi.spyOn(s.store, 'setAssetDiscovery')
  const result = (await s.start())!
  expect(result.staged.every(item => item.status === 'review')).toBe(true)
  expect(write).not.toHaveBeenCalled()
  expect(s.store.snapshot()).toEqual(before)
})

it.each(['cancel', 'generation', 'directory-back', 'source-back', 'card-back', 'edit-undo', 'reload', 'delete-back', 'settings-back', 'scope-back', 'busy-back', 'dispose'] as const)('drops initialization results after %s and does not start a second shared OCR task', async (change) => {
  const s = setup()
  const waiting = deferred<OCRProvider>()
  s.getProvider.mockReturnValueOnce(waiting.promise)
  const pending = s.start()
  if (change === 'cancel')
    s.controller.cancel()
  if (change === 'generation')
    s.runtime.projectGeneration.value++
  if (change === 'directory-back') {
    const directory = s.runtime.directory.value
    s.runtime.directory.value = null
    s.runtime.directory.value = directory
  }
  if (change === 'source-back') {
    const file = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['different'], 'one.png')
    s.runtime.cardSourceFile.value = file
  }
  if (change === 'card-back') {
    s.cardId.value = 'two'
    s.cardId.value = 'one'
  }
  if (change === 'edit-undo') {
    s.store.updateCard('one', { ...s.project.cards[0]!, imageName: 'changed.png' })
    s.store.updateCard('one', s.project.cards[0]!)
  }
  if (change === 'reload')
    s.store.replaceProject(s.project)
  if (change === 'delete-back') {
    s.deletions.value = new Set(['two'])
    s.deletions.value = new Set()
  }
  if (change === 'settings-back') {
    const original = s.settings.value
    s.settings.value = { ...original, maximumCandidates: 3 }
    s.settings.value = original
  }
  if (change === 'scope-back') {
    const original = s.dependency.value
    s.dependency.value = { editor: 'changed' }
    s.dependency.value = original
  }
  if (change === 'busy-back') {
    s.busy.value = true
    s.busy.value = false
  }
  if (change === 'dispose')
    s.scope.stop()
  expect(s.controller.running.value).toBe(true)
  expect(await s.start()).toBeNull()
  waiting.resolve(s.provider)
  expect(await pending).toBeNull()
  expect(s.controller.running.value).toBe(false)
  expect(s.controller.result.value).toBeNull()
  expect(s.getProvider).toHaveBeenCalledOnce()
  expect(collectCardIconCandidates).not.toHaveBeenCalled()
  expect(s.store.assetDiscovery).toBeUndefined()
  expect(s.provider.dispose).not.toHaveBeenCalled()
})

it('keeps completed cards on cancellation and excludes the in-flight and queued cards', async () => {
  const s = setup()
  const started = deferred<void>()
  const pendingResult = deferred<CardIconProposal>()
  const original = vi.mocked(collectCardIconCandidates).getMockImplementation()!
  vi.mocked(collectCardIconCandidates).mockImplementation(async (options) => {
    if (options.card.id === 'two') {
      started.resolve()
      return pendingResult.promise
    }
    return original(options)
  })
  const run = s.start()
  await started.promise
  expect(s.controller.progress.value).toEqual({ total: 3, started: 2, cardId: 'two' })
  s.controller.cancel()
  expect(s.controller.cancelRequested.value).toBe(true)
  expect(await s.start()).toBeNull()
  pendingResult.resolve(discoveryProposal())
  const result = (await run)!
  expect(result.cancelled).toBe(true)
  expect(result.staged).toMatchObject([{ cardId: 'one', status: 'stored' }])
  expect(s.store.assetDiscovery!.occurrences.map(item => item.cardId)).toEqual(['one'])
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(1)
  vi.mocked(collectCardIconCandidates).mockImplementation(original)
  expect((await s.start())!.staged.map(item => item.status)).toEqual(['review', 'stored', 'stored'])
})

it('suppresses a late source load failure after project replacement', async () => {
  const s = setup()
  const started = deferred<void>()
  const file = deferred<File>()
  vi.mocked(loadFolderProjectCardImage).mockImplementationOnce(async () => {
    started.resolve()
    return file.promise
  })
  const run = s.start()
  await started.promise
  s.runtime.setDirectory(s.runtime.directory.value)
  s.store.replaceProject(s.project)
  file.reject(new Error('Late file failure'))
  expect(await run).toBeNull()
  expect(s.store.assetDiscovery).toBeUndefined()
  expect(s.controller.result.value).toBeNull()
})

it('continues after an independent file failure and keeps complete results', async () => {
  const s = setup()
  vi.mocked(loadFolderProjectCardImage).mockRejectedValueOnce(new Error('Missing second image'))
  const result = (await s.start())!
  expect(result.failures).toEqual([{ cardId: 'two', message: 'Missing second image' }])
  expect(result.staged.map(item => item.cardId)).toEqual(['one', 'three'])
  expect(s.controller.result.value).toBe(result)
})

it('restores the expected review signature after a failed Store write and continues other cards', async () => {
  const s = setup()
  const write = s.store.setAssetDiscovery
  vi.spyOn(s.store, 'setAssetDiscovery').mockImplementationOnce(() => {
    throw new Error('Synthetic Store failure')
  }).mockImplementation(write)
  const result = (await s.start())!
  expect(result.failures).toEqual([{ cardId: 'one', message: 'Synthetic Store failure' }])
  expect(result.staged.map(item => item.cardId)).toEqual(['two', 'three'])
  expect(s.controller.result.value).toBe(result)
})

it('loads the visible saved card from its folder when there is no current File', async () => {
  const s = setup()
  s.runtime.cardSourceFile.value = null
  expect((await s.start())!.staged).toHaveLength(3)
  expect(loadFolderProjectCardImage).toHaveBeenCalledTimes(3)
})

it('invalidates finished comparison proposals after source replacement without deleting saved candidates', async () => {
  const s = setup()
  await s.start()
  const before = s.store.snapshot()
  s.runtime.cardSourceFile.value = new File(['replacement'], 'one.png')
  expect(s.controller.result.value).toBeNull()
  expect(s.store.snapshot()).toEqual(before)
})

it.each(['edit', 'candidate', 'first-save'] as const)('invalidates draft collection after %s during initialization', async (change) => {
  const s = setup(true)
  const waiting = deferred<OCRProvider>()
  s.getProvider.mockReturnValueOnce(waiting.promise)
  const run = s.start()
  if (change === 'edit')
    s.store.updateCard(null, { ...s.store.draftCard, imageName: 'changed.png' })
  if (change === 'candidate')
    s.store.setCardOCRCandidates('one', [])
  if (change === 'first-save')
    s.store.replaceProject(s.project)
  waiting.reject(new Error('Obsolete initialization error'))
  expect(await run).toBeNull()
  expect(s.store.assetDiscovery).toBeUndefined()
  expect(collectCardIconCandidates).not.toHaveBeenCalled()
})

it('stops after a manual review change during collection, without reverting that change', async () => {
  const s = setup()
  const original = vi.mocked(collectCardIconCandidates).getMockImplementation()!
  vi.mocked(collectCardIconCandidates).mockImplementation(async (options) => {
    if (options.card.id === 'two') {
      const next = structuredClone(s.store.assetDiscovery!)
      next.occurrences[0]!.decision = 'excluded'
      s.store.setAssetDiscovery(next)
    }
    return original(options)
  })
  expect(await s.start()).toBeNull()
  expect(s.store.assetDiscovery!.occurrences).toMatchObject([{ cardId: 'one', decision: 'excluded' }])
  expect(s.store.assetDiscovery!.occurrences).toHaveLength(1)
})

it('reports a current provider failure, releases the running flag, and permits retry', async () => {
  const s = setup()
  s.getProvider.mockRejectedValueOnce(new Error('Initialization failed'))
  await expect(s.start()).rejects.toThrow('Initialization failed')
  expect(s.controller.running.value).toBe(false)
  expect(s.store.assetDiscovery).toBeUndefined()
  expect((await s.start())!.staged).toHaveLength(3)
})

it.each([[], ['one', 'one'], ['unknown']].map(ids => ({ ids })))('rejects invalid target selection $ids before initializing OCR', async ({ ids }) => {
  const s = setup()
  await expect(s.controller.start(ids)).rejects.toThrow()
  expect(s.getProvider).not.toHaveBeenCalled()
})

it.each(['busy', 'deleted', 'folder', 'source'] as const)('does not initialize OCR when prerequisite %s is unavailable', async (kind) => {
  const s = setup(kind === 'source')
  if (kind === 'busy')
    s.busy.value = true
  if (kind === 'deleted')
    s.deletions.value = new Set(['one'])
  if (kind === 'folder')
    s.runtime.directory.value = null
  if (kind === 'source')
    s.runtime.cardSourceFile.value = null
  if (kind === 'busy')
    expect(await s.start()).toBeNull()
  else
    await expect(s.start()).rejects.toThrow()
  expect(s.getProvider).not.toHaveBeenCalled()
})
