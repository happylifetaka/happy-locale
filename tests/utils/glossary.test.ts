import type { GlossaryEntry } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { findGlossaryMatches, glossaryKey } from '~/utils/glossary'

const entries: GlossaryEntry[] = [
  { id: 'card', source: 'card', translation: 'カード', note: '' },
  { id: 'draw', source: 'Draw', translation: '引く', note: '動詞' },
  { id: 'draw-two', source: 'Draw two cards', translation: 'カードを2枚引く', note: '' },
]

describe('project glossary', () => {
  it('matches source terms without distinguishing case and orders them by position', () => {
    expect(findGlossaryMatches('DRAW two cards, then discard a card.', entries).map(entry => entry.id)).toEqual([
      'draw-two',
      'draw',
      'card',
    ])
  })

  it('normalizes keys used to reject duplicate source terms', () => {
    expect(glossaryKey('  Draw ')).toBe(glossaryKey('draw'))
  })
})
