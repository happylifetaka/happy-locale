// @vitest-environment happy-dom
import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, shallowRef } from 'vue'
import { useCardThumbnails } from '~/composables/useCardThumbnails'
import { createCardThumbnailBlob } from '~/utils/card-thumbnail'

vi.mock('~/utils/card-thumbnail', () => ({ createCardThumbnailBlob: vi.fn(), createCardThumbnailBlobFromFile: vi.fn() }))
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.clearAllMocks()
})

it.each(['reset', 'directory', 'owner', 'unmount', 'current'] as const)('publishes a generated thumbnail only for a current request (%s)', async (change) => {
  let resolve!: (blob: Blob) => void
  vi.mocked(createCardThumbnailBlob).mockReturnValueOnce(new Promise((done) => {
    resolve = done
  }))
  const directory = shallowRef({ name: 'first' } as FileSystemDirectoryHandle)
  const setCardThumbnail = vi.fn()
  let thumbnails!: ReturnType<typeof useCardThumbnails>
  wrapper = mount(defineComponent({
    setup() {
      thumbnails = useCardThumbnails({
        directory,
        document: shallowRef(null),
        runtime: { cardThumbnails: shallowRef(new Map()), setCardThumbnail, resetCardThumbnails: vi.fn(), removeCardThumbnail: vi.fn() },
        logDiagnostic: vi.fn(),
      })
      return () => null
    },
  }))
  let current = true
  const pending = thumbnails.cacheCardThumbnail('same-card', document.createElement('img'), () => current)
  if (change === 'reset')
    thumbnails.resetCardThumbnails()
  if (change === 'directory')
    directory.value = { name: 'second' } as FileSystemDirectoryHandle
  if (change === 'owner')
    current = false
  if (change === 'unmount') {
    wrapper.unmount()
    wrapper = undefined
  }
  const thumbnail = new Blob(['thumbnail'])
  resolve(thumbnail)
  if (change === 'current') {
    expect(await pending).toBe(thumbnail)
    expect(setCardThumbnail).toHaveBeenCalledWith('same-card', thumbnail)
  }
  else {
    expect(await pending).toBeNull()
    expect(setCardThumbnail).not.toHaveBeenCalled()
  }
})
