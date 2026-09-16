// @vitest-environment happy-dom
import type { FolderProjectCard } from '~/types/editor'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import TranslationReviewDialog from '~/components/TranslationReviewDialog.vue'
import { sampleRegions } from '~/services/project/sample'

beforeEach(() => {
  for (const name of ['computed', 'ref', 'watch', 'nextTick', 'onMounted', 'onBeforeUnmount'] as const)
    vi.stubGlobal(name, Vue[name])
})
afterEach(() => vi.unstubAllGlobals())

function setup(translate: (text: string) => Promise<string>, sameSource = false) {
  const card: FolderProjectCard = { id: 'sample-01', imageName: 'sample.png', imagePath: '', imageWidth: 744, imageHeight: 1039, printArea: null, sourceDpi: null, regions: [] }
  card.regions = sampleRegions(card).slice(0, 3)
  card.regions[2]!.translatedText = '手修正済み'
  if (sameSource)
    card.regions[1]!.originalText = card.regions[0]!.originalText
  const wrapper = shallowMount(TranslationReviewDialog, {
    props: { cards: [card], activeCardId: card.id, assets: [], assetImages: new Map(), glossary: [], loadImage: async () => new Blob(), translate, browserTranslation: true, autoTranslate: true },
  })
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  return { wrapper, button, card }
}

describe('browser translation review batch', () => {
  it('translates repeated source text only once within a batch', async () => {
    const translate = vi.fn().mockResolvedValue('共通の候補')
    const { wrapper, button } = setup(translate, true)
    await button('表示中の未翻訳を取得').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['共通の候補', '共通の候補', '手修正済み'])
    wrapper.unmount()
  })
  it('waits for a click, preserves existing drafts and retries only failed rows', async () => {
    const translate = vi.fn().mockResolvedValueOnce('最初の候補').mockRejectedValueOnce(new Error('一時的な失敗')).mockResolvedValueOnce('再試行の候補')
    const { wrapper, button, card } = setup(translate)
    await flushPromises()
    expect(translate).not.toHaveBeenCalled()
    await button('表示中の未翻訳を取得').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['最初の候補', '', '手修正済み'])
    expect(card.regions[0]!.translatedText).toBe('')
    await button('失敗した未翻訳を再試行').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['最初の候補', '再試行の候補', '手修正済み'])
    wrapper.unmount()
  })
  it('discards in-flight output after cancellation and skips subsequent rows', async () => {
    let resolve!: (value: string) => void
    const translate = vi.fn(() => new Promise<string>(done => resolve = done))
    const { wrapper, button } = setup(translate)
    await button('表示中の未翻訳を取得').trigger('click')
    await button('取得を中止').trigger('click')
    resolve('遅い結果')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['', '', '手修正済み'])
    expect(wrapper.text()).toContain('中止しました')
    wrapper.unmount()
  })
  it('uses a unique exact glossary translation before calling the model', async () => {
    const translate = vi.fn().mockResolvedValue('モデルの候補')
    const { wrapper, button, card } = setup(translate)
    await wrapper.setProps({ glossary: [{ id: 'term', source: card.regions[0]!.originalText, translation: '用語集の訳', note: '' }] })
    await button('表示中の未翻訳を取得').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea')[0]!.element.value).toBe('用語集の訳')
    wrapper.unmount()
  })
})
