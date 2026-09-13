import type { FolderProjectDocument } from '~/types/editor'

/** 保存内容に影響する値だけを比較する。削除予定や同じパスの画像更新も未保存として検出する。 */
export function savedProjectSignature(document: Pick<FolderProjectDocument, 'cards' | 'assets' | 'fonts' | 'ocrDictionary' | 'glossary' | 'printSettings' | 'layoutTemplates'>, pendingCardDeletionIds: Iterable<string> = [], pendingAssetWriteIds: Iterable<string> = [], pendingFontCacheDeletionIds: Iterable<string> = []) {
  return JSON.stringify({
    cards: document.cards,
    assets: document.assets,
    fonts: document.fonts,
    ocrDictionary: document.ocrDictionary,
    glossary: document.glossary,
    printSettings: document.printSettings,
    layoutTemplates: document.layoutTemplates ?? [],
    pendingCardDeletionIds: [...pendingCardDeletionIds].sort(),
    pendingAssetWriteIds: [...pendingAssetWriteIds].sort(),
    pendingFontCacheDeletionIds: [...pendingFontCacheDeletionIds].sort(),
  })
}
