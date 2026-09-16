// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { useProjectStore } from '~/stores/project'
import { FILE_LIMITS } from '~/utils/file-limits'
import { editorRuntime, loadFolderProjectCardImage, mountSavedEditor } from './helpers/card-editor'

it.each(['format', 'size'] as const)('rejects invalid image %s before allocating a URL and preserves the current card', async (invalid) => {
  const { wrapper } = await mountSavedEditor()
  const file = new File(['image'], invalid === 'format' ? 'two.gif' : 'two.png', { type: invalid === 'format' ? 'image/gif' : 'image/png' })
  if (invalid === 'size')
    Object.defineProperty(file, 'size', { value: FILE_LIMITS.imageBytes + 1 })
  vi.mocked(loadFolderProjectCardImage).mockResolvedValueOnce(file)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const image = editorRuntime().cardImage.value
  const calls = vi.mocked(URL.createObjectURL).mock.calls.length
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(useProjectStore().document!.activeCardId).toBe('one')
  expect(editorRuntime().cardImage.value).toBe(image)
  expect(URL.createObjectURL).toHaveBeenCalledTimes(calls)
})

it.each(['load', 'dimension'] as const)('releases a rejected image after %s failure without replacing the current image', async (failure) => {
  const { wrapper } = await mountSavedEditor()
  const removeAttribute = vi.fn()
  const decode = vi.fn()
  vi.stubGlobal('Image', class {
    naturalWidth = failure === 'dimension' ? FILE_LIMITS.imageDimension + 1 : 100
    naturalHeight = 140
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    source = ''
    get src() { return this.source }
    set src(value: string) {
      this.source = value
      queueMicrotask(() => failure === 'load' ? this.onerror?.() : this.onload?.())
    }

    decode = decode
    removeAttribute = removeAttribute
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const image = editorRuntime().cardImage.value
  const revocations = vi.mocked(URL.revokeObjectURL).mock.calls.length
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(editorRuntime().cardImage.value).toBe(image)
  expect(useProjectStore().document!.activeCardId).toBe('one')
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revocations + 1)
  expect(removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
  expect(decode).not.toHaveBeenCalled()
})

it.each(['card', 'asset'] as const)('adopts a loaded %s image even if decode fails and defers release to runtime', async (target) => {
  const { wrapper } = await mountSavedEditor()
  const removeAttribute = vi.fn()
  vi.stubGlobal('Image', class {
    naturalWidth = 100
    naturalHeight = 140
    onload: (() => void) | null = null
    source = ''
    get src() { return this.source }
    set src(value: string) {
      this.source = value
      queueMicrotask(() => this.onload?.())
    }

    decode = vi.fn().mockRejectedValue(new Error('decode unsupported'))
    removeAttribute = removeAttribute
  })
  // 切替前と後でURLを区別し、旧画像の解放と新画像の所有を区別する。
  vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:new-image')
  const file = new File(['image'], 'image.PNG', { type: '' })
  if (target === 'card') {
    vi.mocked(loadFolderProjectCardImage).mockResolvedValueOnce(file)
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  }
  else {
    wrapper.findComponent({ name: 'AssetEditor' }).vm.$emit('image', file)
  }
  await flushPromises()
  const runtime = editorRuntime()
  expect(target === 'card' ? runtime.cardImage.value : runtime.assetSourceImage.value).not.toBeNull()
  expect(removeAttribute).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:new-image')
  if (target === 'card') {
    expect(useProjectStore().document!.activeCardId).toBe('two')
    runtime.clearCardImage()
  }
  else {
    expect(useProjectStore().document!.activeCardId).toBe('one')
    runtime.clearAssetSourceImage()
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new-image')
  expect(removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
})
