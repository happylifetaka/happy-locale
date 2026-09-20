// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { useProjectStore } from '~/stores/project'
import { discoveryProject } from '../fixtures/asset-discovery'
import { editorRuntime, mountSavedEditor, openFolderProject } from './helpers/card-editor'

it('marks changed PNG approvals unsaved after opening, without changing source text or source-icon masks', async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close: vi.fn() })))
  const { toolbar, project } = await mountSavedEditor(false)
  const cache = createImageDigestCache()
  const source = new File(['source bytes'], 'one.png', { type: 'image/png' })
  const oldAsset = new File(['old asset bytes'], 'asset-1.png', { type: 'image/png' })
  const newAsset = new File(['changed asset bytes'], 'asset-1.png', { type: 'image/png' })
  const fixture = discoveryProject()
  const state = fixture.assetDiscovery!
  const occurrence = state.occurrences[0]!
  occurrence.cardId = 'one'
  occurrence.imageSize = { width: 100, height: 140 }
  occurrence.owner = null
  occurrence.imageDigest = await cache.digest(source)
  occurrence.approval!.imageDigest = occurrence.imageDigest
  occurrence.approval!.assetDigest = await cache.digest(oldAsset)
  const document = { ...project, assets: fixture.assets, assetDiscovery: state }
  vi.mocked(openFolderProject).mockResolvedValueOnce({
    directory: editorRuntime().directory.value!,
    document,
    card: document.cards[0]!,
    imageFile: source,
    assetFiles: new Map([['asset-1', newAsset]]),
  })
  toolbar.vm.$emit('open-project')
  await flushPromises()
  await vi.waitFor(() => expect(useProjectStore().assetDiscovery!.occurrences[0]!.decision).toBe('pending'))
  expect(useProjectStore().assetDiscovery!.occurrences[0]!.approval).toBeNull()
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  expect(useProjectStore().activeCard.regions).toEqual([])
  expect(editorRuntime().assetFiles.value.get('asset-1')).toBe(newAsset)
})
