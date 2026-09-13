import type { TextRegion } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import {
  matchProjectTranslationRows,
  parseTranslationCsv,
  serializeProjectTranslationCsv,
  serializeTranslationCsv,
} from '~/utils/csv'

describe('translation CSV', () => {
  it('parses project and region identification columns', () => {
    const rows = parseTranslationCsv(
      'card_id,card_name,region_id,display_name,original,translation\n001,card.png,effect_1,効果,"Draw 2 cards.",カードを2枚引く。',
    )
    expect(rows).toEqual([
      {
        cardId: '001',
        cardName: 'card.png',
        regionId: 'effect_1',
        displayName: '効果',
        original: 'Draw 2 cards.',
        translation: 'カードを2枚引く。',
      },
    ])
  })

  it('round-trips commas and quotes', () => {
    const region: TextRegion = {
      id: '1',
      regionId: 'effect_1',
      displayName: '効果',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      originalText: 'Draw, then say "done".',
      translatedText: '引いて「完了」と言う。',
      translationStatus: 'draft',
      textStyles: [],
      inlineAssetStyles: [],
      backgroundMode: 'auto',
      autoMaskPreset: 'auto',
      autoMaskSensitivity: 60,
      removeColorOutliers: true,
      backgroundColor: '#ffffff',
      manualMaskStrokes: [],
      exclusionAreas: [],
      textColor: '#000000',
      textStrokeColor: '#ffffff',
      textStrokeWidth: 2,
      fontSize: 16,
      autoFitFontSize: true,
      fontId: null,
      textAlign: 'left',
      verticalAlign: 'middle',
    }
    expect(parseTranslationCsv(serializeTranslationCsv([region]))[0]).toEqual({
      cardId: '',
      cardName: '',
      regionId: region.regionId,
      displayName: '',
      original: region.originalText,
      translation: region.translatedText,
    })
  })

  it('neutralizes spreadsheet formulas while preserving CSV round-trips', () => {
    const formulas = ['=1+1', '+cmd', '-1+1', '@SUM(A1:A2)', '  =HYPERLINK("x")']
    for (const formula of formulas) {
      const region: TextRegion = {
        id: '1',
        regionId: 'effect_1',
        displayName: '効果',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        originalText: formula,
        translatedText: formula,
        translationStatus: 'draft',
        textStyles: [],
        inlineAssetStyles: [],
        backgroundMode: 'auto',
        autoMaskPreset: 'auto',
        autoMaskSensitivity: 60,
        removeColorOutliers: true,
        backgroundColor: '#ffffff',
        manualMaskStrokes: [],
        exclusionAreas: [],
        textColor: '#000000',
        textStrokeColor: '#ffffff',
        textStrokeWidth: 2,
        fontSize: 16,
        autoFitFontSize: true,
        fontId: null,
        textAlign: 'left',
        verticalAlign: 'middle',
      }
      const csv = serializeTranslationCsv([region])
      expect(csv).toContain('"\t')
      expect(parseTranslationCsv(csv)[0]).toMatchObject({
        original: formula,
        translation: formula,
      })
    }
  })

  it('round-trips multiple cards and quoted line breaks', () => {
    const baseRegion: TextRegion = {
      id: '1',
      regionId: 'effect_1',
      displayName: '効果',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      originalText: 'Draw a card.\nThen discard a card.',
      translatedText: 'カードを1枚引く。\nその後、1枚捨てる。',
      translationStatus: 'reviewed',
      textStyles: [],
      inlineAssetStyles: [],
      backgroundMode: 'auto',
      autoMaskPreset: 'auto',
      autoMaskSensitivity: 60,
      removeColorOutliers: true,
      backgroundColor: '#ffffff',
      manualMaskStrokes: [],
      exclusionAreas: [],
      textColor: '#000000',
      textStrokeColor: '#ffffff',
      textStrokeWidth: 2,
      fontSize: 16,
      autoFitFontSize: true,
      fontId: null,
      textAlign: 'left',
      verticalAlign: 'middle',
    }
    const csv = serializeProjectTranslationCsv([
      { id: 'card-1', imageName: 'one.png', regions: [baseRegion] },
      {
        id: 'card-2',
        imageName: 'two.png',
        regions: [{ ...baseRegion, id: '2', translatedText: '別の訳文' }],
      },
    ])

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('display_name (readonly)')
    expect(parseTranslationCsv(csv)).toEqual([
      {
        cardId: 'card-1',
        cardName: 'one.png',
        regionId: 'effect_1',
        displayName: '効果',
        original: baseRegion.originalText,
        translation: baseRegion.translatedText,
      },
      {
        cardId: 'card-2',
        cardName: 'two.png',
        regionId: 'effect_1',
        displayName: '効果',
        original: baseRegion.originalText,
        translation: '別の訳文',
      },
    ])
  })

  it('matches rows by card_id and region_id across cards', () => {
    const rows = parseTranslationCsv(
      [
        'card_id,region_id,original,translation',
        'card-1,effect_1,Draw.,引く。',
        'card-2,effect_1,Heal.,回復する。',
        'missing,effect_1,Unknown.,不明。',
      ].join('\n'),
    )
    const result = matchProjectTranslationRows(
      [
        {
          id: 'card-1',
          regions: [{ regionId: 'effect_1', originalText: 'Draw.' }],
        },
        {
          id: 'card-2',
          regions: [{ regionId: 'effect_1', originalText: 'Heal.' }],
        },
      ],
      'card-1',
      rows,
    )

    expect(result.translationsByCard.get('card-1')?.get('effect_1')).toBe(
      '引く。',
    )
    expect(result.translationsByCard.get('card-2')?.get('effect_1')).toBe(
      '回復する。',
    )
    expect(result.applied).toBe(2)
    expect(result.unmatched).toBe(1)
    expect(result.issues).toEqual([
      {
        kind: 'unmatched',
        rowNumber: 4,
        cardId: 'missing',
        regionId: 'effect_1',
      },
    ])
  })

  it('applies legacy rows without card_id to the active card', () => {
    const rows = parseTranslationCsv(
      'region_id,original,translation\neffect_1,Draw.,カードを引く。',
    )
    const result = matchProjectTranslationRows(
      [
        {
          id: 'card-1',
          regions: [{ regionId: 'effect_1', originalText: 'Draw.' }],
        },
        {
          id: 'card-2',
          regions: [{ regionId: 'effect_1', originalText: 'Draw.' }],
        },
      ],
      'card-2',
      rows,
    )

    expect(result.translationsByCard.has('card-1')).toBe(false)
    expect(result.translationsByCard.get('card-2')?.get('effect_1')).toBe(
      'カードを引く。',
    )
  })

  it('rejects missing required columns', () => {
    expect(() => parseTranslationCsv('original,value\nfoo,bar')).toThrow(
      'region_id',
    )
  })

  it('rejects CSV input above the row limit', () => {
    const csv = [
      'region_id,translation',
      ...Array.from({ length: 100_000 }, (_, index) => `r${index},訳`),
    ].join('\n')
    expect(() => parseTranslationCsv(csv)).toThrow('100000行以下')
  })

  it('reports duplicate rows and source text differences with row numbers', () => {
    const rows = parseTranslationCsv([
      'card_id,region_id,original,translation',
      'card-1,effect_1,Draw.,引く。',
      'card-1,effect_1,Draw two.,2枚引く。',
    ].join('\n'))
    const result = matchProjectTranslationRows(
      [{
        id: 'card-1',
        regions: [{ regionId: 'effect_1', originalText: 'Draw.' }],
      }],
      'card-1',
      rows,
    )

    expect(result.applied).toBe(1)
    expect(result.duplicateRows).toBe(1)
    expect(result.originalMismatches).toBe(1)
    expect(result.issues).toEqual([
      {
        kind: 'original-mismatch',
        rowNumber: 3,
        cardId: 'card-1',
        regionId: 'effect_1',
        importedOriginal: 'Draw two.',
        expectedOriginal: 'Draw.',
      },
      {
        kind: 'duplicate',
        rowNumber: 3,
        cardId: 'card-1',
        regionId: 'effect_1',
      },
    ])
  })
})
