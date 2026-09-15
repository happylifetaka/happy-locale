import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useProjectStore } from '~/stores/project'
import type { FolderProjectCard, FolderProjectDocument } from '~/types/editor'
import type { TranslationMatchResult } from '~/utils/csv'
import type { TranslationReviewRow } from '~/utils/translation-review'
import { computed, ref, shallowRef } from 'vue'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { matchProjectTranslationRows, parseTranslationCsv, serializeProjectTranslationCsv, serializeTranslationCsv } from '~/utils/csv'
import { downloadText } from '~/utils/download'
import { assertCsvTextLimits, assertFileSize, FILE_LIMITS } from '~/utils/file-limits'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { reconcileTextStyles } from '~/utils/text-styles'
import { reviewRowsAreCurrent } from '~/utils/translation-review'
import { statusForTranslation } from '~/utils/translation-status'

interface TranslationReviewOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'applyTranslations'>
  projectStore: Pick<ReturnType<typeof useProjectStore>, 'replaceProject'>
  folderDocument: Ref<FolderProjectDocument | null>
  projectCards: Ref<FolderProjectCard[]>
  currentImageId: Ref<string>
  pendingCardDeletionIds: Ref<Set<string>>
  projectDirectory: Ref<FileSystemDirectoryHandle | null>
  image: Ref<HTMLImageElement | null>
  selectProjectRegion: (cardId: string, regionId: string) => Promise<void>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown) => void
}

