// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, folderProjectExists, mountSavedEditor, openFolderProject, pickProjectDirectory, unmountEditor } from './helpers/card-editor'

const resources = vi.hoisted(() => ({ loadProjectAssetImages: vi.fn<typeof import('~/services/project/resources').loadProjectAssetImages>() }))
vi.mock('~/services/project/resources', () => resources)
beforeEach(() => resources.loadProjectAssetImages.mockResolvedValue(new Map()))

it('keeps the current project and undo history when opening another project fails', async () => {
  const { toolbar, canvas, inspector } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Keep edit' })
  vi.mocked(openFolderProject).mockRejectedValueOnce(new Error('invalid project'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(inspector.props('region').translatedText).toBe('Keep edit')
  expect(useProjectStore().document!.activeCardId).toBe('one')
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(inspector.props('region').translatedText).toBe('Before 0')
})

it('does not replace the project when directory selection is cancelled', async () => {
  const { toolbar } = await mountSavedEditor()
  const documentBefore = useProjectStore().document
  vi.mocked(pickProjectDirectory).mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
  toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(useProjectStore().document).toBe(documentBefore)
})

it('does not initialize a new folder if selection completes after unmount', async () => {
  const { toolbar } = await mountSavedEditor()
  const selected = deferred<FileSystemDirectoryHandle>()
  vi.mocked(pickProjectDirectory).mockReturnValueOnce(selected.promise)
  vi.mocked(folderProjectExists).mockResolvedValueOnce(false)
  toolbar.vm.$emit('open-project')
  await flushPromises()
  unmountEditor()
  const directoryBefore = editorRuntime().directory.value
  selected.resolve({ name: 'late' } as FileSystemDirectoryHandle)
  await flushPromises()
  expect(editorRuntime().directory.value).toBe(directoryBefore)
  expect(useProjectStore().document).toBeNull()
})

it('releases staged resources if assets finish loading after unmount', async () => {
  const { toolbar } = await mountSavedEditor()
  const loaded = deferred<Map<string, ImageBitmap>>()
  resources.loadProjectAssetImages.mockReturnValueOnce(loaded.promise)
  toolbar.vm.$emit('open-project')
  await flushPromises()
  unmountEditor()
  const close = vi.fn()
  loaded.resolve(new Map([['asset', { close } as unknown as ImageBitmap]]))
  await flushPromises()
  expect(useProjectStore().document).toBeNull()
  expect(editorRuntime().assetImages.value.size).toBe(0)
  expect(close).toHaveBeenCalledOnce()
})
