import { describe, expect, it } from 'vitest'
import { translationNumberDifferences } from '~/utils/translation-number-differences'

describe('numeric difference explanations', () => {
  it('identifies the added 1 and its context without attributing it to an English phrase', () => {
    expect(translationNumberDifferences('Choose a direction. Spend 2 to move 3 spaces.', '方向を1つ選ぶ。2を消費し、最大3マス移動する。')).toEqual([
      '訳文にだけ「1」が1か所あります。該当箇所：「方向を【1】つ選ぶ。2を消費し、最大3マス移動する。」',
    ])
  })

  it('lists missing and added values separately instead of guessing replacements', () => {
    const differences = translationNumberDifferences('Gain +2.', '−3を得る。')
    expect(differences[0]).toContain('原文にだけ「+2」')
    expect(differences[0]).toContain('Gain 【+2】.')
    expect(differences[1]).toContain('訳文にだけ「-3」')
    expect(differences[1]).toContain('【−3】を得る。')
  })

  it('reports counts with contexts on both sides without choosing an extra occurrence', () => {
    const differences = translationNumberDifferences('Gain 2. Spend 2.', '2を得る。')
    expect(differences).toHaveLength(1)
    expect(differences[0]).toContain('原文2か所／訳文1か所')
    expect(differences[0]).toContain('Gain 【2】')
    expect(differences[0]).toContain('Spend 【2】')
    expect(differences[0]).toContain('訳文：「【2】を得る。」')
  })

  it('ignores order, fullwidth differences and numbers in asset names', () => {
    expect(translationNumberDifferences('+1 2.5 −3 [icon:level4]', '２．５ −３ ＋１ [icon:level9]')).toEqual([])
    expect(translationNumberDifferences('1[icon:level3]2', '2 1')).toEqual([])
  })
})