/** 翻訳の確認用下書きとCSV入出力を管理し、確認された訳をカードと履歴へ反映する。 */
export function useTranslationReview({
  editor,
  projectStore,
  folderDocument,
  projectCards,
  currentImageId,
  pendingCardDeletionIds,
  projectDirectory,
  image,
  selectProjectRegion,
  setMessage,
  logDiagnostic,
}: TranslationReviewOptions) {
  /** まとめて確認するカードの複製と初期表示の条件。 */
  const translationReview = shallowRef<{
    cards: FolderProjectCard[]
    initialImport?: TranslationMatchResult
    autoTranslate?: boolean
  } | null>(null)
  /** まとめて確認した訳文を反映できなかった理由。 */
  const translationReviewError = ref('')
  /** 親側で反映を終え、確認画面へ通知する行と訳文。 */
  const translationReviewApplied = ref<{ key: string, translation: string }[]>([])
  /** 現在のカードにある、原文付きで訳文が空の領域。 */
  const batchTranslationRegions = computed(() => editor.project.value.regions.filter(
    region => region.originalText.trim() && !region.translatedText.trim(),
  ))

  /** 削除予定を除いた翻訳確認用のカード一覧。 */
  const translationReviewCards = computed(() => projectCards.value
    .filter(card => !pendingCardDeletionIds.value.has(card.id))
    .map(card => card.id === currentImageId.value ? { ...card, regions: editor.project.value.regions } : card))
  /** 確認対象を複製し、モーダル内の下書きとカードの確定状態を分離する。 */
  function openTranslationReview(initialImport?: TranslationMatchResult, currentOnly = false, autoTranslate = false) {
    translationReviewError.value = ''
    translationReviewApplied.value = []
    const cards = translationReviewCards.value.filter(card => !currentOnly || card.id === currentImageId.value)
    translationReview.value = { cards: JSON.parse(JSON.stringify(cards)), initialImport, autoTranslate }
  }

  /** 現在のカードの未翻訳を取得する設定で翻訳確認画面を開く。 */
  function translateUntranslatedRegions() {
    openTranslationReview(undefined, true, true)
  }

  /** 翻訳確認に必要なカードの原画像を取得する。 */
  async function loadReviewImage(cardId: string) {
    const card = translationReview.value?.cards.find(card => card.id === cardId)
    const directory = projectDirectory.value
    if (!card || !directory)
      throw new Error('カード画像が見つかりません。')
    if (!card.imagePath && cardId === currentImageId.value && image.value)
      return (await fetch(image.value.src)).blob()
    return loadFolderProjectCardImage(directory, card)
  }

  /** 翻訳確認画面を閉じ、指定カードの領域へ移動する。 */
  async function locateReviewRegion(cardId: string, regionId: string) {
    translationReview.value = null
    await selectProjectRegion(cardId, regionId)
  }

  /** 対象が現在も同じ内容か照合し、選択された訳をCSVと共通の反映経路へ渡す。 */
  function applyTranslationReview(rows: TranslationReviewRow[], closeAfterApply: boolean) {
    if (!rows.length)
      return
    if (!reviewRowsAreCurrent(rows, translationReviewCards.value)) {
      translationReviewError.value = '元の領域や訳文が変更されています。画面を開き直して確認してください。'
      return
    }
    const matched = matchProjectTranslationRows(translationReviewCards.value, currentImageId.value, rows.map(row => ({
      cardId: row.cardId,
      cardName: row.cardName,
      regionId: row.region.regionId,
      displayName: row.region.displayName,
      original: row.region.originalText,
      translation: row.translation,
    })), pendingCardDeletionIds.value)
    commitTranslations(matched)
    translationReviewError.value = ''
    translationReviewApplied.value = rows.map(row => ({ key: row.key, translation: row.translation }))
    if (closeAfterApply)
      translationReview.value = null
    setMessage(`${matched.applied}件の訳文を下書きとして反映しました。カード上で見た目を確認してください。`)
  }

  /** CSVを現在のカード群へ照合し、未一致や原文差異を確認できる状態にしてから反映へ進む。 */
  async function importCsv(file: File) {
    try {
      assertFileSize(file, FILE_LIMITS.textBytes, 'CSV')
      const csv = await file.text()
      assertCsvTextLimits(csv)
      const rows = parseTranslationCsv(csv)
      const documentValue = folderDocument.value
        ? folderDocument.value
        : null
      const cards = documentValue?.cards ?? projectCards.value
      const activeId = documentValue?.activeCardId ?? currentImageId.value
      const matched = matchProjectTranslationRows(
        cards,
        activeId,
        rows,
        pendingCardDeletionIds.value,
      )

      openTranslationReview(matched)
      logDiagnostic('翻訳CSVの照合が完了しました', {
        rows: rows.length,
        applied: matched.applied,
        issues: matched.issues.length,
      })
    }
    catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'CSVを読み込めませんでした。',
      )
    }
  }

  /** カード別の照合結果をまとめて反映し、編集中カードでは履歴とストアを同期する。 */
  function commitTranslations(matched: TranslationMatchResult) {
    const documentValue = folderDocument.value
      ? folderDocument.value
      : null
    const activeId = documentValue?.activeCardId ?? currentImageId.value

    if (documentValue) {
      projectStore.replaceProject({
        ...documentValue,
        cards: documentValue.cards.map((card) => {
          const translations = matched.translationsByCard.get(card.id)
          if (!translations || card.id === activeId)
            return card
          return {
            ...card,
            regions: card.regions.map((region) => {
              const translation = translations.get(region.regionId)
              return translation === undefined
                ? region
                : {
                    ...region,
                    translatedText: translation,
                    translationStatus: statusForTranslation(translation),
                    textStyles: reconcileTextStyles(
                      region.translatedText,
                      translation,
                      region.textStyles,
                    ),
                    inlineAssetStyles: reconcileInlineAssetStyles(
                      region.translatedText,
                      translation,
                      region.inlineAssetStyles,
                    ),
                  }
            }),
          }
        }),
      })
    }
    const activeTranslations = matched.translationsByCard.get(activeId)
    if (activeTranslations)
      editor.applyTranslations(activeTranslations)
    logDiagnostic('翻訳候補をプロジェクトへ反映しました', { applied: matched.applied })
  }

  /** 削除予定を除いた全カードの原文・訳文をCSVとして書き出す。 */
  function exportCsv() {
    const documentValue = folderDocument.value
      ? folderDocument.value
      : null
    const cards = (documentValue?.cards ?? projectCards.value).filter(
      card => !pendingCardDeletionIds.value.has(card.id),
    )
    const name = documentValue?.name || projectDirectory.value?.name || 'project'
    downloadText(
      serializeProjectTranslationCsv(cards),
      `${name}-translations.csv`,
      'text/csv;charset=utf-8',
    )
    logDiagnostic('プロジェクト翻訳CSVを書き出しました', {
      cards: cards.length,
      regions: cards.reduce((total, card) => total + card.regions.length, 0),
    })
  }

  /** 指定カードの原文・訳文をCSVとして書き出す。 */
  function exportCardCsv(cardId: string) {
    const card = projectCards.value.find(item => item.id === cardId)
    if (!card || pendingCardDeletionIds.value.has(cardId))
      return
    const name = card.imageName.replace(/\.(?:png|jpe?g)$/iu, '') || 'card'
    downloadText(
      `\uFEFF${serializeTranslationCsv(card.regions)}`,
      `${name}-translations.csv`,
      'text/csv;charset=utf-8',
    )
    logDiagnostic('カード翻訳CSVを書き出しました', {
      cardId,
      regions: card.regions.length,
    })
  }

  return {
    translationReview,
    translationReviewError,
    translationReviewApplied,
    batchTranslationRegions,
    translationReviewCards,
    openTranslationReview,
    translateUntranslatedRegions,
    loadReviewImage,
    locateReviewRegion,
    applyTranslationReview,
    importCsv,
    exportCsv,
    exportCardCsv,
  }
}
