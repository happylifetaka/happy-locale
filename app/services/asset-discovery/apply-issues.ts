/** 反映結果から修正先へ戻るための一時情報。プロジェクトには保存しない。 */
export interface RegionApplyIssue {
  message: string
  regionId?: string
  occurrenceId?: string
  preview?: boolean
}

export interface CardApplyIssues {
  cardId: string
  cardName: string
  messages: readonly string[]
  details?: readonly RegionApplyIssue[]
}
