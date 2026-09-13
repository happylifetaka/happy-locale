import type {
  ImageAsset,
  InlineAssetStyleRange,
} from '~/types/editor'

export interface InlineAssetOccurrence {
  start: number
  end: number
  assetId: string
  assetName: string
  occurrence: number
}

interface TokenOccurrence {
  start: number
  end: number
  name: string
  occurrence: number
}

/** アイコントークンの文字位置と同名トークン内の出現順を求める。 */
function tokenOccurrences(input: string): TokenOccurrence[] {
  const counts = new Map<string, number>()
  return [...input.matchAll(/\[icon:([^\]\r\n]+)\]/gu)].map((match) => {
    const name = match[1]!.trim()
    const occurrence = counts.get(name) ?? 0
    counts.set(name, occurrence + 1)
    return {
      start: match.index,
      end: match.index + match[0].length,
      name,
      occurrence,
    }
  })
}

/** 本文のアイコントークンを登録済みのアセットIDへ対応付ける。 */
export function findInlineAssetOccurrences(
  input: string,
  assets: readonly Pick<ImageAsset, 'id' | 'name'>[],
): InlineAssetOccurrence[] {
  const byName = new Map(assets.map(asset => [asset.name, asset.id]))
  return tokenOccurrences(input).flatMap((token) => {
    const assetId = byName.get(token.name)
    return assetId
      ? [{
          start: token.start,
          end: token.end,
          occurrence: token.occurrence,
          assetId,
          assetName: token.name,
        }]
      : []
  })
}

/** 指定されたアイコンの出現位置に対応する個別設定を探す。 */
export function inlineAssetStyleForOccurrence(
  styles: readonly InlineAssetStyleRange[],
  occurrence: Pick<InlineAssetOccurrence, 'start' | 'end' | 'assetId'>,
): InlineAssetStyleRange | undefined {
  return styles.find(style =>
    style.start === occurrence.start
    && style.end === occurrence.end
    && style.assetId === occurrence.assetId,
  )
}

/** 一つのアイコン出現箇所の個別設定を変更または解除する。 */
export function updateInlineAssetStyle(
  styles: readonly InlineAssetStyleRange[],
  occurrence: Pick<InlineAssetOccurrence, 'start' | 'end' | 'assetId'>,
  patch: Pick<
    InlineAssetStyleRange,
    'scale' | 'baselineOffset' | 'inlinePadding'
  > | null,
): InlineAssetStyleRange[] {
  const remaining = styles.filter(style => !(
    style.start === occurrence.start
    && style.end === occurrence.end
    && style.assetId === occurrence.assetId
  ))
  if (patch === null)
    return remaining
  return [...remaining, {
    start: occurrence.start,
    end: occurrence.end,
    assetId: occurrence.assetId,
    ...patch,
  }]
    .toSorted((left, right) => left.start - right.start)
}

/** 文字位置が動いても同名トークンの出現順で書式を引き継ぎ、消えたトークンの書式は外す。 */
export function reconcileInlineAssetStyles(
  previous: string,
  next: string,
  styles: readonly InlineAssetStyleRange[] = [],
): InlineAssetStyleRange[] {
  const previousTokens = tokenOccurrences(previous)
  const nextTokens = tokenOccurrences(next)
  return styles.flatMap((style): InlineAssetStyleRange[] => {
    const previousToken = previousTokens.find(token =>
      token.start === style.start && token.end === style.end,
    )
    if (!previousToken)
      return []
    const nextToken = nextTokens.find(token =>
      token.name === previousToken.name
      && token.occurrence === previousToken.occurrence,
    )
    return nextToken
      ? [{ ...style, start: nextToken.start, end: nextToken.end }]
      : []
  })
}

/** 改名対象はアセットIDで追跡し、トークンの長さが変わった後の書式範囲へ付け替える。 */
export function renameInlineAssetStyles(
  previous: string,
  next: string,
  styles: readonly InlineAssetStyleRange[],
  assetId: string,
  previousName: string,
  nextName: string,
): InlineAssetStyleRange[] {
  const reconciled = reconcileInlineAssetStyles(previous, next, styles)
    .filter(style => style.assetId !== assetId)
  const previousTokens = tokenOccurrences(previous)
  const nextTokens = tokenOccurrences(next)
  const renamed = styles.flatMap((style): InlineAssetStyleRange[] => {
    if (style.assetId !== assetId)
      return []
    const index = previousTokens.findIndex(token =>
      token.name === previousName
      && token.start === style.start
      && token.end === style.end,
    )
    const nextToken = nextTokens[index]
    return nextToken?.name === nextName
      ? [{ ...style, start: nextToken.start, end: nextToken.end }]
      : []
  })
  return [...reconciled, ...renamed]
    .toSorted((left, right) => left.start - right.start)
}
