import { beforeEach, expect, it, vi } from 'vitest'
import { collectIconDiscoveryBatch } from '~/services/asset-discovery/batch'
import { collectCardIconCandidates } from '~/services/asset-discovery/collect'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/asset-discovery/collect', () => ({ collectCardIconCandidates: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(collectCardIconCandidates).mockImplementation(async ({ card }) => {
    const occurrence = { ...discoveryProject().assetDiscovery!.occurrences[0]!, id: `icon-${card.id}`, cardId: card.id }
    return { cardId: card.id, imageDigest: 'a'.repeat(64), imageSize: occurrence.imageSize, occurrences: [occurrence], samples: [{ id: occurrence.id, fingerprint: null }], searchedAreas: [], ocrAreas: [], limitsHit: [] }
  })
})

function options() {
  const card = discoveryProject().cards[0]!
  return {
    cards: ['one', 'two', 'three'].map(id => ({ ...structuredClone(card), id })),
    provider: { recognize: vi.fn() },
    loadFile: vi.fn(async () => new File(['image'], 'same.png')),
    isCurrent: () => true,
    cardIsCurrent: () => true,
    cancelled: () => false,
    onCard: vi.fn(),
    onError: vi.fn(),
    maximumProposedCandidates: 2000,
  }
}

it('collects serially, retains successful cards after a failure, and proposes groups without mutating input', async () => {
  const input = options()
  const before = structuredClone(input.cards)
  input.loadFile.mockRejectedValueOnce(new Error('Missing image'))
  const output = await collectIconDiscoveryBatch(input)
  expect(output.failures).toEqual([{ cardId: 'one', message: 'Missing image' }])
  expect(output.proposals.map(proposal => proposal.cardId)).toEqual(['two', 'three'])
  expect(input.onCard).toHaveBeenCalledTimes(2)
  expect(input.onError).toHaveBeenCalledOnce()
  expect(input.cards).toEqual(before)
  expect(output.groups.groups.map(group => group.memberIds)).toEqual([['icon-three'], ['icon-two']])
})

it('keeps completed cards but discards the current card after cancellation', async () => {
  const input = options()
  let cancelled = false
  input.cancelled = () => cancelled
  input.loadFile.mockImplementationOnce(async () => new File(['first'], 'one.png')).mockImplementationOnce(async () => {
    cancelled = true
    return new File(['second'], 'two.png')
  })
  const output = await collectIconDiscoveryBatch(input)
  expect(output.cancelled).toBe(true)
  expect(output.proposals.map(proposal => proposal.cardId)).toEqual(['one'])
  expect(input.onError).not.toHaveBeenCalled()
  expect(collectCardIconCandidates).toHaveBeenCalledOnce()
})

it('skips a stale card before file loading and continues with independent cards', async () => {
  const input = options()
  input.cardIsCurrent = (card?: { id: string }) => card?.id !== 'one'
  const output = await collectIconDiscoveryBatch(input)
  expect(output.staleCardIds).toEqual(['one'])
  expect(input.loadFile).toHaveBeenCalledTimes(2)
  expect(output.proposals).toHaveLength(2)
})

it.each(['load', 'collect'] as const)('rejects a card that changes during %s without discarding independent cards', async (stage) => {
  const input = options()
  let stale = false
  input.cardIsCurrent = (card?: { id: string }) => !(stale && card?.id === 'one')
  if (stage === 'load') {
    input.loadFile.mockImplementationOnce(async () => {
      stale = true
      return new File(['changed'], 'same.png')
    })
  }
  else {
    const collect = vi.mocked(collectCardIconCandidates).getMockImplementation()!
    vi.mocked(collectCardIconCandidates).mockImplementationOnce(async (options) => {
      const result = await collect(options)
      stale = true
      return result
    })
  }
  const output = await collectIconDiscoveryBatch(input)
  expect(output.staleCardIds).toEqual(['one'])
  expect(output.proposals.map(proposal => proposal.cardId)).toEqual(['two', 'three'])
  expect(input.onCard).toHaveBeenCalledTimes(2)
  expect(input.onError).not.toHaveBeenCalled()
})

it('takes immutable card snapshots and does not report late errors after the project changes', async () => {
  const input = options()
  let current = true
  input.isCurrent = () => current
  input.loadFile.mockImplementationOnce(async (card?: { imageWidth: number }) => {
    input.cards[0]!.imageWidth = 999
    expect(card!.imageWidth).toBe(200)
    current = false
    throw new Error('Late failure')
  })
  const output = await collectIconDiscoveryBatch(input)
  expect(output.stale).toBe(true)
  expect(output.proposals).toEqual([])
  expect(output.failures).toEqual([])
  expect(input.onError).not.toHaveBeenCalled()
})

it('respects the temporary proposal budget and never starts a card when no slots remain', async () => {
  const input = options()
  input.maximumProposedCandidates = 1
  const output = await collectIconDiscoveryBatch(input)
  expect(vi.mocked(collectCardIconCandidates).mock.calls[0]![0].settings!.maximumCandidates).toBe(1)
  expect(output.limitReached).toBe(true)
  expect(output.proposals).toHaveLength(1)
  expect(input.loadFile).toHaveBeenCalledOnce()
})
