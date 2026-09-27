import type { TextRegion } from '~/types/editor'

export type SourceProtection = 'edited' | 'no-ocr-history'

/** 反映結果から修正先へ戻るための一時情報。プロジェクトには保存しない。 */
export interface RegionApplyIssue {
  message: string
  regionId?: string
  occurrenceId?: string
  preview?: boolean
  sourceProtection?: SourceProtection
}

/** OCR履歴のない原文を「手修正済み」と断定しない。空にする手修正も保護する。 */
export function sourceProtectionReason(region: TextRegion): SourceProtection | undefined {
  if (region.lastOcrText === undefined)
    return region.originalText.trim() ? 'no-ocr-history' : undefined
  return region.originalText !== region.lastOcrText ? 'edited' : undefined
}

export function applyIssueDetails(card: CardApplyIssues): readonly RegionApplyIssue[] {
  return card.details?.length ? card.details : card.messages.map(message => ({ message }))
}

/** 枚数はカテゴリごとのカード数。同じカードが両方に含まれることもある。 */
export function applyIssueCounts(cards: readonly CardApplyIssues[]) {
  return {
    protectedCards: cards.filter(card => applyIssueDetails(card).some(issue => issue.preview)).length,
    problemCards: cards.filter(card => applyIssueDetails(card).some(issue => !issue.preview)).length,
  }
}

export interface CardApplyIssues {
  cardId: string
  cardName: string
  messages: readonly string[]
  details?: readonly RegionApplyIssue[]
}
