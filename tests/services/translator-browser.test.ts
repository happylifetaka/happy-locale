import type { BrowserTranslatorAPI } from '~/services/translator/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserTranslationAvailability, BrowserTranslationProvider } from '~/services/translator/browser'

afterEach(() => vi.unstubAllGlobals())

describe('browser translation provider', () => {
  function setup() {
    const destroy = vi.fn()
    const translate = vi.fn().mockResolvedValue('2 ZXQICON1QXZ を得る。')
    const create = vi.fn<BrowserTranslatorAPI['create']>().mockResolvedValue({ translate, destroy })
    vi.stubGlobal('Translator', { create, availability: vi.fn().mockResolvedValue('downloadable') })
    return { create, translate, destroy, provider: new BrowserTranslationProvider() }
  }
  it('detects unsupported environments without external requests', async () => {
    vi.stubGlobal('Translator', undefined)
    expect(await browserTranslationAvailability()).toBe('unsupported')
    await expect(new BrowserTranslationProvider().translate('Draw', 'en', 'ja')).rejects.toThrow('対応していません')
  })
  it('protects tags, normalizes languages and releases the model', async () => {
    const { provider, create, translate, destroy } = setup()
    const progress = vi.fn()
    expect(await provider.translate('Gain 2 [icon:太陽].', 'EN', 'JA', { onProgress: progress })).toBe('2 [icon:太陽] を得る。')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'en', targetLanguage: 'ja' }))
    expect(translate).toHaveBeenCalledWith('Gain 2 zxqicon1qxz.', expect.any(Object))
    expect(destroy).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalled()
  })
  it('rejects damaged tags and releases the model on failure', async () => {
    const { provider, translate, destroy } = setup()
    translate.mockResolvedValue('タグなし')
    await expect(provider.translate('Gain [icon:sun]', 'en', 'ja')).rejects.toThrow('復元できません')
    expect(destroy).toHaveBeenCalledOnce()
  })
  it('does not initialize after cancellation', async () => {
    const { provider, create } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(provider.translate('Draw', 'en', 'ja', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(create).not.toHaveBeenCalled()
  })
  it('discards late output after cancellation even if the browser ignores the signal', async () => {
    const { provider, translate, destroy } = setup()
    const controller = new AbortController()
    translate.mockImplementation(async () => {
      controller.abort()
      return '2 ZXQICON1QXZ を得る。'
    })
    await expect(provider.translate('[icon:sun]', 'en', 'ja', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()
  })
  it('retries initialization after a failed create', async () => {
    const { provider, create } = setup()
    create.mockRejectedValueOnce(new DOMException('Failed', 'NotSupportedError'))
    await expect(provider.translate('[icon:sun]', 'en', 'ja')).rejects.toThrow('Failed')
    expect(await provider.translate('[icon:sun]', 'en', 'ja')).toContain('[icon:sun]')
  })
})
