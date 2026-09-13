import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SampleTranslationProvider } from '~/services/translator/sample'

const cards = JSON.parse(readFileSync(new URL('../../samples/cards/manifest.json', import.meta.url), 'utf8')) as { name: string, type: string, detail: string, lines: string[] }[]
const provider = new SampleTranslationProvider()
const tokens = (text: string) => [...text.matchAll(/\[icon:[^\]]+\]/gu)].map(match => match[0]).sort()

describe('sample translation provider', () => {
  it('translates every sample title, heading, line and full effect without network access', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'))
    try {
      expect(cards).toHaveLength(5)
      for (const card of cards) {
        for (const text of [card.name, card.type, card.detail, ...card.lines, card.lines.join('\n')]) {
          const source = text.replace(/\{(sun|drop)\}/gu, '[icon:$1]')
          const result = await provider.translate(source, 'EN', 'JA')
          expect(result).toMatch(/[\u3040-\u9FFF]/u)
          expect(tokens(result)).toEqual(tokens(source))
        }
      }
      expect(fetch).not.toHaveBeenCalled()
    }
    finally { fetch.mockRestore() }
  })

  it('tolerates OCR whitespace and case, but rejects changed numbers or unknown text instead of partially translating', async () => {
    expect(await provider.translate(' Choose a\ndirection . ', 'en', 'ja')).toBe('方向を1つ選ぶ。')
    await expect(provider.translate('Draw 3 cards, then keep 1.', 'EN', 'JA')).rejects.toThrow('一致しません')
    await expect(provider.translate('PLACE Unknown sentence.', 'EN', 'JA')).rejects.toThrow('一致しません')
    await expect(provider.translate('Place 1 [icon:SUN] on this card.', 'EN', 'JA')).rejects.toThrow('一致しません')
    await expect(provider.translate('', 'EN', 'JA')).rejects.toThrow('原文')
    await expect(provider.translate('PLACE', 'EN', 'FR')).rejects.toThrow('英語から日本語')
  })
})
