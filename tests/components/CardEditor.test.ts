// @vitest-environment happy-dom
import { shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CardEditor from '~/components/CardEditor.vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useProjectRuntime } from '~/composables/useProjectRuntime'
import { useTranslationSettings } from '~/composables/useTranslationSettings'
import { useUnsavedChanges } from '~/composables/useUnsavedChanges'

// Nuxtの自動importだけを補い、編集履歴・ストア・runtimeは実装を使う。
// ルート遷移とWorkerはこの画面接続テストの対象外。
vi.mock('~/composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({
    leaveConfirmationOpen: ref(false),
    confirmLeave: vi.fn().mockResolvedValue(true),
    resolveLeave: vi.fn(),
  }),
}))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class {
    dispose = vi.fn().mockResolvedValue(undefined)
  },
}))

const childNames = [
  'EditorToolbar',
  'GlossaryDialog',
  'TranslationSettingsDialog',
  'TranslationReviewDialog',
  'TranslationReuseDialog',
  'TranslationPreviewDialog',
  'LayoutTemplateDialog',
  'RegionSplitDialog',
  'SourceIconsDialog',
  'TranslationRequestDialog',
  'CardList',
  'RegionList',
  'RegionCandidatePanel',
  'PrintAreaInspector',
  'FontLibrary',
  'AssetEditor',
  'PrintLayoutWorkspace',
  'DataPrivacyFooter',
  'UnsavedChangesDialog',
]

let wrapper: ReturnType<typeof shallowMount<typeof CardEditor>> | undefined
let runtime: ReturnType<typeof useProjectRuntime>

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  for (const [name, value] of Object.entries({
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    watch,
    useCardEditor,
    useTranslationSettings,
    useUnsavedChanges,
    useProjectRuntime: () => {
      runtime = useProjectRuntime()
      return runtime
    },
    useRuntimeConfig: () => ({ app: { baseURL: '/' }, public: { translationEndpointEnabled: false } }),
  })) {
    vi.stubGlobal(name, value)
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  const unexpectedWarnings = vi.mocked(console.warn).mock.calls.filter(([message]) => !String(message).startsWith('[HappyLocale]'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  expect(unexpectedWarnings).toEqual([])
})

async function mountEditor() {
  wrapper = shallowMount(CardEditor, {
    global: {
      plugins: [createPinia()],
      stubs: {
        ...Object.fromEntries(childNames.map(name => [name, true])),
        CardCanvas: { name: 'CardCanvas', props: ['previewDeferred', 'project'], template: '<div />' },
        RegionInspector: { name: 'RegionInspector', props: ['region'], template: '<div />' },
      },
    },
  })
  const canvas = wrapper.findComponent({ name: 'CardCanvas' })
  const inspector = wrapper.findComponent({ name: 'RegionInspector' })
  canvas.vm.$emit('add-region', { x: 1, y: 1, width: 50, height: 30 }, '#ffffff')
  await nextTick()
  return { wrapper, canvas, inspector }
}

describe('card editor preview deferral', () => {
  it('keeps edits live during IME composition and redraws 500ms after input ends', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', true)
    inspector.vm.$emit('update', inspector.props('region').id, { translatedText: '編集中' })
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    expect(canvas.props('project').regions[0].translatedText).toBe('編集中')
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)

    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(499)
    expect(canvas.props('previewDeferred')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(canvas.props('previewDeferred')).toBe(false)
  })

  it('restarts the delay on new input and cancels it when composition resumes', async () => {
    const { canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    inspector.vm.$emit('defer-preview', false)
    await vi.advanceTimersByTimeAsync(400)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('defer-preview', true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(canvas.props('previewDeferred')).toBe(true)
    inspector.vm.$emit('flush-preview')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['region', 'view', 'tab', 'image'] as const)('flushes a pending preview when %s changes', async (change) => {
    const { wrapper, canvas, inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(true)
    if (change === 'region')
      canvas.vm.$emit('select-region', null)
    else if (change === 'view')
      wrapper.findComponent({ name: 'EditorToolbar' }).vm.$emit('view', 'assets')
    else if (change === 'tab')
      await wrapper.get('#inspector-tab-text').trigger('click')
    else
      runtime.cardImage.value = document.createElement('img')
    await nextTick()
    expect(canvas.props('previewDeferred')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its pending timer when the editor is unmounted', async () => {
    const { inspector } = await mountEditor()
    inspector.vm.$emit('defer-preview', false)
    expect(vi.getTimerCount()).toBe(1)
    wrapper!.unmount()
    wrapper = undefined
    expect(vi.getTimerCount()).toBe(0)
  })
})
