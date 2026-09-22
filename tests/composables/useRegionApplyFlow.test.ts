import type { DiscoveryWorkspaceOptions } from '~/features/cards/useDiscoveryWorkspace'
import type { useQuickRegionApply } from '~/features/cards/useQuickRegionApply'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useRegionApplyFlow } from '~/features/cards/useRegionApplyFlow'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../fixtures/asset-discovery'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(stop => stop()))
function setup() {
  setActivePinia(createPinia())
  const store = useProjectStore()
  const project = discoveryProject()
  project.cards[0]!.regions = [{ id: 'existing' }] as typeof project.cards[0]['regions']
  project.cards.push({ ...project.cards[0]!, id: 'new', regions: [] })
  store.replaceProject(project)
  const runtime = useProjectRuntime()
  const currentImageId = ref(project.activeCardId)
  const pendingDeletionIds = ref(new Set<string>())
  const options: DiscoveryWorkspaceOptions = {
    store,
    runtime,
    editor: useCardEditor(),
    currentImageId,
    busy: ref(false),
    ocrRunning: ref(false),
    pendingDeletionIds,
    provider: { recognize: vi.fn(), dispose: vi.fn() },
    createAsset: vi.fn(),
    identity: {} as DiscoveryWorkspaceOptions['identity'],
    selectCard: vi.fn(async (id) => { currentImageId.value = id }),
  }
  const quickApply = { eligible: computed(() => store.document!.cards.filter(card => !options.pendingDeletionIds.value.has(card.id))), start: vi.fn().mockResolvedValue(undefined) } as unknown as ReturnType<typeof useQuickRegionApply>
  const ui = { discovery: options, quickApply, discoveryWorking: ref(false), iconAnalysisOpen: ref(false), switchView: vi.fn(), selectRegion: vi.fn().mockResolvedValue(undefined), setMessage: vi.fn() }
  const scope = effectScope()
  const flow = scope.run(() => useRegionApplyFlow(ui))!
  cleanups.push(() => {
    scope.stop()
    runtime.dispose()
  })
  return { options, ui, flow, store, runtime, pendingDeletionIds }
}

it('defaults to unfinished cards, accepts collection targets and never includes deleted cards', async () => {
  const s = setup()
  s.flow.openApplyTargets()
  expect(s.flow.applyTargetIds.value).toEqual(['new'])
  s.flow.openApplyTargets([s.options.currentImageId.value])
  expect(s.flow.applyTargetIds.value).toEqual([s.options.currentImageId.value])
  s.pendingDeletionIds.value = new Set(['new'])
  s.flow.openApplyTargets(['new'])
  expect(s.flow.applyTargetIds.value).toEqual([])
  await s.flow.applyTargetCards([s.options.currentImageId.value])
  expect(s.ui.quickApply.start).toHaveBeenCalledWith([s.options.currentImageId.value])
  expect(s.ui.switchView).toHaveBeenCalledWith('card')
  expect(s.flow.applyTargetIds.value).toBeNull()
})

it('routes issues to their exact region, occurrence or source comparison', async () => {
  const s = setup()
  const id = s.options.currentImageId.value
  s.flow.openApplyResults()
  expect(s.flow.applyResultsOpen.value).toBe(true)
  await s.flow.resolveApplyIssue(id, { message: 'text', regionId: 'existing', preview: true }, 'preview')
  expect(s.flow.applyResultsOpen.value).toBe(false)
  expect(s.flow.iconAnalysisRegionId.value).toBe('existing')
  expect(s.ui.iconAnalysisOpen.value).toBe(true)
  s.flow.openApplyResults()
  await s.flow.resolveApplyIssue(id, { message: 'bounds', regionId: 'existing' }, 'region')
  expect(s.flow.applyResultsOpen.value).toBe(false)
  expect(s.ui.selectRegion).toHaveBeenCalledWith(id, 'existing')
  const occurrence = s.store.assetDiscovery!.occurrences[0]!
  await s.flow.resolveApplyIssue(id, { message: 'icon', occurrenceId: occurrence.id }, 'discovery')
  expect(s.flow.discoveryFocus.value?.id).toBe(occurrence.id)
  expect(s.ui.switchView).toHaveBeenLastCalledWith('discovery')
  await s.flow.resolveApplyIssue(id, { message: 'stale', occurrenceId: 'missing' }, 'discovery')
  expect(s.ui.setMessage).toHaveBeenCalledWith(expect.stringContaining('変更済み'))
})

it('does not navigate while busy and rejects a delayed preview after a project change', async () => {
  const s = setup()
  s.ui.discoveryWorking.value = true
  s.flow.openApplyTargets()
  s.flow.openApplyResults()
  expect(s.flow.applyResultsOpen.value).toBe(false)
  await s.flow.previewCard('new')
  expect(s.flow.applyTargetIds.value).toBeNull()
  expect(s.options.selectCard).not.toHaveBeenCalled()
  s.ui.discoveryWorking.value = false
  s.flow.openApplyResults()
  let finish!: () => void
  vi.mocked(s.options.selectCard).mockImplementation(async (id) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    s.options.currentImageId.value = id
  })
  const pending = s.flow.previewCard('new')
  s.runtime.setDirectory({ name: 'different' } as FileSystemDirectoryHandle)
  await nextTick()
  finish()
  await pending
  expect(s.ui.iconAnalysisOpen.value).toBe(false)
  expect(s.flow.applyResultsOpen.value).toBe(false)
})
