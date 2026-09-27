// @vitest-environment happy-dom
import type { AssetCreationDraft, MaskStroke } from '~/types/editor'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AssetCreationPanel from '~/components/AssetCreationPanel.vue'
import { renderAssetCrop } from '~/utils/canvas/asset'

// 画像処理自体はutils/asset.test.tsで確認し、ここでは表示倍率と操作座標の対応を確認する。
vi.mock('~/utils/canvas/asset', () => ({ renderAssetCrop: vi.fn() }))

let wrapper: ReturnType<typeof mount<typeof AssetCreationPanel>> | undefined
const drawImage = vi.fn()
const getImageData = vi.fn()
const arc = vi.fn()

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.mocked(renderAssetCrop).mockImplementation((_image, bounds) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bounds.width))
    canvas.height = Math.max(1, Math.round(bounds.height))
    return canvas
  })
  getImageData.mockReturnValue({ data: new Uint8ClampedArray([18, 52, 86, 255]) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData,
    arc,
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup(patch: Partial<AssetCreationDraft> = {}) {
  const draft: AssetCreationDraft = {
    editingAssetId: null,
    name: 'icon',
    sourceRect: { x: 30, y: 40, width: 40, height: 20 },
    removeBackground: true,
    backgroundColor: null,
    backgroundThreshold: 48,
    edgeFeather: 12,
    manualMaskStrokes: [],
    ...patch,
  }
  wrapper = mount(AssetCreationPanel, {
    props: {
      image: document.createElement('img'),
      draft,
      existingAssets: [],
    },
  })
  const canvas = wrapper.get('canvas')
  const stage = wrapper.get('.asset-preview-stage')
  // 4倍表示。左上の位置もずらし、画面座標をそのまま保存する不具合を検出する。
  vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 200,
    left: 100,
    top: 200,
    width: draft.sourceRect.width * 4,
    height: draft.sourceRect.height * 4,
    right: 100 + draft.sourceRect.width * 4,
    bottom: 200 + draft.sourceRect.height * 4,
    toJSON: () => ({}),
  })
  Object.assign(stage.element, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true })
  return { panel: wrapper, canvas, stage, draft }
}

function button(text: string) {
  const result = wrapper!.findAll('button').find(item => item.text() === text)
  if (!result)
    throw new Error(`Button not found: ${text}`)
  return result
}

function lastPatch(): Partial<AssetCreationDraft> {
  return wrapper!.emitted('update')!.at(-1)![0] as Partial<AssetCreationDraft>
}

it('changes only the displayed zoom, retaining source dimensions and the draft', async () => {
  const { panel, canvas, draft } = setup()
  const original = structuredClone(draft)
  const zoom = panel.get('[aria-label="プレビューの拡大率"]')
  expect((zoom.element as HTMLSelectElement).value).toBe('fit')
  await zoom.setValue('400')
  expect(canvas.element.width).toBe(40)
  expect(canvas.element.height).toBe(20)
  await zoom.setValue('1600')
  expect(canvas.element.width).toBe(40)
  expect(canvas.element.height).toBe(20)
  expect(panel.emitted('update')).toBeUndefined()
  expect(panel.props('draft')).toEqual(original)
})

it.each([
  ['paint', '透明にする'],
  ['erase', '元に戻す'],
] as const)('stores %s strokes in original pixels when the preview is enlarged', async (mode, label) => {
  const { panel, stage } = setup()
  await panel.get('[aria-label="プレビューの拡大率"]').setValue('400')
  await button('ブラシで補正').trigger('click')
  await button(label).trigger('click')
  await panel.get('[aria-label="ブラシサイズ（元画像px）"]').setValue(12)
  await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 140, clientY: 220 })
  expect(panel.get('[aria-label="プレビューの拡大率"]').attributes('disabled')).toBeDefined()
  await stage.trigger('pointermove', { pointerId: 1, clientX: 172, clientY: 240 })
  expect(panel.find('.asset-brush-cursor').exists()).toBe(true)
  expect(arc).not.toHaveBeenCalled()
  await stage.trigger('pointerup', { pointerId: 1, clientX: 172, clientY: 240 })
  expect(lastPatch()).toEqual({
    manualMaskStrokes: [{ brushSize: 12, mode, points: [{ x: 10, y: 5 }, { x: 18, y: 10 }] }],
  })
  expect(panel.emitted('update')).toHaveLength(1)
  await panel.setProps({ draft: { ...panel.props('draft'), ...lastPatch() } })
  const zoom = panel.get('[aria-label="プレビューの拡大率"]')
  expect((zoom.element as HTMLSelectElement).value).toBe('400')
  expect(zoom.attributes('disabled')).toBeUndefined()
})

