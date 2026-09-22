import { expect, it } from 'vitest'
import { applyIssueCounts, applyIssueDetails, sourceProtectionReason } from '~/services/asset-discovery/apply-issues'
import { describeCardApplyPlan } from '~/services/asset-discovery/apply-plan'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { discoveryProject } from '../fixtures/asset-discovery'

it('describes only prospective operations and excludes unassigned, excluded and unsynced icons', () => {
  const project = discoveryProject()
  const card = project.cards[0]!
  const discovery = project.assetDiscovery!
  const describe = () => describeCardApplyPlan(card, discovery, project.assets)
  expect(describe()).toMatchObject({ detect: false, additions: 1, existing: 0, assigned: 1, unassigned: 0, names: ['synthetic-icon'] })
  card.regions = [regionFromCandidate(card.ocrCandidates![0]!, 0)]
  expect(describe().operations).toEqual(['既存領域1件を使用', '選択済み候補1件を追加'])
  discovery.occurrences[0]!.assetId = null
  expect(describe()).toMatchObject({ assigned: 0, unassigned: 1, names: [] })
  discovery.occurrences[0]!.decision = 'excluded'
  expect(describe()).toMatchObject({ assigned: 0, unassigned: 0 })
  card.regions = []
  card.ocrCandidates![0]!.selected = false
  expect(describe()).toMatchObject({ detect: false, additions: 0, operations: [] })
  card.ocrCandidates = []
  expect(describe()).toMatchObject({ detect: true, operations: ['領域を新規検出・追加'] })
})

it('counts cards per category, not messages, including mixed and unstructured failures', () => {
  const mixed = { cardId: 'one', cardName: 'one.png', messages: [], details: [{ message: 'protected', preview: true }, { message: 'also protected', preview: true }, { message: 'problem' }] }
  const legacy = { cardId: 'two', cardName: 'two.png', messages: ['read failed'] }
  expect(applyIssueCounts([mixed, legacy])).toEqual({ protectedCards: 1, problemCards: 2 })
  expect(applyIssueDetails(legacy)).toEqual([{ message: 'read failed' }])
})

it('distinguishes edited text from missing OCR history without relaxing protection', () => {
  const region = regionFromCandidate(discoveryProject().cards[0]!.ocrCandidates![0]!, 0)
  expect(sourceProtectionReason(region)).toBeUndefined()
  region.originalText = ''
  expect(sourceProtectionReason(region)).toBe('edited')
  delete region.lastOcrText
  expect(sourceProtectionReason(region)).toBeUndefined()
  region.originalText = 'Existing source'
  expect(sourceProtectionReason(region)).toBe('no-ocr-history')
})
