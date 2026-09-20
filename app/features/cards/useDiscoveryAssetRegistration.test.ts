// @vitest-environment happy-dom
import type { DiscoveryImageIdentity } from './useDiscoveryImageIdentity'
import type { AssetCreationDraft } from '~/types/editor'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, ref, shallowRef, toRef } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useEditorAssets } from '~/composables/useEditorAssets'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../../../tests/fixtures/asset-discovery'
import { useDiscoveryAssetRegistration } from './useDiscoveryAssetRegistration'
import { useDiscoveryReview } from './useDiscoveryReview'

const cleanups: Array<() => void> = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
})

function setup() {
  const store = useProjectStore()
  const project = discoveryProject()
  project.assetDiscovery!.occurrences.push({ ...structuredClone(project.assetDiscovery!.occurrences[0]!), id: 'occurrence-2' })
  project.assetDiscovery!.groups[0]!.memberIds.push('occurrence-2')
  store.replaceProject(project)
  const runtime = useProjectRuntime()
  const source = document.createElement('img')
  Object.defineProperties(source, { naturalWidth: { value: 200 }, naturalHeight: { value: 240 } })
  runtime.replaceCardImage({ element: source, file: new File(['original'], 'source.png'), url: 'blob:source' })
  const cardId = ref(project.activeCardId)
  const busy = ref(false)
  const verified = shallowRef<DiscoveryImageIdentity | null>({ cardId: cardId.value, imageDigest: 'a'.repeat(64), assetDigests: new Map([['asset-1', 'b'.repeat(64)]]), errors: new Map() })
  const callbacks: Array<{ canvas: HTMLCanvasElement, finish: BlobCallback }> = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, finish) {
    callbacks.push({ canvas: this, finish })
  })
  let review!: ReturnType<typeof useDiscoveryReview>
  let registration!: ReturnType<typeof useDiscoveryAssetRegistration>
  let assets!: ReturnType<typeof useEditorAssets>
  let create!: ReturnType<typeof vi.fn<ReturnType<typeof useEditorAssets>['createSourceIconAsset']>>
  const editor = useCardEditor((id, card) => store.updateCard(id, card))
  editor.loadSavedProject(project.cards[0]!, cardId.value)
  editor.addRegion({ x: 10, y: 20, width: 170, height: 100 }, '#fff')
  editor.updateRegion(editor.selectedRegionId.value!, { originalText: 'Original', translatedText: '既存の訳', sourceIcons: [{ id: 'manual', assetId: 'asset-1', x: 30, y: 30, width: 20, height: 20 }] })
  const wrapper = mount(defineComponent({
    setup() {
      assets = useEditorAssets({ editor, projectStore: store, projectRuntime: runtime, assets: toRef(store, 'assets'), folderDocument: toRef(store, 'document'), assetSourceImage: runtime.cardImage, assetSourceImageId: cardId, assetEditing: ref(false), maskEditing: ref(false), exclusionEditing: ref(false), setMessage: vi.fn(), logDiagnostic: vi.fn() })
      review = useDiscoveryReview({
        store,
        scope: () => [runtime.projectGeneration.value, runtime.cardSourceFile.value, runtime.assetFiles.value, runtime.pendingAssetWrites.value],
        context: () => ({ cards: store.document!.cards, assetIds: new Set(store.assets.map(asset => asset.id)), imageDigests: new Map([[cardId.value, verified.value?.imageDigest ?? '']]), assetDigests: verified.value?.assetDigests ?? new Map() }),
      })
      create = vi.fn(assets.createSourceIconAsset)
      registration = useDiscoveryAssetRegistration({ store, runtime, currentImageId: cardId, identity: { currentIdentity: () => verified.value }, review, createAsset: create, busy: () => busy.value })
      return () => null
    },
  }))
  cleanups.push(() => {
    wrapper.unmount()
    runtime.dispose()
  })
  const draft: AssetCreationDraft = { editingAssetId: null, name: 'discovered', sourceRect: { x: 38, y: 48, width: 24, height: 24 }, removeBackground: true, backgroundColor: null, backgroundThreshold: 48, edgeFeather: 12, manualMaskStrokes: [] }
  return { store, runtime, cardId, busy, verified, callbacks, draft, review, registration, assets, create, wrapper, source, editor }
}

