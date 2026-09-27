// @vitest-environment happy-dom
import { shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick, ref, watch } from 'vue'
import CardCanvas from '~/components/CardCanvas.vue'

const renderer = vi.hoisted(() => ({ redraw: vi.fn(), dispose: vi.fn(), colorFromOriginalImage: vi.fn(), exportImage: vi.fn() }))
vi.mock('~/features/cards/canvas/renderer', () => ({ createCardCanvasRenderer: () => renderer }))
let wrapper: ReturnType<typeof shallowMount<typeof CardCanvas>> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

function mountCanvas() {
  wrapper = shallowMount(CardCanvas, {
    props: {
      image: new Image(),
      projectSelected: true,
      project: { imageName: 'synthetic.png', imageWidth: 320, imageHeight: 240, regions: [] },
      previewDeferred: false,
      selectedRegionId: null,
      autoMaskPreview: false,
      selectedExclusionId: null,
      zoom: 50,
      previewMode: 'edited',
      assets: [],
      assetImages: new Map(),
      fontFamilies: new Map(),
      regionCandidates: [],
      selectedCandidateId: null,
      printArea: null,
      printAreaEditing: false,
    },
    global: { plugins: [createPinia()], stubs: { ZoomControls: true } },
  })
  return wrapper
}

it.each(['zoom', 'assetImages'] as const)('redraws when only %s changes', async (input) => {
  const canvas = mountCanvas()
  await canvas.setProps(input === 'zoom' ? { zoom: 150 } : { assetImages: new Map([['asset', new Image()]]) })
  expect(renderer.redraw).toHaveBeenCalledOnce()
})

it('coalesces synchronous changes into one post-flush redraw', async () => {
  const canvas = mountCanvas()
  const zoom = canvas.setProps({ zoom: 100 })
  const assets = canvas.setProps({ assetImages: new Map([['asset', new Image()]]) })
  const fonts = canvas.setProps({ fontFamilies: new Map([['font', 'serif']]) })
  await Promise.all([zoom, assets, fonts])
  expect(renderer.redraw).toHaveBeenCalledOnce()
})

it('waits for deferred previews, then redraws once and disposes on unmount', async () => {
  const canvas = mountCanvas()
  await canvas.setProps({ previewDeferred: true, zoom: 150, assetImages: new Map() })
  await nextTick()
  expect(renderer.redraw).not.toHaveBeenCalled()
  await canvas.setProps({ previewDeferred: false })
  expect(renderer.redraw).toHaveBeenCalledOnce()
  canvas.unmount()
  wrapper = undefined
  expect(renderer.dispose).toHaveBeenCalledOnce()
})
