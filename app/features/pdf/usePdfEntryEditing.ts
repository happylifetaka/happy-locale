import type { Ref } from 'vue'
import type { PdfAnalysis } from '~/services/pdf'
import { computed, readonly, ref, shallowRef, watch } from 'vue'
import { mergePdfEntryWithNext, movePdfEntry, splitPdfEntryAtLines, updatePdfEntryOriginal } from '~/services/pdf'

interface PdfEntryEditingOptions {
  analysis: Ref<PdfAnalysis | null>
  translations: Ref<Map<string, string>>
  pageNumber: Readonly<Ref<number>>
  setMessage: (message: string) => void
}

/** 選択・原文下書き・除外を所有し、項目編集と関連する訳文の無効化を一緒に行う。 */
export function usePdfEntryEditing({ analysis, translations, pageNumber: previewPageNumber, setMessage }: PdfEntryEditingOptions) {
  /** PDF内で選択している文字項目のID。 */
  const selectedEntryId = ref<string | null>(null)
  /** 選択したPDF文字項目の、確定前の原文編集値。 */
  const originalDraft = ref('')
  /** 翻訳の書き出し対象から外すPDF文字項目のID。 */
  const excludedEntryIds = shallowRef(new Set<string>())
  /** 表示中ページに属する文字項目。 */
  const previewEntries = computed(() =>
    analysis.value?.entries.filter(
      entry => entry.pageNumber === previewPageNumber.value,
    ) ?? [],
  )
  /** 表示中ページから選択IDで求めた文字項目。 */
  const selectedEntry = computed(() =>
    previewEntries.value.find(entry => entry.id === selectedEntryId.value) ?? null,
  )
  /** 選択項目のページ内の順序と総数。 */
  const selectedEntryOrder = computed(() => ({
    index: previewEntries.value.findIndex(entry =>
      entry.id === selectedEntryId.value),
    total: previewEntries.value.length,
  }))
  /** 原文が複数の空でない行を持ち、行分割できるか。 */
  const canSplitSelectedEntry = computed(() =>
    originalDraft.value
      .split(/\r?\n/gu)
      .filter(line => line.trim())
      .length >= 2,
  )
  // 選択項目が変わったら原文の編集用下書きを入れ替える。
  watch(selectedEntry, (entry) => {
    originalDraft.value = entry?.original ?? ''
  }, { immediate: true })

  /** 選択したPDF項目を翻訳対象に含めるか切り替える。 */
  function toggleSelectedEntryExclusion() {
    const id = selectedEntryId.value
    if (!id)
      return
    const next = new Set(excludedEntryIds.value)
    if (next.has(id))
      next.delete(id)
    else next.add(id)
    excludedEntryIds.value = next
  }

  /** 原文の下書きを選択中のPDF項目へ確定する。 */
  function applySelectedEntryOriginal() {
    const current = analysis.value
    const entry = selectedEntry.value
    if (!current || !entry)
      return
    try {
      analysis.value = updatePdfEntryOriginal(
        current,
        entry.id,
        originalDraft.value,
      )
      const nextTranslations = new Map(translations.value)
      nextTranslations.delete(entry.id)
      translations.value = nextTranslations
      setMessage(`${entry.id} の抽出原文を更新しました。`)
    }
    catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : '抽出原文を更新できませんでした。')
    }
  }

  /** 選択したPDF文字項目の順序を前後へ移す。 */
  function moveSelectedEntry(direction: -1 | 1) {
    const current = analysis.value
    const id = selectedEntryId.value
    if (!current || !id)
      return
    analysis.value = movePdfEntry(current, id, direction)
  }

  /** 選択項目と次のPDF文字項目を結合する。 */
  function mergeSelectedEntry() {
    const current = analysis.value
    const entry = selectedEntry.value
    const nextEntry = previewEntries.value[selectedEntryOrder.value.index + 1]
    if (!current || !entry || !nextEntry)
      return
    const result = mergePdfEntryWithNext(current, entry.id)
    if (!result)
      return

    analysis.value = result.analysis
    const nextTranslations = new Map(translations.value)
    nextTranslations.delete(entry.id)
    for (const id of result.removedEntryIds)
      nextTranslations.delete(id)
    translations.value = nextTranslations

    const nextExcludedIds = new Set(excludedEntryIds.value)
    const shouldRemainExcluded = nextExcludedIds.has(entry.id)
      || result.removedEntryIds.some(id => nextExcludedIds.has(id))
    for (const id of result.removedEntryIds)
      nextExcludedIds.delete(id)
    if (shouldRemainExcluded)
      nextExcludedIds.add(result.retainedEntryId)
    excludedEntryIds.value = nextExcludedIds
    selectedEntryId.value = result.retainedEntryId
    setMessage(`${entry.id} と ${nextEntry.id} を結合しました。翻訳は未翻訳に戻しました。`)
  }

  /** 原文の改行を使ってPDF文字項目を分割する。 */
  function splitSelectedEntry() {
    const current = analysis.value
    const entry = selectedEntry.value
    if (!current || !entry)
      return
    const result = splitPdfEntryAtLines(current, entry.id, originalDraft.value)
    if (!result) {
      setMessage('分割するには、抽出原文を2行以上にしてください。')
      return
    }

    analysis.value = result.analysis
    const nextTranslations = new Map(translations.value)
    nextTranslations.delete(entry.id)
    for (const id of result.createdEntryIds)
      nextTranslations.delete(id)
    translations.value = nextTranslations

    if (excludedEntryIds.value.has(entry.id)) {
      const nextExcludedIds = new Set(excludedEntryIds.value)
      for (const id of result.createdEntryIds)
        nextExcludedIds.add(id)
      excludedEntryIds.value = nextExcludedIds
    }
    selectedEntryId.value = result.retainedEntryId
    setMessage(`${entry.id} を ${result.createdEntryIds.length + 1} 個の文字項目に分割しました。翻訳は未翻訳に戻しました。`)
  }

  /** 文書の読み込み・復元時に、その文書の除外設定と空の選択へ切り替える。 */
  function reset(excluded: Iterable<string> = []) {
    excludedEntryIds.value = new Set(excluded)
    selectedEntryId.value = null
    originalDraft.value = ''
  }

  return {
    selectedEntryId,
    originalDraft,
    excludedEntryIds: readonly(excludedEntryIds),
    previewEntries,
    selectedEntry,
    selectedEntryOrder,
    canSplitSelectedEntry,
    toggleSelectedEntryExclusion,
    applySelectedEntryOriginal,
    moveSelectedEntry,
    mergeSelectedEntry,
    splitSelectedEntry,
    reset,
  }
}
