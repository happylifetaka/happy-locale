// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createCardThumbnailBlobFromFile, deferred, editorRuntime, folderProjectExists, loadFolderProjectCardImage, loadFolderProjectCardThumbnail, mountEditor, pickProjectDirectory, seedProject, unmountEditor, writeFolderProjectCardThumbnail } from './helpers/card-editor'

describe('card editor thumbnails', () => {
  const directory = { name: 'cards' } as FileSystemDirectoryHandle
  const cached = new File(['cached'], 'cached.png')
  const generated = new File(['generated'], 'generated.png')
  const bitmap = { width: 100, height: 140, close: vi.fn() }

  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${crypto.randomUUID()}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.mocked(loadFolderProjectCardThumbnail).mockResolvedValue(cached)
    vi.mocked(loadFolderProjectCardImage).mockResolvedValue(new File(['image'], 'card.png'))
    vi.mocked(createCardThumbnailBlobFromFile).mockResolvedValue(generated)
    vi.mocked(writeFolderProjectCardThumbnail).mockResolvedValue(true)
  })

  async function setupThumbnails() {
    const { wrapper } = await mountEditor()
    editorRuntime().setDirectory(directory)
    seedProject()
    await nextTick()
    const list = wrapper.findComponent({ name: 'CardList' })
    return { wrapper, request: (id: string) => list.vm.$emit('request-thumbnail', id) }
  }

  it('limits concurrent reads to two and deduplicates queued and cached requests', async () => {
    const { request } = await setupThumbnails()
    const first = deferred<File | null>()
    const second = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    for (const id of ['one', 'one', 'two', 'three', 'three', 'missing'])
      request(id)
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(2)
    expect(editorRuntime().cardThumbnails.value.size).toBe(0)
    first.resolve(cached)
    await flushPromises()
    expect(vi.mocked(loadFolderProjectCardThumbnail).mock.calls.map(([, id]) => id)).toEqual(['one', 'two', 'three'])
    second.resolve(cached)
    await flushPromises()
    expect([...editorRuntime().cardThumbnails.value.keys()].sort()).toEqual(['one', 'three', 'two'])
    request('one')
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(3)
    expect(loadFolderProjectCardImage).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledTimes(3)
  })

  it.each(['missing', 'decode error', 'oversized', 'empty'] as const)('regenerates a %s cache and publishes and persists the result', async (kind) => {
    const { request } = await setupThumbnails()
    const close = vi.fn()
    if (kind === 'missing')
      vi.mocked(loadFolderProjectCardThumbnail).mockResolvedValueOnce(null)
    else if (kind === 'decode error')
      vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('broken cache'))
    else
      vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: kind === 'empty' ? 0 : 145, height: 140, close } as unknown as ImageBitmap)
    request('one')
    await flushPromises()
    expect(loadFolderProjectCardImage).toHaveBeenCalledWith(directory, expect.objectContaining({ id: 'one' }))
    expect(createCardThumbnailBlobFromFile).toHaveBeenCalledWith(expect.any(File), 100, 140)
    expect(writeFolderProjectCardThumbnail).toHaveBeenCalledWith(directory, 'one', generated)
    expect(URL.createObjectURL).toHaveBeenCalledWith(generated)
    expect(editorRuntime().cardThumbnails.value.has('one')).toBe(true)
    if (kind === 'oversized' || kind === 'empty')
      expect(close).toHaveBeenCalledOnce()
  })

  it('continues the queue after a read fails and lets that card be retried', async () => {
    const { request } = await setupThumbnails()
    const failed = deferred<File | null>()
    const busy = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(failed.promise).mockReturnValueOnce(busy.promise)
    request('one')
    request('two')
    request('three')
    failed.reject(new Error('read failed'))
    await flushPromises()
    expect(editorRuntime().cardThumbnails.value.has('one')).toBe(false)
    expect(editorRuntime().cardThumbnails.value.has('three')).toBe(true)
    request('one')
    busy.resolve(cached)
    await flushPromises()
    expect(editorRuntime().cardThumbnails.value.size).toBe(3)
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(4)
  })

  it.each(['directory', 'card removed', 'unmount'] as const)('discards late results after %s', async (change) => {
    const { request } = await setupThumbnails()
    const result = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(result.promise)
    request('one')
    if (change === 'directory') {
      editorRuntime().setDirectory({ name: 'other' } as FileSystemDirectoryHandle)
    }
    else if (change === 'card removed') {
      seedProject(['two'])
    }
    else {
      unmountEditor()
    }
    result.resolve(cached)
    await flushPromises()
    expect(editorRuntime().cardThumbnails.value.size).toBe(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(writeFolderProjectCardThumbnail).not.toHaveBeenCalled()
  })

  it('resets queued requests and ignores old generations even when reopening the same directory', async () => {
    const { request, wrapper } = await setupThumbnails()
    const first = deferred<File | null>()
    const second = deferred<File | null>()
    const current = deferred<File | null>()
    vi.mocked(loadFolderProjectCardThumbnail).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(current.promise)
    request('one')
    request('two')
    request('three')
    vi.mocked(pickProjectDirectory).mockResolvedValue(directory)
    vi.mocked(folderProjectExists).mockResolvedValue(false)
    wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('open-project')
    await flushPromises()
    seedProject()
    await nextTick()
    const newList = wrapper.findComponent({ name: 'CardList' })
    newList.vm.$emit('request-thumbnail', 'one')
    first.resolve(cached)
    await flushPromises()
    expect(editorRuntime().cardThumbnails.value.size).toBe(0)
    expect(vi.mocked(loadFolderProjectCardThumbnail).mock.calls.map(([, id]) => id)).toEqual(['one', 'two', 'one'])
    newList.vm.$emit('request-thumbnail', 'one')
    second.resolve(cached)
    await flushPromises()
    expect(loadFolderProjectCardThumbnail).toHaveBeenCalledTimes(3)
    current.resolve(generated)
    await flushPromises()
    expect([...editorRuntime().cardThumbnails.value.keys()]).toEqual(['one'])
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(generated)
  })
})
