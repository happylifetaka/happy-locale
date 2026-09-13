import type { FolderProjectCard, ImageAsset } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { sampleRegions } from '~/services/project/sample'
import { matchProjectTranslationRows } from '~/utils/csv'
import { createTranslationReviewRows, mergeReviewImport, reviewApplySelection, reviewRowsAreCurrent, reviewWarnings } from '~/utils/translation-review'

function card(id = 'sample-01'): FolderProjectCard {
  const card: FolderProjectCard = { id, imageName: `${id}.png`, imagePath: '', imageWidth: 744, imageHeight: 1039, printArea: null, sourceDpi: null, regions: [] }
  card.regions = sampleRegions(card)
  return card
}
const assets = ['sun', 'drop'].map(name => ({ id: name, name, sourceImageId: '', sourceRect: { x: 0, y: 0, width: 32, height: 32 }, imagePath: '', scale: 1, baselineOffset: 0, inlinePadding: 0 })) satisfies ImageAsset[]

describe('translation review', () => {
  it('keeps the review open while unselected edits remain, and closes after the rest are applied', () => {
    const rows = createTranslationReviewRows([card()])
    rows[0]!.translation = '灯りの木立'
    rows[0]!.selected = true
    rows[1]!.translation = '場所'
    rows[1]!.selected = false
    const first = reviewApplySelection(rows)
    expect(first.rows).toEqual([rows[0]])
    expect(first.closeAfterApply).toBe(false)
    // Acknowledge the first application as the dialog does on success.
    rows[0]!.region.translatedText = rows[0]!.translation
    rows[0]!.selected = false
    expect(rows[1]!.translation).toBe('場所')
    expect(reviewApplySelection(rows).closeAfterApply).toBe(false)
    rows[1]!.selected = true
    expect(reviewApplySelection(rows)).toEqual({ rows: [rows[1]], closeAfterApply: true })
  })
  it('keeps edits isolated from project data', () => {
    const original = card()
    const rows = createTranslationReviewRows([original])
    rows[0]!.translation = '灯りの木立'
    rows[0]!.region.originalText = 'changed'
    expect(original.regions[0]!.translatedText).toBe('')
    expect(original.regions[0]!.originalText).toBe('LANTERN GROVE')
  })

  it('allows changed asset order but catches missing assets, broken syntax and altered numbers', () => {
    const row = createTranslationReviewRows([card()])[0]!
    row.region.originalText = 'Gain 2 [icon:sun] and 1 [icon:drop].'
    row.translation = '1 [icon:drop]と2 [icon:sun]を得る。'
    expect(reviewWarnings(row, assets)).toEqual([])
    row.translation = '3 [icon:sun]を得る。'
    expect(reviewWarnings(row, assets)).toEqual(expect.arrayContaining([
      expect.stringContaining('名前・個数'),
      expect.stringContaining('訳文にだけ「3」'),
    ]))
    row.translation = '2 [icon:sun と 1 [icon:unknown]'
    expect(reviewWarnings(row, assets)).toEqual(expect.arrayContaining([
      expect.stringContaining('記法が壊れ'),
      expect.stringContaining('未登録'),
    ]))
  })

  it('imports matching CSV rows while leaving mismatched originals unselected', () => {
    const cards = [card(), card('sample-02')]
    const rows = createTranslationReviewRows(cards)
    const input = [
      { cardId: cards[0]!.id, cardName: '', regionId: cards[0]!.regions[0]!.regionId, displayName: '', original: 'LANTERN GROVE', translation: '灯りの木立' },
      { cardId: cards[1]!.id, cardName: '', regionId: cards[1]!.regions[0]!.regionId, displayName: '', original: 'WRONG SOURCE', translation: '雲の配達人' },
      { cardId: 'missing', cardName: '', regionId: 'missing', displayName: '', original: '', translation: '未一致' },
    ]
    const result = matchProjectTranslationRows(cards, cards[0]!.id, input)
    mergeReviewImport(rows, result)
    expect(result.unmatched).toBe(1)
    expect(rows[0]!.translation).toBe('灯りの木立')
    expect(rows[0]!.selected).toBe(true)
    expect(rows[4]!.translation).toBe('雲の配達人')
    expect(rows[4]!.selected).toBe(false)
    expect(rows[4]!.importWarnings[0]).toContain('原文が一致しません')
    expect(rows[1]!.translation).toBe('')
  })

  it('rejects applying stale source, translation, renamed or deleted regions', () => {
    for (const mutate of [
      (c: FolderProjectCard) => { c.regions[0]!.originalText = 'changed' },
      (c: FolderProjectCard) => { c.regions[0]!.translatedText = 'changed' },
      (c: FolderProjectCard) => { c.regions[0]!.regionId = 'changed' },
      (c: FolderProjectCard) => { c.regions.shift() },
    ]) {
      const original = card()
      const rows = createTranslationReviewRows([original])
      expect(reviewRowsAreCurrent(rows, [original])).toBe(true)
      mutate(original)
      expect(reviewRowsAreCurrent(rows, [original])).toBe(false)
    }
  })
})
