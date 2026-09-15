// @vitest-environment happy-dom
import type { FontReference } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, mountSavedEditor, unmountEditor } from './helpers/card-editor'

const fontIO = vi.hoisted(() => ({
  loadUserFont: vi.fn<typeof import('~/services/fonts/user-font').loadUserFont>(),
  loadLocalFont: vi.fn<typeof import('~/services/fonts/local-font').loadLocalFont>(),
  loadCachedFont: vi.fn<typeof import('~/services/fonts/cache').loadCachedFont>(),
  cacheFont: vi.fn<typeof import('~/services/fonts/cache').cacheFont>(),
  removeCachedFont: vi.fn<typeof import('~/services/fonts/cache').removeCachedFont>(),
}))
vi.mock('~/services/fonts/user-font', () => ({ loadUserFont: fontIO.loadUserFont }))
vi.mock('~/services/fonts/local-font', () => ({ loadLocalFont: fontIO.loadLocalFont }))
vi.mock('~/services/fonts/cache', () => ({ loadCachedFont: fontIO.loadCachedFont, cacheFont: fontIO.cacheFont, removeCachedFont: fontIO.removeCachedFont }))

const reference: FontReference = { id: 'font-one', displayName: 'Test font', familyName: 'TestFont', fileName: 'test.ttf', source: 'user' }
const face = { family: 'TestFont' } as FontFace
const blob = new Blob(['font'])
const loaded = { reference, face, blob }
const file = new File(['font'], 'test.ttf')

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: new Set<FontFace>() })
  fontIO.loadUserFont.mockResolvedValue(loaded)
  fontIO.cacheFont.mockResolvedValue(undefined)
  fontIO.loadCachedFont.mockResolvedValue(null)
})

it('registers a font, caches its blob, and reuses its reference when reloaded', async () => {
  const { wrapper } = await mountSavedEditor()
  const library = wrapper.findComponent({ name: 'FontLibrary' })
  library.vm.$emit('load', file, null)
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([reference])
  expect(editorRuntime().loadedFonts.value.get(reference.id)).toBe(face)
  expect(fontIO.cacheFont).toHaveBeenCalledWith(reference.id, blob)
  library.vm.$emit('load', file, reference.id)
  await flushPromises()
  expect(fontIO.loadUserFont).toHaveBeenLastCalledWith(file, reference)
  expect(useProjectStore().fonts).toHaveLength(1)
  library.vm.$emit('rename', reference.id, 'Renamed')
  await nextTick()
  expect(useProjectStore().fonts[0]!.displayName).toBe('Renamed')
})

it('retains the loaded font when caching fails', async () => {
  fontIO.cacheFont.mockRejectedValue(new Error('cache unavailable'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { wrapper } = await mountSavedEditor()
  wrapper.findComponent({ name: 'FontLibrary' }).vm.$emit('load', file, null)
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([reference])
  expect(editorRuntime().loadedFonts.value.get(reference.id)).toBe(face)
  expect(wrapper.get('.notice').text()).toContain('次回は再選択が必要')
})

it('confirms deletion of a used font and removes card references before deferring cache deletion', async () => {
  const { wrapper, inspector, canvas } = await mountSavedEditor()
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  const library = wrapper.findComponent({ name: 'FontLibrary' })
  library.vm.$emit('load', file, null)
  await flushPromises()
  inspector.vm.$emit('update', inspector.props('region').id, { fontId: reference.id })
  await nextTick()
  library.vm.$emit('remove', reference.id)
  await nextTick()
  expect(wrapper.get('#font-delete-description').text()).toContain('1件')
  await wrapper.get('[aria-labelledby="font-delete-title"] .confirmation-danger').trigger('click')
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([])
  expect(inspector.props('region').fontId).toBeNull()
  expect(editorRuntime().loadedFonts.value.has(reference.id)).toBe(false)
  expect(fontIO.removeCachedFont).not.toHaveBeenCalled()
})

it('does not adopt a font that finishes loading after unmount', async () => {
  const result = deferred<typeof loaded>()
  fontIO.loadUserFont.mockReturnValueOnce(result.promise)
  const { wrapper } = await mountSavedEditor()
  wrapper.findComponent({ name: 'FontLibrary' }).vm.$emit('load', file, null)
  await flushPromises()
  unmountEditor()
  result.resolve(loaded)
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([])
  expect(editorRuntime().loadedFonts.value.size).toBe(0)
  expect(fontIO.cacheFont).not.toHaveBeenCalled()
})

it('discards a font loaded for a previous project directory and releases its FontFace', async () => {
  const result = deferred<typeof loaded>()
  fontIO.loadUserFont.mockReturnValueOnce(result.promise)
  const { wrapper } = await mountSavedEditor()
  wrapper.findComponent({ name: 'FontLibrary' }).vm.$emit('load', file, null)
  await flushPromises()
  editorRuntime().setDirectory({ name: 'other' } as FileSystemDirectoryHandle)
  document.fonts.add(face)
  result.resolve(loaded)
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([])
  expect(editorRuntime().loadedFonts.value.size).toBe(0)
  expect(document.fonts.has(face)).toBe(false)
  expect(fontIO.cacheFont).not.toHaveBeenCalled()
})

it('does not emit a late notification when caching finishes after unmount', async () => {
  const cached = deferred<void>()
  fontIO.cacheFont.mockReturnValueOnce(cached.promise)
  const { wrapper } = await mountSavedEditor()
  wrapper.findComponent({ name: 'FontLibrary' }).vm.$emit('load', file, null)
  await flushPromises()
  expect(fontIO.cacheFont).toHaveBeenCalledOnce()
  unmountEditor()
  const timers = vi.getTimerCount()
  cached.resolve()
  await flushPromises()
  expect(editorRuntime().loadedFonts.value.size).toBe(0)
  expect(vi.getTimerCount()).toBe(timers)
})

it('discards a system font that finishes loading after unmount', async () => {
  const result = deferred<typeof loaded>()
  fontIO.loadLocalFont.mockReturnValueOnce(result.promise)
  const { wrapper } = await mountSavedEditor()
  wrapper.findComponent({ name: 'FontLibrary' }).vm.$emit('load-system', { postscriptName: 'TestFont', fullName: 'Test Font' }, null)
  await flushPromises()
  expect(fontIO.loadLocalFont).toHaveBeenCalledOnce()
  unmountEditor()
  document.fonts.add(face)
  result.resolve(loaded)
  await flushPromises()
  expect(useProjectStore().fonts).toEqual([])
  expect(document.fonts.has(face)).toBe(false)
  expect(fontIO.cacheFont).not.toHaveBeenCalled()
})
