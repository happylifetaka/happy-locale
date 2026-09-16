import type { Ref } from 'vue'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectCard, FolderProjectDocument, RegionDraft } from '~/types/editor'

interface EditorPrintSettingsOptions {
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'document' | 'replaceProject'>
  activeCardId: Ref<string>
  setMessage: (message: string) => void
}

/** 印刷用メタデータを更新する。領域の編集履歴と画面切替は呼出元が管理する。 */
export function useEditorPrintSettings({ projectStore, activeCardId, setMessage }: EditorPrintSettingsOptions) {
  /** 列数・余白・間隔などの用紙設定を文書へ反映する。 */
  function updatePrintSettings(settings: FolderProjectDocument['printSettings']) {
    if (!projectStore.document)
      return
    projectStore.replaceProject({ ...projectStore.document, printSettings: settings })
  }

  /** 指定カードの縦横DPIを変更する。 */
  function updateCardPrintDpi(cardId: string, sourceDpi: FolderProjectCard['sourceDpi']) {
    if (!projectStore.document)
      return
    projectStore.replaceProject({
      ...projectStore.document,
      cards: projectStore.document.cards.map(card => card.id === cardId
        ? { ...card, sourceDpi }
        : card),
    })
  }

  /** 現在のカードの印刷用メタデータを更新する。 */
  function updateActivePrintCard(
    patch: Partial<Pick<FolderProjectCard, 'printArea' | 'sourceDpi'>>,
  ) {
    const documentValue = projectStore.document
    if (!documentValue)
      return
    projectStore.replaceProject({
      ...documentValue,
      cards: documentValue.cards.map(card => card.id === activeCardId.value
        ? { ...card, ...patch }
        : card),
    })
  }

  /** 現在のカードへ印刷範囲を設定する。 */
  function updatePrintArea(area: RegionDraft) {
    updateActivePrintCard({ printArea: area })
  }

  /** 現在のカードの印刷範囲を解除する。 */
  function clearPrintArea() {
    updateActivePrintCard({ printArea: null })
  }

  /** 現在のカードへ縦横DPIを設定する。 */
  function updatePrintDpi(sourceDpi: FolderProjectCard['sourceDpi']) {
    updateActivePrintCard({ sourceDpi })
  }

  /** 他カードの未設定の印刷範囲を画像サイズ比で補い、未設定のDPIも現在のカードから引き継ぐ。 */
  function applyPrintAreaToUnconfiguredCards() {
    const documentValue = projectStore.document
    const sourceCard = documentValue?.cards.find(card => card.id === activeCardId.value)
    if (!documentValue || !sourceCard?.printArea)
      return
    const area = sourceCard.printArea
    projectStore.replaceProject({
      ...documentValue,
      cards: documentValue.cards.map((card) => {
        if (card.id === sourceCard.id)
          return card
        return {
          ...card,
          printArea: card.printArea ?? {
            x: area.x / sourceCard.imageWidth * card.imageWidth,
            y: area.y / sourceCard.imageHeight * card.imageHeight,
            width: area.width / sourceCard.imageWidth * card.imageWidth,
            height: area.height / sourceCard.imageHeight * card.imageHeight,
          },
          sourceDpi: card.sourceDpi ?? sourceCard.sourceDpi,
        }
      }),
    })
    setMessage('印刷範囲とDPIを未設定のカードへ一括適用しました。')
  }

  return { updatePrintSettings, updateCardPrintDpi, updatePrintArea, clearPrintArea, updatePrintDpi, applyPrintAreaToUnconfiguredCards }
}
