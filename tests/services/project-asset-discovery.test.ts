import { expect, it } from 'vitest'
import { finalizeProjectCardDeletions } from '~/services/project/cards'
import { parseFolderProject, serializeFolderProject, toCardProject } from '~/services/project/format'
import { captureProjectSave } from '~/services/project/save-snapshot'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../fixtures/asset-discovery'
import { baselineProject } from '../fixtures/refactoring-baseline'

it('round trips independent icon review data without promoting it into normal regions or history', () => {
  const project = discoveryProject()
  const before = structuredClone(project)
  const restored = parseFolderProject(serializeFolderProject(project))
  expect(restored).toEqual(project)
  expect(restored.assetDiscovery).not.toBe(project.assetDiscovery)
  expect(toCardProject(restored.cards[0]!)).not.toHaveProperty('assetDiscovery')
  expect(restored.cards[0]!.regions).toEqual([])
  expect(project).toEqual(before)
})

it.each([undefined, 0, 1, 2, 3])('migrates version %s to 4 without inventing icon candidates', (version) => {
  const project = baselineProject()
  const restored = parseFolderProject(JSON.stringify({ ...project, version }))
  expect(restored.version).toBe(4)
  expect(restored).not.toHaveProperty('assetDiscovery')
  expect(restored.cards[0]!.regions).toEqual(project.cards[0]!.regions)
})

it.each([0, 1, 2, 3, 5])('rejects discovery data incorrectly labelled version %s rather than dropping or trusting it', (version) => {
  expect(() => parseFolderProject(JSON.stringify({ ...discoveryProject(), version }))).toThrow('対応していない')
})

it.each(['card', 'asset', 'owner', 'group', 'bounds', 'approval'] as const)('validates discovery %s on read and write', (invalid) => {
  const project = discoveryProject()
  const state = project.assetDiscovery!
  const occurrence = state.occurrences[0]!
  if (invalid === 'card')
    occurrence.cardId = 'missing'
  if (invalid === 'asset')
    occurrence.assetId = 'missing'
  if (invalid === 'owner')
    occurrence.owner!.id = 'missing'
  if (invalid === 'group')
    state.groups[0]!.memberIds.push('missing')
  if (invalid === 'bounds')
    occurrence.bounds.width = 300
  if (invalid === 'approval')
    occurrence.approval!.assetId = 'missing'
  expect(() => serializeFolderProject(project)).toThrow('アイコン候補')
  expect(() => parseFolderProject(JSON.stringify(project))).toThrow('アイコン候補')
})

it('includes review decisions in the save signature and isolates in-flight save snapshots', () => {
  const project = discoveryProject()
  const signature = savedProjectSignature(project)
  const snapshot = captureProjectSave({
    document: project,
    card: project.cards[0]!,
    cardId: project.activeCardId,
    assets: project.assets,
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    draftOCRCandidates: [],
  }, new Map(), new Set())
  project.assetDiscovery!.groups[0]!.name = 'Later edit'
  expect(savedProjectSignature(project)).not.toBe(signature)
  expect(savedProjectSignature(snapshot.document!)).toBe(signature)
  expect(parseFolderProject(serializeFolderProject(snapshot.document!)).assetDiscovery!.groups[0]!.name).toBe('Synthetic group')
})

it('removes deleted-card occurrences and repairs group membership and representatives before saving', () => {
  const project = discoveryProject()
  const state = project.assetDiscovery!
  project.cards.push({ ...project.cards[0]!, id: 'other-card', imagePath: 'images/other.png' })
  state.occurrences.push({ ...structuredClone(state.occurrences[0]!), id: 'occurrence-2', cardId: 'other-card' })
  state.groups[0]!.memberIds.push('occurrence-2')
  const result = finalizeProjectCardDeletions(project, new Set([project.activeCardId]))
  expect(result.document.assetDiscovery!.occurrences.map(item => item.id)).toEqual(['occurrence-2'])
  expect(result.document.assetDiscovery!.groups[0]).toMatchObject({ memberIds: ['occurrence-2'], representativeId: 'occurrence-2' })
  expect(parseFolderProject(serializeFolderProject(result.document))).toEqual(result.document)
  expect(project.assetDiscovery!.occurrences).toHaveLength(2)
})

it('rejects total serialized JSON over 20 MiB even when individual strings meet their limit', () => {
  const project = baselineProject()
  project.glossary = Array.from({ length: 22 }, (_, index) => ({ id: `term-${index}`, source: `term ${index}`, translation: 'x'.repeat(1_000_000), note: '' }))
  expect(() => serializeFolderProject(project)).toThrow('20 MiB')
})
