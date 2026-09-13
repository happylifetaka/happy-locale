import type {
  FolderProjectCard,
  PrintLayoutSettings,
  RegionDraft,
} from '~/types/editor'

/** A4用紙の横幅。mm単位。 */
export const A4_WIDTH_MM = 210
/** A4用紙の高さ。mm単位。 */
export const A4_HEIGHT_MM = 297

export interface PrintLayoutItem {
  cardId: string
  cardName: string
  source: RegionDraft
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  overflow: boolean
}

export interface PrintLayoutPage {
  items: PrintLayoutItem[]
}

export interface PrintLayoutOverflowRow {
  cardIds: string[]
  sealWidthMm: number
  gapWidthMm: number
  requiredWidthMm: number
  availableWidthMm: number
  availableNonSealWidthMm: number
  configuredNonSealWidthMm: number
  maximumMarginMm: number
  overflowMm: number
}

export interface PrintLayoutResult {
  pages: PrintLayoutPage[]
  missingAreaCardIds: string[]
  missingDpiCardIds: string[]
  overflowingCardIds: string[]
  overflowingRows: PrintLayoutOverflowRow[]
}

/** 新規プロジェクトで使用する列数・余白・カード間隔・裁断ガイド設定。 */
export const DEFAULT_PRINT_SETTINGS: PrintLayoutSettings = {
  columns: 3,
  marginMm: 10,
  gapMm: 1,
  cutMarks: true,
}

/** 画素数をDPIから実寸mmへ換算し、指定列数でA4に配置する。収まらなくても自動縮小しない。 */
export function layoutPrintAreas(
  cards: readonly FolderProjectCard[],
  settings: PrintLayoutSettings,
): PrintLayoutResult {
  const missingAreaCardIds: string[] = []
  const missingDpiCardIds: string[] = []
  const printable = cards.flatMap((card) => {
    if (!card.printArea) {
      missingAreaCardIds.push(card.id)
      return []
    }
    if (!card.sourceDpi) {
      missingDpiCardIds.push(card.id)
      return []
    }
    return [{
      card,
      widthMm: card.printArea.width / card.sourceDpi.x * 25.4,
      heightMm: card.printArea.height / card.sourceDpi.y * 25.4,
    }]
  })
  const usableWidth = A4_WIDTH_MM - settings.marginMm * 2
  const usableHeight = A4_HEIGHT_MM - settings.marginMm * 2
  const pages: PrintLayoutPage[] = []
  const overflowingCardIds = new Set<string>()
  const overflowingRows: PrintLayoutOverflowRow[] = []
  let page: PrintLayoutPage = { items: [] }
  let yMm = settings.marginMm

  for (let index = 0; index < printable.length; index += settings.columns) {
    const row = printable.slice(index, index + settings.columns)
    const rowHeight = Math.max(...row.map(item => item.heightMm))
    const sealWidthMm = row.reduce((total, item) => total + item.widthMm, 0)
    const gapWidthMm = settings.gapMm * Math.max(0, row.length - 1)
    const requiredWidthMm = sealWidthMm + gapWidthMm
    const horizontalOverflow = requiredWidthMm > usableWidth
    if (horizontalOverflow) {
      row.forEach(item => overflowingCardIds.add(item.card.id))
      const availableNonSealWidthMm = A4_WIDTH_MM - sealWidthMm
      const configuredNonSealWidthMm = settings.marginMm * 2 + gapWidthMm
      overflowingRows.push({
        cardIds: row.map(item => item.card.id),
        sealWidthMm,
        gapWidthMm,
        requiredWidthMm,
        availableWidthMm: usableWidth,
        availableNonSealWidthMm,
        configuredNonSealWidthMm,
        maximumMarginMm: (availableNonSealWidthMm - gapWidthMm) / 2,
        overflowMm: requiredWidthMm - usableWidth,
      })
    }
    // 行の最大高さで改ページを判定し、同じ行のカードが別ページに分かれるのを防ぐ。
    if (page.items.length > 0 && yMm + rowHeight > A4_HEIGHT_MM - settings.marginMm) {
      pages.push(page)
      page = { items: [] }
      yMm = settings.marginMm
    }
    const isFullRow = row.length === settings.columns
    let xMm = settings.marginMm + (isFullRow
      ? Math.max(0, (usableWidth - requiredWidthMm) / 2)
      : 0)
    row.forEach((item) => {
      const overflow = horizontalOverflow || item.heightMm > usableHeight
      if (overflow)
        overflowingCardIds.add(item.card.id)
      page.items.push({
        cardId: item.card.id,
        cardName: item.card.imageName,
        source: item.card.printArea!,
        xMm,
        yMm,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        overflow,
      })
      xMm += item.widthMm + settings.gapMm
    })
    yMm += rowHeight + settings.gapMm
  }
  if (page.items.length > 0)
    pages.push(page)
  return {
    pages,
    missingAreaCardIds,
    missingDpiCardIds,
    overflowingCardIds: [...overflowingCardIds],
    overflowingRows,
  }
}
