// @vitest-environment happy-dom
import type { ImageAsset } from '~/types/editor'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import SourceIconsDialog from '~/components/SourceIconsDialog.vue'
import { useCardEditor } from '~/composables/useCardEditor'

let wrapper: ReturnType<typeof mount<typeof SourceIconsDialog>>
beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onBeforeUnmount, onMounted, ref, useId, watch }))
    vi.stubGlobal(name, value)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup() {
  const editor = useCardEditor()
  editor.loadImageProject('source.png', 200, 200)
  editor.addRegion({ x: 20, y: 30, width: 100, height: 100 }, '#ffffff')
  const createAsset = vi.fn().mockResolvedValue({ id: 'sun', name: 'sun' })
  wrapper = mount(SourceIconsDialog, {
    props: {
      region: editor.selectedRegion.value!,
      image: document.createElement('img'),
      imageUrl: 'source.png',
      imageWidth: 200,
      imageHeight: 200,
      assets: [],
      assetImages: new Map(),
      createAsset,
    },
    global: { stubs: { AssetCreationPanel: true } },
  })
  return { createAsset }
}
function button(text: string) {
  return wrapper.findAll('button').find(button => button.text() === text)!
}
async function draw() {
  const svg = wrapper.get('svg')
  Object.assign(svg.element, { getScreenCTM: () => ({ inverse: () => ({}) }), setPointerCapture: () => {} })
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform() { return this }
  })
  await svg.trigger('pointerdown', { button: 0, clientX: 22, clientY: 33 })
  await svg.trigger('pointerup', { clientX: 32, clientY: 43 })
}

it('allows drawing without assets, previews registration at image coordinates and applies only confirmed ranges', async () => {
  const { createAsset } = setup()
  await draw()
  await button('アイコン指定を反映').trigger('click')
  expect(wrapper.emitted('apply')![0]).toEqual([[]])
  await button('この範囲から新規登録').trigger('click')
  const panel = wrapper.getComponent({ name: 'AssetCreationPanel' })
  expect(panel.props('draft').sourceRect).toEqual({ x: 22, y: 33, width: 10, height: 10 })
  panel.vm.$emit('confirm')
  await flushPromises()
  expect(createAsset).toHaveBeenCalledOnce()
  await wrapper.setProps({ assets: [{ id: 'sun', name: 'sun' }] as ImageAsset[] })
  await button('指定を反映して再OCR').trigger('click')
  expect(wrapper.emitted('recognize')![0]![0]).toEqual([expect.objectContaining({ assetId: 'sun', x: 2, y: 3, width: 10, height: 10 })])
})

it('lets the user correct missed ranges, rejects out-of-bounds edits and treats false detections as text', async () => {
  setup()
  await draw()
  await wrapper.get('input[type=number]').setValue(200)
  expect(button('この範囲から新規登録').attributes('disabled')).toBeDefined()
  expect(button('指定を反映して再OCR').attributes('disabled')).toBeDefined()
  await wrapper.get('input[type=number]').setValue(4)
  expect(button('この範囲から新規登録').attributes('disabled')).toBeUndefined()
  await wrapper.get('[aria-label="アイコン1の指定を削除"]').trigger('click')
  expect(wrapper.find('li').exists()).toBe(false)
})

it('keeps the draft for retry after registration fails', async () => {
  const { createAsset } = setup()
  createAsset.mockRejectedValueOnce(new Error('再試行してください'))
  await draw()
  await button('この範囲から新規登録').trigger('click')
  wrapper.getComponent({ name: 'AssetCreationPanel' }).vm.$emit('confirm')
  await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toBe('再試行してください')
  expect(wrapper.getComponent({ name: 'AssetCreationPanel' }).props('running')).toBe(false)
})
