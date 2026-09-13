import type {
  CardProject,
  FolderProjectCard,
  FolderProjectDocument,
  TextRegion,
} from '~/types/editor'
import { renameInlineAssetStyles } from '~/utils/inline-assets'
import { reconcileTextStyles } from '~/utils/text-styles'

export interface FinalizedProjectCardDeletions {
  document: FolderProjectDocument
  deletedCards: FolderProjectCard[]
}

/** 領域全体と部分書式から指定フォントの参照を取り除く。 */
function removeRegionFontReference(
  region: TextRegion,
  fontId: string,
): TextRegion {
  return {
    ...region,
    fontId: region.fontId === fontId ? null : region.fontId,
    textStyles: region.textStyles.flatMap((style) => {
      if (style.fontId !== fontId)
        return [style]
      const { fontId: _fontId, ...remaining } = style
      return remaining.textColor === undefined ? [] : [remaining]
    }),
  }
}

/** 一枚のカード内で、領域全体または部分書式に指定フォントを使う領域数を数える。 */
export function countCardFontUsage(project: CardProject, fontId: string) {
  return project.regions.filter(region =>
    region.fontId === fontId
    || region.textStyles.some(style => style.fontId === fontId),
  ).length
}

/** カードの領域全体と部分書式から指定フォントの参照を除く。 */
export function removeCardFontReferences(
  project: CardProject,
  fontId: string,
): CardProject {
  return {
    ...project,
    regions: project.regions.map(region =>
      removeRegionFontReference(region, fontId),
    ),
  }
}

/** 全カードと配置雛形にある、指定フォントを使う領域数を合計する。 */
export function countProjectFontUsage(
  document: FolderProjectDocument,
  fontId: string,
) {
  return document.cards.reduce(
    (count, card) => count + countCardFontUsage(card, fontId),
    0,
  ) + (document.layoutTemplates ?? []).reduce(
    (count, template) => count + countCardFontUsage({ ...template, imageName: template.name }, fontId),
    0,
  )
}

/** 共有フォント定義と、カード・配置雛形の領域全体および部分書式から指定フォントの参照を除く。 */
export function removeProjectFont(
  document: FolderProjectDocument,
  fontId: string,
): FolderProjectDocument {
  return {
    ...document,
    fonts: document.fonts.filter(font => font.id !== fontId),
    ...(document.layoutTemplates
      ? {
          layoutTemplates: document.layoutTemplates.map(template => ({
            ...template,
            regions: template.regions.map(region => removeRegionFontReference(region, fontId)),
          })),
        }
      : {}),
    cards: document.cards.map(card => ({
      ...card,
      ...removeCardFontReferences(card, fontId),
    })),
  }
}

/** 指定カードの編集内容を文書へ重ねた新しい文書を返す。 */
export function updateProjectCard(
  document: FolderProjectDocument,
  cardId: string,
  project: CardProject,
): FolderProjectDocument {
  return {
    ...document,
    cards: document.cards.map(card =>
      card.id === cardId ? { ...card, ...structuredClone(project) } : card,
    ),
  }
}

/** 文書の編集対象カードIDを切り替える。 */
export function activateProjectCard(
  document: FolderProjectDocument,
  cardId: string,
): FolderProjectDocument {
  if (!document.cards.some(card => card.id === cardId))
    return document
  return { ...document, activeCardId: cardId }
}

/** 指定カードの画像表示名を変更した文書を返す。 */
export function renameProjectCard(
  document: FolderProjectDocument,
  cardId: string,
  imageName: string,
): FolderProjectDocument {
  const name = imageName.trim()
  if (!name || !document.cards.some(card => card.id === cardId))
    return document
  return {
    ...document,
    cards: document.cards.map(card =>
      card.id === cardId ? { ...card, imageName: name } : card,
    ),
  }
}

/** 指定カードを一覧の前後へ移動した文書を返す。 */
export function moveProjectCard(
  document: FolderProjectDocument,
  cardId: string,
  direction: -1 | 1,
): FolderProjectDocument {
  const index = document.cards.findIndex(card => card.id === cardId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= document.cards.length)
    return document
  const cards = [...document.cards]
  const [card] = cards.splice(index, 1)
  cards.splice(target, 0, card!)
  return { ...document, cards }
}

/** 削除予定を文書から除き、保存後に消す画像の一覧も返す。ここではファイルを変更しない。 */
export function finalizeProjectCardDeletions(
  document: FolderProjectDocument,
  pendingDeletionIds: ReadonlySet<string>,
): FinalizedProjectCardDeletions {
  const cards = document.cards.filter(
    card => !pendingDeletionIds.has(card.id),
  )
  if (cards.length === 0)
    return { document, deletedCards: [] }
  const deletedCards = document.cards.filter(card =>
    pendingDeletionIds.has(card.id),
  )
  const activeCardId = cards.some(card => card.id === document.activeCardId)
    ? document.activeCardId
    : cards[0]!.id
  return {
    document: { ...document, activeCardId, cards },
    deletedCards,
  }
}

/** 原文・訳文のトークンと部分書式の位置を一緒に更新し、名前の長さ変更によるずれを防ぐ。 */
export function renameCardAssetTokens<T extends CardProject>(
  card: T,
  assetId: string,
  previousName: string,
  nextName: string,
): T {
  const escaped = previousName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`\\[icon:${escaped}\\]`, 'gu')
  return {
    ...card,
    regions: card.regions.map((region) => {
      const translatedText = region.translatedText.replace(
        pattern,
        () => `[icon:${nextName}]`,
      )
      const originalText = region.originalText.replace(pattern, () => `[icon:${nextName}]`)
      if (translatedText === region.translatedText && originalText === region.originalText)
        return region
      return {
        ...region,
        translatedText,
        originalText,
        inlineAssetStyles: renameInlineAssetStyles(
          region.translatedText,
          translatedText,
          region.inlineAssetStyles ?? [],
          assetId,
          previousName,
          nextName,
        ),
        textStyles: reconcileTextStyles(
          region.translatedText,
          translatedText,
          region.textStyles,
        ),
      }
    }),
  }
}

/** すべてのカードへアセット名の変更を反映する。 */
export function renameProjectAssetTokens(
  document: FolderProjectDocument,
  previousName: string,
  nextName: string,
  targetAssetId?: string,
): FolderProjectDocument {
  const assetId = targetAssetId
    ?? document.assets.find(asset => asset.name === previousName)?.id
  return {
    ...document,
    cards: assetId
      ? document.cards.map(card =>
          renameCardAssetTokens(card, assetId, previousName, nextName),
        )
      : document.cards,
  }
}