it('registers the representative PNG through the existing pipeline, links only that occurrence, and keeps it on review undo', async () => {
  const s = setup()
  const regions = structuredClone(s.store.activeCard.regions)
  const state = structuredClone(s.store.assetDiscovery!)
  const task = s.registration.register('occurrence-1', s.draft, { groupId: 'group-1' })
  expect(s.registration.running.value).toBe(true)
  expect(s.store.assets).toHaveLength(1)
  const png = new Blob(['generated PNG'], { type: 'image/png' })
  const { canvas, finish } = s.callbacks[0]!
  finish(png)
  const result = (await task)!
  expect(result.linked).toBe(true)
  expect(s.registration.running.value).toBe(false)
  expect(s.store.assets).toHaveLength(2)
  expect(result.asset.sourceRect).toEqual(s.draft.sourceRect)
  expect(s.runtime.pendingAssetWrites.value.get(result.asset.id)).toBe(png)
  expect(s.runtime.assetImages.value.get(result.asset.id)).toBe(canvas)
  expect(canvas.width).toBe(24)
  expect(s.store.assetDiscovery!.occurrences[0]).toMatchObject({ assetId: result.asset.id, decision: 'pending', approval: null, bounds: state.occurrences[0]!.bounds })
  expect(s.store.assetDiscovery!.occurrences[1]).toEqual(state.occurrences[1])
  expect(s.store.assetDiscovery!.groups[0]!.proposedAssetId).toBe(result.asset.id)
  expect(s.review.undo()).toBe(true)
  expect(s.store.assetDiscovery).toEqual(state)
  expect(s.store.assets).toContainEqual(result.asset)
  expect(s.runtime.pendingAssetWrites.value.get(result.asset.id)).toBe(png)
  expect(s.review.redo()).toBe(true)
  expect(s.store.assetDiscovery!.occurrences[0]!.approval).toBeNull()
  expect(s.store.activeCard.regions).toEqual(regions)
})

it('rejects a second registration while its PNG is pending', async () => {
  const s = setup()
  const first = s.registration.register('occurrence-1', s.draft)
  expect(await s.registration.register('occurrence-1', s.draft)).toBeNull()
  expect(s.create).toHaveBeenCalledOnce()
  s.callbacks[0]!.finish(new Blob(['png']))
  expect((await first)!.linked).toBe(true)
})

it.each(['cancel', 'card', 'source', 'generation', 'review', 'draft', 'request', 'dispose', 'busy'] as const)('discards pending registration after %s changes and releases only the unregistered canvas', async (kind) => {
  const s = setup()
  const current = ref(true)
  const task = s.registration.register('occurrence-1', s.draft, { isCurrent: () => current.value })
  const { canvas, finish } = s.callbacks[0]!
  if (kind === 'cancel')
    s.registration.cancel()
  if (kind === 'card')
    s.cardId.value = 'another'
  if (kind === 'source') {
    const source = s.runtime.cardSourceFile.value
    s.runtime.cardSourceFile.value = new File(['different'], 'source.png')
    s.runtime.cardSourceFile.value = source
  }
  if (kind === 'generation')
    s.runtime.setDirectory(null)
  if (kind === 'review')
    s.review.editGroup('group-1', { name: 'Changed while generating' })
  if (kind === 'draft')
    s.draft.sourceRect.x++
  if (kind === 'request')
    current.value = false
  if (kind === 'dispose')
    s.wrapper.unmount()
  if (kind === 'busy')
    s.busy.value = true
  finish(new Blob(['png']))
  expect(await task).toBeNull()
  expect(s.store.assets).toHaveLength(1)
  expect(s.runtime.pendingAssetWrites.value.size).toBe(0)
  expect([canvas.width, canvas.height]).toEqual([1, 1])
  expect(s.registration.running.value).toBe(false)
})

it('allows retry after cancellation without an older PNG completion clearing the newer running request', async () => {
  const s = setup()
  const first = s.registration.register('occurrence-1', s.draft)
  s.registration.cancel()
  const second = s.registration.register('occurrence-1', s.draft)
  s.callbacks[0]!.finish(new Blob(['old']))
  expect(await first).toBeNull()
  expect(s.registration.running.value).toBe(true)
  s.callbacks[1]!.finish(new Blob(['new']))
  expect((await second)!.linked).toBe(true)
  expect(s.store.assets).toHaveLength(2)
})

