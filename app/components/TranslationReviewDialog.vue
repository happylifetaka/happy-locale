<script setup lang="ts">
import type { FolderProjectCard, GlossaryEntry, ImageAsset } from '~/types/editor'
import type { TranslationMatchResult } from '~/utils/csv'
import type { TranslationReviewRow } from '~/utils/translation-review'
import { matchProjectTranslationRows, parseTranslationCsv } from '~/utils/csv'
import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'
import { findReusableTranslations } from '~/utils/translation-reuse'
import { createTranslationReviewRows, mergeReviewImport, reviewApplySelection, reviewWarnings } from '~/utils/translation-review'

const props = defineProps<{
  cards: FolderProjectCard[]
  activeCardId: string
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  glossary: GlossaryEntry[]
  initialImport?: TranslationMatchResult
  autoTranslate?: boolean
  loadImage: (cardId: string) => Promise<Blob>
  translate?: (text: string) => Promise<string>
  error?: string
  appliedRows?: { key: string, translation: string }[]
}>()
const emit = defineEmits<{ close: [], apply: [rows: TranslationReviewRow[], closeAfterApply: boolean], locate: [cardId: string, regionId: string] }>()
/** モーダル専用の下書き。親が反映を受理するまで元のカード本文は変更しない。 */
const rows = ref(createTranslationReviewRows(props.cards))
/** 翻訳確認一覧の未翻訳・要確認・変更あり等の表示条件。 */
const filter = ref('all')
/** 翻訳確認一覧を絞り込むカードID。空なら全カード。 */
const cardFilter = ref('')
/** 一覧を絞り込む検索文字列。 */
const query = ref('')
/** 翻訳確認一覧で表示中のページ位置。0から始まる。 */
const page = ref(0)
/** 入力によって条件から外れても画面に残す翻訳行のキー。 */
const pinnedKeys = ref(new Set<string>())
/** 操作結果や失敗理由を画面へ通知するメッセージ。 */
const message = ref('')
/** 翻訳候補をまとめて取得しているか。 */
const busy = ref(false)
/** 未反映の変更を破棄するか確認するダイアログ。 */
const discardDialog = ref<HTMLDialogElement | null>(null)
/** 翻訳確認画面でCSVを選択する入力要素。 */
const fileInput = ref<HTMLInputElement | null>(null)
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLElement | null>(null)
/** 翻訳行のキーと訳文入力欄の対応表。挿入時のカーソル操作に使う。 */
const inputs = new Map<string, HTMLTextAreaElement>()
/** 原画像の確認表示に使うカードIDごとの一時URL。 */
const imageUrls = ref(new Map<string, string>())
/** 原画像を読み込めなかったカードID。 */
const imageErrors = ref(new Set<string>())
/** 原画像を重複して読み込まないための処理中カードID。 */
const pendingImages = new Set<string>()
/** 確認画面がまだ存在し、非同期結果を受け取れるか。 */
let alive = true
/** 翻訳行のキーごとに計算した原文・訳文の確認事項。 */
const warnings = computed(() => new Map(rows.value.map(row => [row.key, reviewWarnings(row, props.assets)])))
/** 確認行の下書きが元の訳文から変わっているかを判定する。 */
const changed = (row: TranslationReviewRow) => row.translation !== row.region.translatedText
/** 元の訳文から内容が変わった確認行。 */
const changes = computed(() => rows.value.filter(changed))
/** 反映対象としてチェックされた翻訳行。 */
const selected = computed(() => rows.value.filter(row => row.selected))
/** 選択されていて、元の訳文から変更がある行。 */
const selectedChanges = computed(() => selected.value.filter(changed))
/** 確認事項が一つ以上ある翻訳行の数。 */
const problemCount = computed(() => rows.value.filter(row => warnings.value.get(row.key)?.length).length)
/** 訳文が空の確認行の数。 */
const untranslatedCount = computed(() => rows.value.filter(row => !row.translation.trim()).length)
/** 表示条件に一致する行と、編集中のため固定した行。 */
const filtered = computed(() => rows.value.filter(row => pinnedKeys.value.has(row.key) || (
  (!cardFilter.value || row.cardId === cardFilter.value)
  && (!query.value.trim() || `${row.cardName} ${row.region.displayName} ${row.region.originalText} ${row.translation}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
  && (filter.value === 'all' || (filter.value === 'empty' && !row.translation.trim())
    || (filter.value === 'issues' && warnings.value.get(row.key)?.length)
    || (filter.value === 'changed' && changed(row)))),
))
/** 現在のページへ表示する最大20件の確認行。 */
const visible = computed(() => filtered.value.slice(page.value * 20, page.value * 20 + 20))
// 検索・表示条件を変えたら先頭ページへ戻り、編集中の行固定を解除する。
watch([filter, cardFilter, query], () => {
  page.value = 0
  pinnedKeys.value.clear()
})
// 絞り込みでページが減った場合に現在ページを有効範囲へ戻す。
watch(() => filtered.value.length, () => {
  page.value = Math.min(page.value, Math.max(0, Math.ceil(filtered.value.length / 20) - 1))
})
// 反映済みの行だけ比較基準を更新し、未選択の入力と未反映件数を維持する。
watch(() => props.appliedRows, (applied) => {
  for (const item of applied ?? []) {
    const row = rows.value.find(row => row.key === item.key)
    if (!row)
      continue
    row.region.translatedText = item.translation
    row.region.translationStatus = item.translation.trim() ? 'draft' : 'untranslated'
    row.selected = false
    row.importWarnings = []
  }
  message.value = `${applied?.length ?? 0}件を反映しました。${changes.value.length ? `未反映の変更が${changes.value.length}件残っています。` : 'カード上で見た目を確認できます。'}`
})

/** CSVの照合結果を翻訳確認の下書きへ取り込む。 */
function importResult(result: TranslationMatchResult) {
  mergeReviewImport(rows.value, result)
  message.value = `${result.applied}件の候補を読み込みました。未一致${result.unmatched}件・重複${result.duplicateRows}件・原文差異${result.originalMismatches}件。`
  filter.value = 'all'
}
if (props.initialImport)
  importResult(props.initialImport)

/** 選択したCSVを検証して翻訳確認の下書きへ取り込む。 */
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  try {
    assertFileSize(file, FILE_LIMITS.textBytes, 'CSV')
    importResult(matchProjectTranslationRows(props.cards, props.activeCardId, parseTranslationCsv(await file.text())))
  }
  catch (error) { message.value = error instanceof Error ? error.message : 'CSVを読み込めませんでした。' }
}

/** 入力でフィルター条件から外れても編集中の行が消えないよう固定し、反映対象に選ぶ。 */
function update(row: TranslationReviewRow, value: string) {
  pinnedKeys.value.add(row.key)
  row.translation = value
  row.error = ''
  row.selected = true
}
/** 訳文のカーソル位置へアセットトークンを挿入する。 */
function insertAsset(row: TranslationReviewRow, asset: ImageAsset) {
  const input = inputs.get(row.key)
  const start = input?.selectionStart ?? row.translation.length
  const end = input?.selectionEnd ?? start
  const token = `[icon:${asset.name}]`
  update(row, row.translation.slice(0, start) + token + row.translation.slice(end))
  nextTick(() => {
    input?.focus()
    input?.setSelectionRange(start + token.length, start + token.length)
  })
}
/** 一意に決まる既存訳を採用し、複数候補なら確認を促す。 */
function reuse(row: TranslationReviewRow) {
  const candidates = findReusableTranslations(row.region, row.cardId, props.cards, props.glossary)
  if (candidates.length === 1)
    update(row, candidates[0]!.translation)
  else message.value = candidates.length ? '同じ原文に複数の訳があります。原文を検索して、使う訳を確認してください。' : '同じ原文の既存訳はありません。'
}
/** 選択行があればそれを優先し、なければ絞り込み結果の未翻訳を順番に取得する。 */
async function fillCandidates() {
  if (!props.translate || busy.value)
    return
  busy.value = true
  const targets = (selected.value.length ? selected.value : filtered.value).filter(row => row.region.originalText.trim() && !row.translation.trim())
  for (const row of targets) {
    if (!alive)
      break
    try {
      update(row, await props.translate(row.region.originalText))
    }
    catch (error) { row.error = error instanceof Error ? error.message : '翻訳候補を取得できませんでした。' }
  }
  busy.value = false
  message.value = `${targets.length}件の取得が完了しました。候補を確認して反映してください。`
}
/** 未反映の編集があれば破棄を確認し、なければ確認画面を閉じる。 */
function close() {
  if (busy.value)
    return
  if (changes.value.length)
    discardDialog.value?.showModal()
  else emit('close')
}
/** 選択された変更行を親へ渡して反映を要求する。 */
function applySelected() {
  const selection = reviewApplySelection(rows.value)
  if (!busy.value && selection.rows.length)
    emit('apply', selection.rows, selection.closeAfterApply)
}
/** Tab操作でフォーカスが確認画面の外へ出ないよう循環させる。 */
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab')
    return
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary') ?? [])].filter(element => element.getClientRects().length)
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) {
    event.preventDefault()
    first?.focus()
  }
}
/** 現在のページに必要な原画像だけ読み込む。閉じた後に完了した結果のURLは作らない。 */
async function loadVisibleImages() {
  for (const cardId of new Set(visible.value.map(row => row.cardId))) {
    if (pendingImages.has(cardId) || imageUrls.value.has(cardId) || imageErrors.value.has(cardId))
      continue
    pendingImages.add(cardId)
    try {
      const blob = await props.loadImage(cardId)
      if (alive)
        imageUrls.value.set(cardId, URL.createObjectURL(blob))
    }
    catch {
      if (alive)
        imageErrors.value.add(cardId)
    }
    finally { pendingImages.delete(cardId) }
  }
}
// 表示ページが変わったら必要な原画像だけを読み込む。
watch(visible, loadVisibleImages)
// 確認画面へフォーカスを移し、原画像と要求された翻訳候補を取得する。
onMounted(() => {
  dialog.value?.focus()
  void loadVisibleImages()
  if (props.autoTranslate)
    void fillCandidates()
})
// 画面終了後の結果反映を止め、原画像の一時URLを解放する。
onBeforeUnmount(() => {
  alive = false
  imageUrls.value.forEach(url => URL.revokeObjectURL(url))
})
</script>

<template>
  <div class="confirmation-backdrop review-backdrop">
    <section ref="dialog" class="translation-review" role="dialog" aria-modal="true" aria-labelledby="review-title" tabindex="-1" @keydown="trapFocus" @keydown.esc.stop.prevent="close">
      <header class="review-header">
        <div>
          <h2 id="review-title">
            翻訳をまとめて確認
          </h2><p>{{ cards.length }}枚・{{ rows.length }}領域 <span>未翻訳 {{ untranslatedCount }} / 要確認 {{ problemCount }} / 変更 {{ changes.length }}</span></p>
        </div>
        <button type="button" :disabled="busy" @click="close">
          閉じる
        </button>
      </header>
      <div class="review-tools">
        <label>カード<select v-model="cardFilter"><option value="">すべてのカード</option><option v-for="card in cards" :key="card.id" :value="card.id">{{ card.imageName }}</option></select></label>
        <label>表示<select v-model="filter"><option value="all">すべて</option><option value="empty">未翻訳</option><option value="issues">要確認</option><option value="changed">変更あり</option></select></label>
        <label class="review-search">検索<input v-model="query" placeholder="原文・訳文・カード名"></label>
        <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="importFile">
        <button type="button" :disabled="busy" @click="fileInput?.click()">
          CSVを読み込む
        </button>
        <button v-if="translate" type="button" :disabled="busy" @click="fillCandidates">
          {{ busy ? '取得しています…' : selected.length ? '選択した未翻訳を取得' : '表示中の未翻訳を取得' }}
        </button>
      </div>
      <p v-if="message || error" class="review-message" role="status">
        {{ error || message }}
      </p>
      <div class="review-selection">
        <button type="button" :disabled="busy" @click="filtered.forEach(row => row.selected = true)">
          表示中をすべて選択
        </button><button type="button" @click="rows.forEach(row => row.selected = false)">
          すべて解除
        </button><span>訳文は反映するまで保存されません。アセットの順序変更は不一致に含めません。</span>
      </div>
      <div class="review-body">
        <p v-if="!visible.length" class="review-empty">
          該当する領域はありません。
        </p>
        <article v-for="row in visible" :key="row.key" class="review-row" :class="{ 'has-issues': warnings.get(row.key)?.length }">
          <header><label><input v-model="row.selected" type="checkbox" :disabled="busy">{{ row.cardName }} <strong>{{ row.region.displayName || row.region.regionId }}</strong></label><span>{{ changed(row) ? '変更あり' : row.region.translationStatus === 'reviewed' ? '確認済み' : row.translation.trim() ? '下書き' : '未翻訳' }}</span></header>
          <div class="review-columns">
            <div class="review-source-image">
              <span class="review-label">原画像</span><RegionSourcePreview v-if="imageUrls.get(row.cardId)" :src="imageUrls.get(row.cardId)!" :region="row.region" :image-width="cards.find(card => card.id === row.cardId)!.imageWidth" :image-height="cards.find(card => card.id === row.cardId)!.imageHeight" /><p v-else>
                {{ imageErrors.has(row.cardId) ? '画像を読み込めませんでした' : '画像を読み込み中…' }}
              </p><button type="button" :disabled="changes.length > 0 || busy" @click="emit('locate', row.cardId, row.region.id)">
                カード上で確認
              </button>
            </div>
            <div>
              <span class="review-label">原文</span><p class="review-original">
                <AssetTextPreview :text="row.region.originalText || '原文なし'" :assets="assets" :asset-images="assetImages" />
              </p>
            </div>
            <div class="review-translation">
              <div class="review-field-heading">
                <label :for="`review-${row.key}`">日本語訳</label><AssetInsertPicker v-if="!busy" :assets="assets" :asset-images="assetImages" target-label="日本語訳" @insert="insertAsset(row, $event)" />
              </div><textarea :id="`review-${row.key}`" :ref="el => { if (el) inputs.set(row.key, el as HTMLTextAreaElement); else inputs.delete(row.key) }" :value="row.translation" :rows="row.region.ocrLayout === 'single-line' ? 2 : 4" :disabled="busy" @input="update(row, ($event.target as HTMLTextAreaElement).value)" /><button type="button" :disabled="busy" @click="reuse(row)">
                同じ原文の訳を再利用
              </button>
              <p v-if="row.translation.includes('[icon:')" class="review-original">
                <AssetTextPreview :text="row.translation" :assets="assets" :asset-images="assetImages" />
              </p>
              <ul v-if="warnings.get(row.key)?.length" class="review-warnings" role="status">
                <li v-for="warning in warnings.get(row.key)" :key="warning">
                  {{ warning }}
                </li>
              </ul>
            </div>
          </div>
        </article>
      </div>
      <footer class="review-footer">
        <div>
          <button type="button" :disabled="page === 0" @click="page--">
            前へ
          </button><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(filtered.length / 20)) }}</span><button type="button" :disabled="(page + 1) * 20 >= filtered.length" @click="page++">
            次へ
          </button>
        </div>
        <span>{{ selected.length }}件を選択中（変更 {{ selectedChanges.length }}件）</span>
        <button type="button" class="primary" :disabled="!selectedChanges.length || busy" @click="applySelected">
          選択した変更{{ selectedChanges.length }}件を反映
        </button>
      </footer>
    </section>
    <dialog
      ref="discardDialog"
      class="confirmation-dialog review-discard-dialog"
      aria-labelledby="review-discard-title"
      aria-describedby="review-discard-description"
      @cancel.prevent="discardDialog?.close()"
    >
      <h2 id="review-discard-title">
        未反映の変更が{{ changes.length }}件あります
      </h2>
      <p id="review-discard-description">
        閉じると、この変更は失われます。
      </p>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="discardDialog?.close()">
          編集を続ける
        </button>
        <button type="button" class="confirmation-danger" @click="emit('close')">
          変更を破棄して閉じる
        </button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.review-backdrop { padding: 1rem; }
.review-discard-dialog { margin: auto; border: 0; }
.review-discard-dialog::backdrop { background: #0008; }
.review-discard-dialog .confirmation-actions { flex-wrap: wrap; }
.translation-review { width: min(1440px, 98vw); height: 94dvh; display: flex; flex-direction: column; background: #f5f7fa; border-radius: 0.75rem; overflow: hidden; color: #263247; }
.review-header, .review-tools, .review-selection, .review-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 0.65rem; padding: 0.85rem 1.2rem; background: white; border-bottom: 1px solid #d5dbe3; }
.review-header, .review-footer { justify-content: space-between; }
.review-header h2 { margin: 0; font-size: 1.2rem; }
.review-header p { margin: 0.4rem 0 0; font-size: 0.8rem; }
.review-header p span { margin-left: 1rem; color: #607089; }
.review-tools label { display: grid; gap: 0.25rem; font-size: 0.75rem; }
.review-tools input, .review-tools select, textarea { padding: 0.5rem; border: 1px solid #cbd2dc; border-radius: 0.35rem; font: inherit; background: white; color: inherit; }
.review-search { flex: 1; min-width: 10rem; }
.review-selection { font-size: 0.75rem; }
.review-selection span { color: #607089; }
.review-message { margin: 0; padding: 0.6rem 1.2rem; background: #edf3ff; font-size: 0.85rem; }
.review-body { flex: 1; min-height: 0; overflow: auto; padding: 1rem; }
.review-row { background: white; border: 1px solid #d5dbe3; border-radius: 0.6rem; margin-bottom: 0.85rem; }
.review-row.has-issues { border-left: 3px solid #d6a344; }
.review-row > header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; padding: 0.7rem 1rem; border-bottom: 1px solid #edf0f5; font-size: 0.8rem; }
.review-row > header label { display: flex; align-items: center; gap: 0.6rem; }
.review-row > header span { color: #607089; }
.review-columns { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr) minmax(0, 1.4fr); gap: 1.2rem; padding: 1rem; }
.review-columns > div { min-width: 0; }
.review-label, .review-field-heading { font-size: 0.8rem; font-weight: 600; color: #49566a; }
.review-field-heading { display: flex; justify-content: space-between; align-items: center; }

.review-original { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.9rem; line-height: 1.7; margin: 0.5rem 0; }
textarea { display: block; width: 100%; resize: vertical; line-height: 1.6; margin-bottom: 0.4rem; }
.review-warnings li { white-space: pre-line; }
.review-warnings { padding-left: 1.2rem; margin: 0.6rem 0 0; font-size: 0.78rem; color: #885600; }
.review-footer { border-top: 1px solid #d5dbe3; border-bottom: 0; }
.review-footer > div { display: flex; align-items: center; gap: 0.6rem; }
.review-empty { text-align: center; color: #607089; padding: 2rem; }
@media (max-width: 850px) { .review-columns { grid-template-columns: 1fr; } .translation-review { height: 98dvh; } .review-backdrop { padding: 0.25rem; } }
</style>
