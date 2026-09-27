// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import RegionOCRCandidateCard from '~/features/cards/RegionOCRCandidateCard.vue'
import { sampleRegionCandidates } from '~/services/project/sample'
import { discoveryProject } from '../fixtures/asset-discovery'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function setup(loadImage = vi.fn().mockResolvedValue(new Blob(['original']))) {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const card = { ...discoveryProject().cards[0]!, id: 'sample-01', imageWidth: 744, imageHeight: 1039 }
  const candidates = sampleRegionCandidates(card)
  const wrapper = mount(RegionOCRCandidateCard, {
    props: { card, candidates, selected: true, disabled: false, sourceFile: null, loadImage },
    global: { stubs: { RegionSourcePreview: { props: ['src'], template: '<div class="preview" :data-src="src" />' } } },
  })
  wrappers.push(wrapper)
  return { wrapper, loadImage, card }
}

it('shares one original image across candidates and releases it when removed', async () => {
  const { wrapper, loadImage, card } = setup()
  await flushPromises()
  expect(loadImage).toHaveBeenCalledExactlyOnceWith(card)
  expect(URL.createObjectURL).toHaveBeenCalledOnce()
  expect(wrapper.findAll('.preview')).toHaveLength(4)
  expect(wrapper.findAll('.preview').every(preview => preview.attributes('data-src') === 'blob:original')).toBe(true)
  wrapper.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original')
})

it('discards late images after unmount and reports load failures', async () => {
  let resolve!: (blob: Blob) => void
  const { wrapper } = setup(vi.fn(() => new Promise<Blob>((done) => {
    resolve = done
  })))
  await flushPromises()
  wrapper.unmount()
  resolve(new Blob())
  await flushPromises()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  const failed = setup(vi.fn().mockRejectedValue(new Error('missing')))
  await flushPromises()
  expect(failed.wrapper.get('[role="status"]').text()).toContain('原画像を読み込めませんでした')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(failed.wrapper.findAll('.preview')).toHaveLength(0)
})

it('distinguishes existing regions from an empty detection result', async () => {
  const { wrapper, card } = setup()
  await wrapper.setProps({ candidates: [], card: { ...card, regions: [] } })
  expect(wrapper.text()).toContain('新しい領域候補は見つかりませんでした')
  expect(wrapper.text()).toContain('カードで領域を追加')
  const { sampleRegions } = await import('~/services/project/sample')
  await wrapper.setProps({ card: { ...card, regions: sampleRegions(card) } })
  expect(wrapper.findAll('.existing-region')).toHaveLength(4)
  expect(wrapper.findAll('.candidate-choice')).toHaveLength(0)
  expect(wrapper.findAll('.existing-region .candidate-text').map(row => row.text())).toEqual(sampleRegions(card).map(region => region.originalText))
  await wrapper.get('.existing-region button').trigger('click')
  expect(wrapper.emitted('open')?.[0]).toEqual([sampleRegions(card)[0]!.id])
  const regions = sampleRegions(card)
  regions[0]!.originalText = '編集後の原文'
  await wrapper.setProps({ card: { ...card, regions } })
  expect(wrapper.get('.existing-region .candidate-text').text()).toBe('編集後の原文')
  expect(wrapper.text()).not.toContain('新しい領域候補は見つかりませんでした')
})

it('loads only visible cards and releases original URLs offscreen, when revisited', async () => {
  let visibility!: (entries: { isIntersecting: boolean }[]) => void
  const disconnect = vi.fn()
  const { wrapper, loadImage } = setup()
  // Remount with observation enabled so the fallback does not start a load.
  wrapper.unmount()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof visibility) { visibility = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  loadImage.mockClear()
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
  const observed = mount(RegionOCRCandidateCard, {
    props: wrapper.props(),
    global: { stubs: { RegionSourcePreview: true } },
  })
  wrappers.push(observed)
  await flushPromises()
  expect(loadImage).not.toHaveBeenCalled()
  visibility([{ isIntersecting: true }])
  await flushPromises()
  expect(loadImage).toHaveBeenCalledOnce()
  visibility([{ isIntersecting: false }])
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original')
  expect(observed.findAll('region-source-preview-stub')).toHaveLength(0)
  visibility([{ isIntersecting: true }])
  await flushPromises()
  expect(loadImage).toHaveBeenCalledTimes(2)
  observed.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})