it.each(['unknown-source', 'changed-source', 'excluded', 'wrong-representative', 'outside', 'unrelated', 'recrop', 'duplicate-name'] as const)('refuses %s before allocating a PNG', async (kind) => {
  const s = setup()
  if (kind === 'unknown-source')
    s.verified.value = null
  if (kind === 'changed-source')
    s.verified.value = { ...s.verified.value!, imageDigest: 'f'.repeat(64) }
  if (kind === 'excluded')
    s.review.change('occurrence-1', { kind: 'decision', decision: 'excluded' })
  if (kind === 'outside')
    s.draft.sourceRect.x = 195
  if (kind === 'unrelated')
    s.draft.sourceRect.x = 100
  if (kind === 'recrop')
    s.draft.editingAssetId = 'asset-1'
  if (kind === 'duplicate-name')
    s.draft.name = 'synthetic-icon'
  await expect(s.registration.register(kind === 'wrong-representative' ? 'occurrence-2' : 'occurrence-1', s.draft, { groupId: 'group-1' })).rejects.toThrow()
  expect(s.callbacks).toHaveLength(0)
  expect(s.store.assets).toHaveLength(1)
  expect(s.registration.running.value).toBe(false)
})

it('releases a failed PNG canvas and allows a successful retry', async () => {
  const s = setup()
  const first = s.registration.register('occurrence-1', s.draft)
  s.callbacks[0]!.finish(null)
  await expect(first).rejects.toThrow('アセット画像')
  expect(s.callbacks[0]!.canvas.width).toBe(1)
  expect(s.registration.running.value).toBe(false)
  const retry = s.registration.register('occurrence-1', s.draft)
  s.callbacks[1]!.finish(new Blob(['png']))
  expect((await retry)!.linked).toBe(true)
})

it('keeps an already registered shared asset but warns instead of linking a stale candidate after commit', async () => {
  const s = setup()
  s.create.mockImplementationOnce(async (...args) => {
    const asset = await s.assets.createSourceIconAsset(...args)
    s.review.editGroup('group-1', { name: 'Changed after PNG commit' })
    return asset
  })
  const task = s.registration.register('occurrence-1', s.draft, { groupId: 'group-1' })
  s.callbacks[0]!.finish(new Blob(['png']))
  const result = (await task)!
  expect(result.linked).toBe(false)
  expect(result.warning).toContain('登録済み')
  expect(s.store.assets).toContainEqual(result.asset)
  expect(s.store.assetDiscovery!.occurrences[0]!.assetId).toBe('asset-1')
  expect(s.store.assetDiscovery!.groups[0]!.name).toBe('Changed after PNG commit')
})

it('keeps the registered PNG when linking fails, and reports the partial result explicitly', async () => {
  const s = setup()
  vi.spyOn(s.review, 'linkAsset').mockImplementationOnce(() => {
    throw new Error('Link failed')
  })
  const before = structuredClone(s.store.assetDiscovery)
  const task = s.registration.register('occurrence-1', s.draft)
  const png = new Blob(['png'])
  s.callbacks[0]!.finish(png)
  const result = (await task)!
  expect(result).toMatchObject({ linked: false, warning: expect.stringContaining('Link failed') })
  expect(s.store.assetDiscovery).toEqual(before)
  expect(s.store.assets).toContainEqual(result.asset)
  expect(s.runtime.pendingAssetWrites.value.get(result.asset.id)).toBe(png)
})

it('does not link a completed registration into a different project opened before the result is consumed', async () => {
  const s = setup()
  s.create.mockImplementationOnce(async (...args) => {
    const asset = await s.assets.createSourceIconAsset(...args)
    s.runtime.setDirectory(null)
    s.store.replaceProject(discoveryProject())
    return asset
  })
  const task = s.registration.register('occurrence-1', s.draft)
  s.callbacks[0]!.finish(new Blob(['png']))
  expect(await task).toBeNull()
  expect(s.store.assets).toHaveLength(1)
  expect(s.store.assetDiscovery!.occurrences[0]!.assetId).toBe('asset-1')
})

it('ignores a late failed registration after cancellation', async () => {
  const s = setup()
  let fail!: (error: Error) => void
  s.create.mockImplementationOnce(() => new Promise((_, reject) => {
    fail = reject
  }))
  const task = s.registration.register('occurrence-1', s.draft)
  s.registration.cancel()
  fail(new Error('Late failure'))
  expect(await task).toBeNull()
  await flushPromises()
  expect(s.registration.running.value).toBe(false)
  expect(s.store.assets).toHaveLength(1)
})
