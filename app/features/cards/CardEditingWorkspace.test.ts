// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useCardEditor } from '~/composables/useCardEditor'
import { useEditorOCR } from '~/composables/useEditorOCR'
import { useRegionCandidates } from '~/composables/useRegionCandidates'
import { useEditorToolsStore } from '~/stores/editor-tools'
import { provideCardEditing, provideCardOCR, provideCardResources, provideCardTranslation } from './cardEditingContext'
import CardEditingWorkspace from './CardEditingWorkspace.vue'
import { useCardWorkspace } from './useCardWorkspace'

let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

function mountWorkspace() {
  let editor!: ReturnType<typeof useCardEditor>
  let workspace!: ReturnType<typeof useCardWorkspace>
  const visible = ref(true)
  const attached = ref(true)
  const image = shallowRef<HTMLImageElement | null>(new Image())
  const projectSelected = ref(true)
  const assets = ref([])
  const currentImageId = ref('card-1')
  const currentView = ref<'card' | 'assets' | 'print'>('card')
  const execution = { running: ref(false), progress: ref<number | null>(null), status: ref('') }
  const provider = { recognize: vi.fn().mockResolvedValue({ text: '', confidence: null, blocks: [] }) }
  const setMessage = vi.fn()
  const pinia = createPinia()
  const root = defineComponent({
    setup() {
      editor = useCardEditor()
      editor.loadImageProject('card.png', 100, 100)
      workspace = useCardWorkspace({
        editor,
        image,
        hasProject: projectSelected,
        currentImageId,
        currentView,
        projectBusy: ref(false),
        ocrRunning: execution.running,
        assetEditing: ref(false),
        setMessage,
      })
      const dictionary = ref([])
      const ocr = useEditorOCR({
        editor,
        provider,
        execution,
        image,
        currentImageId,
        assets,
        ocrDictionary: dictionary,
        setOCRDictionary: vi.fn(),
        cardPreviewMode: workspace.cardPreviewMode,
        setMessage,
        logDiagnostic: vi.fn(),
      })
      const candidates = useRegionCandidates({
        editor,
        image,
        provider,
        execution,
        isDemo: ref(false),
        cardPreviewMode: workspace.cardPreviewMode,
        clearOCRCandidate: ocr.clearOCRCandidate,
        persistDisplayedBatchCandidates: vi.fn(),
        setMessage,
        logDiagnostic: vi.fn(),
      })
      provideCardEditing({ editor, workspace })
      provideCardResources({ image, projectSelected, assets, assetImages: shallowRef(new Map()), fontFamilies: shallowRef(new Map()), fonts: ref([]), loadedFontIds: shallowRef(new Set()) })
      provideCardOCR({ region: ocr, execution, dictionary, candidates, requestSourceIcons: vi.fn() })
      provideCardTranslation({ enabled: ref(false), running: ref(false), glossary: ref([]), reusableCount: ref(0), requestReuse: vi.fn(), translate: vi.fn() })
      return () => attached.value ? h(CardEditingWorkspace, { visible: visible.value, hasCardList: false, printArea: null }) : null
    },
  })
  wrapper = mount(root, {
    global: {
      plugins: [pinia],
      stubs: {
        CardCanvas: { name: 'CardCanvas', props: ['project', 'selectedRegionId'], methods: { exportPng: () => Promise.resolve(new Blob()), exportJpeg: () => Promise.resolve(new Blob()), backgroundColorForBounds: () => '#fff' }, template: '<div />' },
        RegionInspector: { name: 'RegionInspector', props: ['region'], template: '<div />' },
        RegionList: { name: 'RegionList', template: '<div />' },
        RegionSplitDialog: true,
      },
    },
  })
  return { editor, workspace, visible, attached, image, tools: useEditorToolsStore(pinia) }
}

it('edits and confirms deletion through the provided history without CardEditor', async () => {
  const { editor } = mountWorkspace()
  const canvas = wrapper!.getComponent({ name: 'CardCanvas' })
  canvas.vm.$emit('add-region', { x: 1, y: 2, width: 50, height: 30 }, '#fff')
  await nextTick()
  const id = editor.selectedRegionId.value!
  const inspector = wrapper!.getComponent({ name: 'RegionInspector' })
  inspector.vm.$emit('update', id, { translatedText: 'Shared editor' })
  await nextTick()
  expect(canvas.props('project').regions[0].translatedText).toBe('Shared editor')
  wrapper!.getComponent({ name: 'RegionList' }).vm.$emit('remove', id)
  await nextTick()
  expect(wrapper!.get('[role="alertdialog"]').text()).toContain('領域を削除しますか')
  await wrapper!.get('.confirmation-danger').trigger('click')
  expect(editor.project.value.regions).toHaveLength(0)
  editor.undo()
  await nextTick()
  expect(canvas.props('project').regions[0].translatedText).toBe('Shared editor')
})

it('retains the Canvas while hidden and unregisters its API without releasing shared state', async () => {
  const { editor, workspace, visible, attached, image, tools } = mountWorkspace()
  const api = workspace.canvasApi.value
  expect(api).not.toBeNull()
  expect(await api!.exportPng()).toBeInstanceOf(Blob)
  tools.maskBrushSize = 42
  workspace.cardZoom.value = 125
  visible.value = false
  await nextTick()
  expect(workspace.canvasApi.value).toBe(api)
  expect(wrapper!.get('.editor-layout').attributes('style')).toContain('display: none')
  attached.value = false
  await nextTick()
  expect(workspace.canvasApi.value).toBeNull()
  expect(image.value).not.toBeNull()
  expect(editor.project.value.imageName).toBe('card.png')
  expect(tools.maskBrushSize).toBe(42)
  attached.value = true
  visible.value = true
  await nextTick()
  expect(workspace.canvasApi.value).not.toBeNull()
  expect(workspace.canvasApi.value).not.toBe(api)
  expect(workspace.cardZoom.value).toBe(125)
  wrapper!.unmount()
  wrapper = undefined
  expect(workspace.canvasApi.value).toBeNull()
  expect(tools.maskBrushSize).toBe(28)
})
