// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { TRANSLATION_SETTINGS_STORAGE_KEY } from '~/composables/useTranslationSettings'
import { LocalTranslationProvider } from '~/services/translator/local'
import { SampleTranslationProvider } from '~/services/translator/sample'
import { useProjectStore } from '~/stores/project'
import { deferred, folderProjectExists, mountEditor, pickProjectDirectory, seedProject } from './helpers/card-editor'

describe('card editor translation candidates', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' }, public: { translationEndpointEnabled: true } }))
    localStorage.setItem(TRANSLATION_SETTINGS_STORAGE_KEY, JSON.stringify({ provider: 'local', endpoint: 'http://localhost:4578' }))
    vi.spyOn(LocalTranslationProvider.prototype, 'translate').mockResolvedValue('新しい訳')
  })

  async function setupTranslation() {
    const context = await mountEditor()
    const { inspector, wrapper } = context
    inspector.vm.$emit('update', inspector.props('region').id, { originalText: 'Draw', translatedText: '既存訳' })
    await nextTick()
    const toolbar = wrapper.findComponent({ name: 'EditorToolbar' })
    return { ...context, toolbar }
  }

  async function requestPreview() {
    const context = await setupTranslation()
    context.inspector.vm.$emit('translate')
    await nextTick()
    context.wrapper.findComponent({ name: 'TranslationRequestDialog' }).vm.$emit('send')
    await flushPromises()
    return { ...context, preview: context.wrapper.findComponent({ name: 'TranslationPreviewDialog' }) }
  }

  it('waits for send confirmation, then applies the candidate in one undo step', async () => {
    const { wrapper, canvas, inspector, toolbar } = await setupTranslation()
    inspector.vm.$emit('translate')
    await nextTick()
    const request = wrapper.findComponent({ name: 'TranslationRequestDialog' })
    expect(request.props()).toMatchObject({ originalText: 'Draw', endpoint: 'http://localhost:4578' })
    expect(LocalTranslationProvider.prototype.translate).not.toHaveBeenCalled()
    request.vm.$emit('send')
    await flushPromises()
    const preview = wrapper.findComponent({ name: 'TranslationPreviewDialog' })
    expect(preview.props()).toMatchObject({ originalText: 'Draw', currentTranslation: '既存訳', proposedTranslation: '新しい訳' })
    expect(canvas.props('project').regions[0].translatedText).toBe('既存訳')
    expect(LocalTranslationProvider.prototype.translate).toHaveBeenCalledExactlyOnceWith('Draw', 'EN', 'JA')
    preview.vm.$emit('apply')
    await nextTick()
    expect(canvas.props('project').regions[0]).toMatchObject({ translatedText: '新しい訳', translationStatus: 'draft' })
    expect(wrapper.findComponent({ name: 'TranslationPreviewDialog' }).exists()).toBe(false)
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(canvas.props('project').regions[0].translatedText).toBe('既存訳')
    toolbar.vm.$emit('redo')
    await nextTick()
    expect(canvas.props('project').regions[0].translatedText).toBe('新しい訳')
  })

  it('cancels sending without calling the provider', async () => {
    const { wrapper, inspector } = await setupTranslation()
    inspector.vm.$emit('translate')
    await nextTick()
    wrapper.findComponent({ name: 'TranslationRequestDialog' }).vm.$emit('cancel')
    await nextTick()
    expect(wrapper.findComponent({ name: 'TranslationRequestDialog' }).exists()).toBe(false)
    expect(LocalTranslationProvider.prototype.translate).not.toHaveBeenCalled()
  })

  it('discards a candidate without changing the card or adding history', async () => {
    const { canvas, preview, toolbar } = await requestPreview()
    preview.vm.$emit('cancel')
    await nextTick()
    expect(canvas.props('project').regions[0].translatedText).toBe('既存訳')
    toolbar.vm.$emit('undo')
    await nextTick()
    expect(canvas.props('project').regions[0]).toMatchObject({ originalText: '', translatedText: '' })
  })

  it.each(['original', 'translation', 'deleted', 'card'] as const)('rejects a candidate when its %s has changed', async (change) => {
    const { canvas, preview, inspector, toolbar, wrapper } = await requestPreview()
    const id = inspector.props('region').id
    if (change === 'original' || change === 'translation') {
      inspector.vm.$emit('update', id, change === 'original' ? { originalText: 'Changed' } : { translatedText: '手動の編集' })
    }
    else if (change === 'deleted') {
      wrapper.findComponent({ name: 'RegionList' }).vm.$emit('remove', id)
      await nextTick()
      await wrapper.get('[aria-labelledby="region-delete-title"] .confirmation-danger').trigger('click')
    }
    else {
      vi.mocked(pickProjectDirectory).mockResolvedValue({ name: 'new' } as FileSystemDirectoryHandle)
      vi.mocked(folderProjectExists).mockResolvedValue(false)
      toolbar.vm.$emit('open-project')
      await flushPromises()
    }
    await nextTick()
    const beforeApply = JSON.stringify(canvas.props('project'))
    preview.vm.$emit('apply')
    await nextTick()
    expect(JSON.stringify(canvas.props('project'))).toBe(beforeApply)
    expect(wrapper.findComponent({ name: 'TranslationPreviewDialog' }).exists()).toBe(false)
    expect(wrapper.get('.notice').text()).toContain('対象が変更されたため')
  })

  it('applies to the requested region even after another region is selected', async () => {
    const { canvas, preview, inspector } = await requestPreview()
    const id = inspector.props('region').id
    canvas.vm.$emit('add-region', { x: 1, y: 50, width: 50, height: 30 }, '#ffffff')
    await nextTick()
    preview.vm.$emit('apply')
    await nextTick()
    expect(canvas.props('project').regions).toEqual([
      expect.objectContaining({ id, translatedText: '新しい訳' }),
      expect.objectContaining({ translatedText: '' }),
    ])
  })

  it('does not duplicate a running request and discards its result after a project change', async () => {
    const result = deferred<string>()
    vi.mocked(LocalTranslationProvider.prototype.translate).mockReturnValueOnce(result.promise)
    const { wrapper, inspector, toolbar } = await setupTranslation()
    inspector.vm.$emit('translate')
    await nextTick()
    const request = wrapper.findComponent({ name: 'TranslationRequestDialog' })
    request.vm.$emit('send')
    request.vm.$emit('send')
    inspector.vm.$emit('translate')
    await nextTick()
    expect(LocalTranslationProvider.prototype.translate).toHaveBeenCalledOnce()
    expect(wrapper.findComponent({ name: 'TranslationRequestDialog' }).exists()).toBe(false)
    vi.mocked(pickProjectDirectory).mockResolvedValue({ name: 'new' } as FileSystemDirectoryHandle)
    vi.mocked(folderProjectExists).mockResolvedValue(false)
    toolbar.vm.$emit('open-project')
    await flushPromises()
    result.resolve('古い結果')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TranslationPreviewDialog' }).exists()).toBe(false)
    expect(wrapper.get('.notice').text()).toContain('カードが切り替わったため')
  })

  it('allows retry after a provider failure without modifying the translation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(LocalTranslationProvider.prototype.translate).mockRejectedValueOnce(new Error('offline'))
    const { canvas, inspector, wrapper, preview } = await requestPreview()
    expect(preview.exists()).toBe(false)
    expect(canvas.props('project').regions[0].translatedText).toBe('既存訳')
    expect(console.error).toHaveBeenCalledWith('[HappyLocale] ローカル翻訳に失敗しました', expect.any(Error))
    inspector.vm.$emit('translate')
    await nextTick()
    wrapper.findComponent({ name: 'TranslationRequestDialog' }).vm.$emit('send')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TranslationPreviewDialog' }).exists()).toBe(true)
  })

  it.each(['disabled', 'manual', 'unselected'] as const)('does not offer a request when %s', async (reason) => {
    if (reason === 'disabled')
      vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' }, public: { translationEndpointEnabled: false } }))
    if (reason === 'manual')
      localStorage.clear()
    const { wrapper, inspector, canvas } = await setupTranslation()
    if (reason === 'unselected') {
      canvas.vm.$emit('select-region', null)
      await nextTick()
    }
    inspector.vm.$emit('translate')
    await nextTick()
    expect(wrapper.findComponent({ name: 'TranslationRequestDialog' }).exists()).toBe(false)
    expect(LocalTranslationProvider.prototype.translate).not.toHaveBeenCalled()
  })

  it('uses sample translations without external confirmation in demo projects', async () => {
    vi.spyOn(SampleTranslationProvider.prototype, 'translate').mockResolvedValue('サンプル訳')
    const { wrapper, inspector } = await setupTranslation()
    const project = seedProject()
    useProjectStore().replaceProject({ ...project, demoPreset: 'sample-v1' })
    inspector.vm.$emit('translate')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TranslationRequestDialog' }).exists()).toBe(false)
    expect(LocalTranslationProvider.prototype.translate).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'TranslationPreviewDialog' }).props('proposedTranslation')).toBe('サンプル訳')
  })
})
