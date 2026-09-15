// @vitest-environment happy-dom
import type { FontReference } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { deferred, editorRuntime, mountSavedEditor, saveFolderProject, unmountEditor } from './helpers/card-editor'

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

it('keeps a deleted font cached after save failure and deletes its cache after retry succeeds', async () => {
  const { wrapper, toolbar } = await mountSavedEditor()
  const library = wrapper.findComponent({ name: 'FontLibrary' })
  library.vm.$emit('load', file, null)
  await flushPromises()
  library.vm.$emit('remove', reference.id)
  await nextTick()
  expect(fontIO.removeCachedFont).not.toHaveBeenCalled()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(saveFolderProject).mockRejectedValueOnce(new Error('disk full'))
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  expect(fontIO.removeCachedFont).not.toHaveBeenCalled()
  vi.mocked(saveFolderProject).mockResolvedValueOnce(JSON.parse(JSON.stringify(useProjectStore().document!)))
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(fontIO.removeCachedFont).toHaveBeenCalledExactlyOnceWith(reference.id)
  expect(toolbar.props('saveStatus')).toBe('saved')
})

it('removes font references from both cards and does not resurrect them through previous card histories', async () => {
  const { wrapper, toolbar, canvas, inspector } = await mountSavedEditor()
  const library = wrapper.findComponent({ name: 'FontLibrary' })
  library.vm.$emit('load', file, null)
  await flushPromises()
  const list = wrapper.findComponent({ name: 'CardList' })
  for (const [cardId, regionId] of [['one', 'region-0'], ['two', 'region-1']]) {
    list.vm.$emit('select', cardId)
    await flushPromises()
    canvas.vm.$emit('select-region', regionId)
    await nextTick()
    inspector.vm.$emit('update', regionId, { fontId: reference.id })
    inspector.vm.$emit('update', regionId, { translatedText: 'Later' })
    await nextTick()
  }
  library.vm.$emit('remove', reference.id)
  await nextTick()
  expect(wrapper.get('#font-delete-description').text()).toContain('2件')
  await wrapper.get('[aria-labelledby="font-delete-title"] .confirmation-danger').trigger('click')
  await flushPromises()
  for (const cardId of ['one', 'two']) {
    list.vm.$emit('select', cardId)
    await flushPromises()
    toolbar.vm.$emit('undo')
    toolbar.vm.$emit('redo')
    await nextTick()
    expect(canvas.props('project').regions[0].fontId).toBeNull()
  }
  expect(useProjectStore().document!.cards.slice(0, 2).every(card => card.regions[0]!.fontId === null)).toBe(true)
  expect(fontIO.removeCachedFont).not.toHaveBeenCalled()
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
