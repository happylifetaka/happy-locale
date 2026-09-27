import type { CardIconProposal, DiscoveryCard, IconCollectionScope } from './collect'
import type { IconDiscoverySettings } from './types'
import type { OCRProvider } from '~/services/ocr/types'
import { collectCardIconCandidates } from './collect'
import { createImageDigestCache } from './digest'
import { ASSET_DISCOVERY_LIMITS } from './format'
import { proposeIconGroups } from './group'
import { DEFAULT_ICON_DISCOVERY_SETTINGS } from './types'

export interface IconDiscoveryBatchOptions {
  scope?: IconCollectionScope
  cards: readonly DiscoveryCard[]
  provider: OCRProvider
  loadFile: (card: DiscoveryCard) => Promise<File>
  isCurrent: () => boolean
  cardIsCurrent: (snapshot: DiscoveryCard) => boolean
  cancelled: () => boolean
  onCard: (proposal: CardIconProposal) => void
  onError: (cardId: string, message: string) => void
  /** この実行で保持する提案の上限。既存候補との差分も含み、保存時の空き件数とは別。 */
  maximumProposedCandidates: number
  settings?: Readonly<IconDiscoverySettings>
}

/** 一枚ずつ解析し、完了した提案だけ渡す。Store更新・既存候補の置換・自動承認は行わない。 */
export async function collectIconDiscoveryBatch(options: IconDiscoveryBatchOptions) {
  const { provider, loadFile, isCurrent, cardIsCurrent, cancelled, onCard, onError, maximumProposedCandidates } = options
  if (!Number.isSafeInteger(maximumProposedCandidates) || maximumProposedCandidates < 0 || maximumProposedCandidates > ASSET_DISCOVERY_LIMITS.project
    || options.cards.length > 10000 || new Set(options.cards.map(card => card.id)).size !== options.cards.length) {
    throw new Error('アイコン収集の対象・提案件数上限が不正です。')
  }
  const cards = structuredClone(options.cards)
  const settings = { ...(options.settings ?? DEFAULT_ICON_DISCOVERY_SETTINGS) }
  const proposals: CardIconProposal[] = []
  const failures: Array<{ cardId: string, message: string }> = []
  const staleCardIds: string[] = []
  const digestCache = createImageDigestCache()
  let remaining = maximumProposedCandidates
  let limitReached = false
  try {
    for (const card of cards) {
      if (!isCurrent() || cancelled())
        break
      if (remaining === 0) {
        limitReached = true
        break
      }
      const current = () => isCurrent() && !cancelled() && cardIsCurrent(card)
      try {
        if (!current()) {
          staleCardIds.push(card.id)
          continue
        }
        const file = await loadFile(card)
        if (!current()) {
          if (isCurrent() && !cancelled())
            staleCardIds.push(card.id)
          continue
        }
        const proposal = await collectCardIconCandidates({
          card,
          scope: options.scope,
          file,
          provider,
          isCurrent: current,
          digestCache,
          settings: { ...settings, maximumCandidates: Math.min(settings.maximumCandidates, remaining) },
        })
        if (!proposal || !current()) {
          if (isCurrent() && !cancelled())
            staleCardIds.push(card.id)
          continue
        }
        onCard(proposal)
        proposals.push(proposal)
        remaining -= proposal.occurrences.length
      }
      catch (error) {
        if (!current()) {
          if (isCurrent() && !cancelled())
            staleCardIds.push(card.id)
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ cardId: card.id, message })
        onError(card.id, message)
      }
    }
    return {
      proposals,
      failures,
      staleCardIds,
      cancelled: cancelled(),
      stale: !isCurrent(),
      limitReached,
      groups: proposeIconGroups(proposals.flatMap(proposal => proposal.samples)),
    }
  }
  finally {
    digestCache.clear()
  }
}
