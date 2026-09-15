// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { editorRuntime, mountSavedEditor, unmountEditor } from './helpers/card-editor'

async function setupAssetDraft() {
  const { wrapper } = await mountSavedEditor(false)
  editorRuntime().assetSourceImage.value = document.createElement('img')
  const callbacks: BlobCallback[] = []
  // このテストではラスタ処理を省き、ブラウザのPNG生成待ちを制御する。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callbacks.push(callback))
  await nextTick()
  const assets = wrapper.findComponent({ name: 'AssetEditor' })
  assets.vm.$emit('add', { x: 0, y: 0, width: 20, height: 20 })
  await nextTick()
  return { assets, callbacks, wrapper }
}

it('registers an asset only after its PNG is ready', async () => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  expect(useProjectStore().assets).toEqual([])
  callbacks[0]!(new Blob(['png'], { type: 'image/png' }))
  await flushPromises()
  expect(useProjectStore().assets).toHaveLength(1)
  expect(assets.props('creationDraft')).toBeNull()
})

it('does not register duplicate assets when confirmation is clicked twice while PNG generation is pending', async () => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  expect(callbacks).toHaveLength(1)
  expect(assets.props('creationRunning')).toBe(true)
  for (const callback of callbacks)
    callback(new Blob(['png'], { type: 'image/png' }))
  await flushPromises()
  expect(useProjectStore().assets).toHaveLength(1)
})

it('does not register an asset when its draft is cancelled while PNG generation is pending', async () => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  assets.vm.$emit('cancel-draft')
  await nextTick()
  expect(assets.props('creationDraft')).toBeNull()
  callbacks[0]!(new Blob(['png'], { type: 'image/png' }))
  await flushPromises()
  expect(useProjectStore().assets).toEqual([])
})

it.each(['draft', 'image', 'unmount'] as const)('ignores PNG completion after %s changes', async (change) => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  if (change === 'draft')
    assets.vm.$emit('update-draft', { name: 'new-name' })
  else if (change === 'image')
    editorRuntime().assetSourceImage.value = document.createElement('img')
  else
    unmountEditor()
  await nextTick()
  callbacks[0]!(new Blob(['png']))
  await flushPromises()
  expect(useProjectStore().assets).toEqual([])
  expect(editorRuntime().pendingAssetWrites.value.size).toBe(0)
})

it('keeps a new pending draft active when an older cancelled conversion completes', async () => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  assets.vm.$emit('cancel-draft')
  assets.vm.$emit('add', { x: 1, y: 1, width: 10, height: 10 })
  assets.vm.$emit('update-draft', { name: 'new-name' })
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  callbacks[0]!(new Blob(['old']))
  await flushPromises()
  expect(assets.props('creationRunning')).toBe(true)
  expect(useProjectStore().assets).toEqual([])
  callbacks[1]!(new Blob(['new']))
  await flushPromises()
  expect(useProjectStore().assets.map(asset => asset.name)).toEqual(['new-name'])
  expect(assets.props('creationRunning')).toBe(false)
})

it.each(['null', 'throw'] as const)('can retry after PNG creation returns %s', async (failure) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { assets, callbacks } = await setupAssetDraft()
  if (failure === 'throw')
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(() => { throw new Error('canvas failed') })
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  if (failure === 'null') {
    callbacks.shift()!(null)
    await flushPromises()
  }
  expect(assets.props('creationRunning')).toBe(false)
  expect(assets.props('creationDraft')).not.toBeNull()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  callbacks[0]!(new Blob(['png']))
  await flushPromises()
  expect(useProjectStore().assets).toHaveLength(1)
})

it('recrops an existing asset while retaining its id and layout settings, then removes its runtime resources', async () => {
  const { assets, callbacks } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  callbacks.shift()!(new Blob(['first']))
  await flushPromises()
  const original = useProjectStore().assets[0]!
  assets.vm.$emit('update', original.id, { scale: 2, baselineOffset: 3, inlinePadding: 4 })
  assets.vm.$emit('recrop', original.id)
  assets.vm.$emit('add', { x: 2, y: 3, width: 10, height: 11 })
  assets.vm.$emit('update-draft', { name: 'recropped' })
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  const replacement = new Blob(['replacement'])
  callbacks.shift()!(replacement)
  await flushPromises()
  expect(useProjectStore().assets).toEqual([expect.objectContaining({
    id: original.id,
    name: 'recropped',
    scale: 2,
    baselineOffset: 3,
    inlinePadding: 4,
    sourceRect: { x: 2, y: 3, width: 10, height: 11 },
  })])
  expect(editorRuntime().pendingAssetWrites.value.get(original.id)).toBe(replacement)
  expect(editorRuntime().assetImages.value.has(original.id)).toBe(true)
  assets.vm.$emit('remove', original.id)
  await nextTick()
  expect(useProjectStore().assets).toEqual([])
  expect(editorRuntime().pendingAssetWrites.value.has(original.id)).toBe(false)
  expect(editorRuntime().assetImages.value.has(original.id)).toBe(false)
})

it('rejects a duplicate name before converting a new asset', async () => {
  const { assets, callbacks, wrapper } = await setupAssetDraft()
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  callbacks.shift()!(new Blob(['first']))
  await flushPromises()
  const name = useProjectStore().assets[0]!.name
  assets.vm.$emit('add', { x: 0, y: 0, width: 5, height: 5 })
  assets.vm.$emit('update-draft', { name })
  assets.vm.$emit('confirm-draft')
  await flushPromises()
  expect(callbacks).toHaveLength(0)
  expect(useProjectStore().assets).toHaveLength(1)
  expect(wrapper.get('.notice').text()).toContain('既に')
})