it('allows a brush wider than the short edge and clamps numeric entry to the valid range', async () => {
  const { panel, draft } = setup({ sourceRect: { x: 0, y: 0, width: 120, height: 50 } })
  await button('ブラシで補正').trigger('click')
  const range = panel.get('[aria-label="ブラシサイズ"]')
  const input = panel.get('[aria-label="ブラシサイズ（元画像px）"]')
  expect(range.attributes('max')).toBe('130')
  await input.setValue(100)
  expect((range.element as HTMLInputElement).value).toBe('100')
  await input.setValue(999)
  expect((input.element as HTMLInputElement).value).toBe('130')
  await input.setValue(0)
  expect((input.element as HTMLInputElement).value).toBe('1')
  await input.setValue(130)
  await panel.setProps({ draft: { ...draft, sourceRect: { x: 0, y: 0, width: 6, height: 8 } } })
  expect(range.attributes('max')).toBe('100')
  expect((input.element as HTMLInputElement).value).toBe('100')
  expect(panel.emitted('update')).toBeUndefined()
})

it('undoes one stroke and clears all strokes without altering their source coordinates', async () => {
  const strokes: MaskStroke[] = [
    { brushSize: 40, mode: 'paint', points: [{ x: 10, y: 5 }, { x: 18, y: 10 }] },
    { brushSize: 12, mode: 'erase', points: [{ x: 10, y: 5 }] },
  ]
  const { panel, draft } = setup({ manualMaskStrokes: strokes })
  await panel.get('[aria-label="プレビューの拡大率"]').setValue('400')
  await button('ブラシで補正').trigger('click')
  await button('1画戻す').trigger('click')
  expect(lastPatch()).toEqual({ manualMaskStrokes: [strokes[0]] })
  await panel.setProps({ draft: { ...draft, ...lastPatch() } })
  await button('補正をクリア').trigger('click')
  expect(lastPatch()).toEqual({ manualMaskStrokes: [] })
  await panel.setProps({ draft: { ...draft, ...lastPatch() } })
  expect(button('1画戻す').attributes('disabled')).toBeDefined()
  expect(button('補正をクリア').attributes('disabled')).toBeDefined()
})

it('samples the original image pixel selected within an enlarged preview', async () => {
  const { panel, stage } = setup({ backgroundColor: '#ffffff' })
  await panel.get('[aria-label="プレビューの拡大率"]').setValue('400')
  await button('プレビューから選択').trigger('click')
  await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 142, clientY: 222 })
  expect(getImageData).toHaveBeenCalledExactlyOnceWith(10, 5, 1, 1)
  expect(lastPatch()).toEqual({ backgroundColor: '#123456' })
  expect(drawImage).toHaveBeenCalledWith(panel.props('image'), 30, 40, 40, 20, 0, 0, 40, 20)
})

it('keeps the brush cursor and stroke centers outside the image on the surrounding work area', async () => {
  const { panel, stage, canvas } = setup()
  await panel.get('[aria-label="プレビューの拡大率"]').setValue('400')
  await button('ブラシで補正').trigger('click')
  await panel.get('[aria-label="ブラシサイズ（元画像px）"]').setValue(12)
  // Canvasの左外側5pxでも、カーソルを隠さず画像外の実際の位置に置く。
  await stage.trigger('pointermove', { pointerId: 1, clientX: 95, clientY: 220 })
  const cursor = panel.get('.asset-brush-cursor')
  expect((cursor.element as HTMLElement).style.left).toBe('-5px')
  expect((cursor.element as HTMLElement).style.top).toBe('20px')
  await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 95, clientY: 220 })
  await stage.trigger('pointermove', { pointerId: 1, clientX: 90, clientY: 240 })
  await stage.trigger('pointerup', { pointerId: 1, clientX: 90, clientY: 240 })
  expect(lastPatch()).toEqual({
    manualMaskStrokes: [{ brushSize: 12, mode: 'paint', points: [{ x: -1.25, y: 5 }, { x: -2.5, y: 10 }] }],
  })
  expect(canvas.element.width).toBe(40)
  expect(canvas.element.height).toBe(20)
})

it('ignores color sampling outside every image edge and remains ready to sample an image pixel', async () => {
  const { panel, stage } = setup({ backgroundColor: '#ffffff' })
  await panel.get('[aria-label="プレビューの拡大率"]').setValue('400')
  await button('プレビューから選択').trigger('click')
  for (const [clientX, clientY] of [[95, 220], [265, 220], [140, 195], [140, 285]]) {
    await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX, clientY })
    expect(panel.emitted('update')).toBeUndefined()
    expect(getImageData).not.toHaveBeenCalled()
    expect(button('プレビュー上の色を選択中').exists()).toBe(true)
  }
  await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 142, clientY: 222 })
  expect(getImageData).toHaveBeenCalledExactlyOnceWith(10, 5, 1, 1)
  expect(lastPatch()).toEqual({ backgroundColor: '#123456' })
})
