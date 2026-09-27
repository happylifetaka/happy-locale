import { expect, it } from 'vitest'
import { serializeFolderProject } from '~/services/project/format'
import { captureProjectSave } from '~/services/project/save-snapshot'
import { baselineProject } from '../fixtures/refactoring-baseline'

function setup() {
  const document = baselineProject()
  document.cards.push({ ...document.cards[0]!, id: 'deleted', imagePath: 'images/deleted.png' })
  const line = { text: 'Choose an ally.', x: 10, y: 10, width: 100, height: 20, confidence: 90 }
  const candidate = { ...line, id: 'candidate_1', lines: [line], selected: true }
  document.cards[0]!.ocrCandidates = [candidate]
  document.glossary = [{ id: 'ally', source: 'Ally', translation: '味方', note: '' }]
  const data = {
    document,
    card: document.cards[0]!,
    cardId: document.activeCardId,
    assets: document.assets,
    fonts: document.fonts,
    ocrDictionary: document.ocrDictionary,
    glossary: document.glossary,
    draftOCRCandidates: [candidate],
  }
  return { data, document, candidate }
}

it('captures independent JSON data and deletion scope while retaining exact Blob identities for acknowledgement', () => {
  const { data, document, candidate } = setup()
  const blob = new Blob(['pending'])
  const writes = new Map([['asset', blob]])
  const deletions = new Set(['deleted'])
  const before = structuredClone(data)
  const snapshot = captureProjectSave(data, writes, deletions)
  expect(snapshot.document!.cards.map(card => card.id)).toEqual(['synthetic-1'])
  expect(snapshot.deletedCards.map(card => card.id)).toEqual(['deleted'])
  expect(snapshot.assetWrites.get('asset')).toBe(blob)
  expect(data).toEqual(before)
  document.cards[0]!.imageName = 'later.png'
  document.glossary[0]!.translation = '後から変更'
  candidate.lines[0]!.x = 80
  candidate.selected = false
  writes.set('asset', new Blob(['later']))
  deletions.add('synthetic-1')
  expect(snapshot.card.imageName).toBe('synthetic.png')
  expect(snapshot.glossary[0]!.translation).toBe('味方')
  expect(snapshot.document!.cards[0]!.ocrCandidates![0]).toMatchObject({ selected: true, lines: [{ ...before.draftOCRCandidates[0]!.lines[0]!, x: 10 }] })
  expect(snapshot.assetWrites.get('asset')).toBe(blob)
  expect([...snapshot.deletionIds]).toEqual(['deleted'])
})

it('captures draft candidates and card identity without creating a persisted document or history', () => {
  const { data, candidate } = setup()
  const snapshot = captureProjectSave({ ...data, document: null }, new Map(), new Set())
  candidate.text = 'Later text'
  data.cardId = 'later-card'
  expect(snapshot.document).toBeNull()
  expect(snapshot.deletedCards).toEqual([])
  expect(snapshot.cardId).toBe('synthetic-1')
  expect(snapshot.draftOCRCandidates[0]!.text).toBe('Choose an ally.')
  expect(snapshot.draftOCRCandidates[0]).not.toBe(candidate)
})

it('preserves the existing protection against deleting every card', () => {
  const { data } = setup()
  const snapshot = captureProjectSave(data, new Map(), new Set(data.document.cards.map(card => card.id)))
  expect(snapshot.document).toEqual(data.document)
  expect(snapshot.deletedCards).toEqual([])
})

it('does not turn invalid numeric candidate confidence into valid unknown confidence before validation', () => {
  const { data, candidate } = setup()
  candidate.confidence = Number.NaN
  const snapshot = captureProjectSave(data, new Map(), new Set())
  expect(snapshot.document!.cards[0]!.ocrCandidates![0]!.confidence).toBeNaN()
  expect(() => serializeFolderProject(snapshot.document!)).toThrow('OCR領域候補')
})
