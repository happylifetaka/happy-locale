<script setup lang="ts">
import type { OCRQueueCardState } from '~/services/ocr/queue'
import type { FolderProjectCard } from '~/types/editor'
import type { RegionStatusFilter } from '~/utils/region-filter'
import { cardProgress, progressLabel } from '~/utils/card-progress'
import { consumeSelectedFiles } from '~/utils/file-input'
import { filterProjectRegions } from '~/utils/region-filter'

const props = defineProps<{
  cards: FolderProjectCard[]
  activeCardId: string
  loadingCardId: string | null
  addingCards: boolean
  exportingCards: boolean
  canAddCards: boolean
  addCardsDisabledReason?: string
  thumbnails: ReadonlyMap<string, string>
  pendingDeletionIds: ReadonlySet<string>
  batchTranslationAvailable?: boolean
  batchTranslationCount?: number
  translationRunning?: boolean
  batchOcrRunning: boolean
  batchOcrCompleted: number
  batchOcrTotal: number
  batchOcrEligibleCount: number
  batchOcrStates: ReadonlyMap<string, OCRQueueCardState>
}>()

const emit = defineEmits<{
  select: [id: string]
  add: [files: File[]]
  addFolder: []
  exportPng: [id: string]
  exportJpeg: [id: string]
  exportCsv: [id: string]
  delete: [id: string]
  cancelDelete: [id: string]
  rename: [id: string, name: string]
  move: [id: string, direction: -1 | 1]
  exportAll: [format: 'png' | 'jpeg']
  selectRegion: [cardId: string, regionId: string]
  requestThumbnail: [cardId: string]
  startBatchOcr: []
  startBatchTranslation: []
  cancelBatchOcr: []
  openPrintLayout: []
}>()

/** カード一覧のスクロール領域。 */
const cardListPanel = ref<HTMLElement | null>(null)
/** サムネイルの遅延読み込みを監視する各カードのDOM要素。 */
const cardItems = ref<HTMLElement[]>([])
/** 画像ファイルを選ぶための非表示の入力要素。 */
const imageInput = ref<HTMLInputElement | null>(null)
/** 操作メニューを開いているカードID。 */
const menuCardId = ref<string | null>(null)
/** 名前の入力欄を表示しているカードID。 */
const renamingCardId = ref<string | null>(null)
/** 確定前のカード名の入力値。 */
const renameValue = ref('')
/** プロジェクト内の領域検索に使用する文字列。 */
const projectQuery = ref('')
/** プロジェクト内検索の翻訳状態フィルター。 */
const projectStatus = ref<RegionStatusFilter>('all')
/** 削除予定のカード数。 */
const pendingCount = computed(
  () => props.cards.filter(card => props.pendingDeletionIds.has(card.id)).length,
)
/** カード追加ができない理由。保存前の通常プロジェクトには既定の案内を使う。 */
const additionDisabledReason = computed(() => !props.canAddCards
  ? props.addCardsDisabledReason ?? '最初のカードをプロジェクト保存してから追加できます'
  : undefined)
/** 削除予定を除いたカード数。 */
const activeCount = computed(() => props.cards.length - pendingCount.value)
/** 検索語または翻訳状態で一覧を絞り込んでいるか。 */
const projectSearchActive = computed(() =>
  Boolean(projectQuery.value.trim()) || projectStatus.value !== 'all',
)
/** 削除予定を除き、検索条件に一致した領域と所属カード。 */
const projectSearchResults = computed(() =>
  projectSearchActive.value
    ? filterProjectRegions(
        props.cards.filter(card => !props.pendingDeletionIds.has(card.id)),
        projectQuery.value,
        projectStatus.value,
      )
    : [],
)
/** 一括OCRの確認待ち・空結果・失敗の件数。 */
const batchOCRResultSummary = computed(() => {
  let review = 0
  let empty = 0
  let errors = 0
  props.batchOcrStates.forEach((state) => {
    if (state.status === 'review')
      review += 1
    else if (state.status === 'empty')
      empty += 1
    else if (state.status === 'error')
      errors += 1
  })
  return [
    review > 0 ? `確認待ち${review}枚` : '',
    empty > 0 ? `候補なし${empty}枚` : '',
    errors > 0 ? `失敗${errors}枚` : '',
  ].filter(Boolean).join('、')
})

/** カードのOCR状態を一覧表示用の短いラベルへ変換する。 */
function batchOCRStateLabel(state: OCRQueueCardState | undefined) {
  if (!state)
    return ''
  if (state.status === 'queued')
    return 'OCR待機中'
  if (state.status === 'processing')
    return 'OCR解析中…'
  if (state.status === 'review')
    return `OCR候補 ${state.candidates}件`
  if (state.status === 'empty')
    return 'OCR候補なし'
  return 'OCR失敗'
}

/** OCR状態の詳細をツールチップ用に返す。 */
function batchOCRStateTitle(state: OCRQueueCardState | undefined) {
  return state?.status === 'error' ? state.message : undefined
}

/** カードの操作メニューを閉じる。 */
function closeMenu() {
  menuCardId.value = null
}

/** 指定カードの操作メニューを開閉する。 */
function toggleMenu(cardId: string) {
  menuCardId.value = menuCardId.value === cardId ? null : cardId
}

/** カード削除の要求を親へ通知する。 */
function requestDelete(cardId: string) {
  closeMenu()
  emit('delete', cardId)
}

/** カードの削除予定を取り消すよう親へ通知する。 */
function cancelDelete(cardId: string) {
  closeMenu()
  emit('cancelDelete', cardId)
}

/** 表示名の現在値を下書きへ移して改名を開始する。 */
function startRename(card: FolderProjectCard) {
  closeMenu()
  renamingCardId.value = card.id
  renameValue.value = card.imageName
}

/** 表示名の下書きを破棄して改名を終了する。 */
function cancelRename() {
  renamingCardId.value = null
  renameValue.value = ''
}

/** 入力したカード名を親へ通知して改名を終了する。 */
function confirmRename(card: FolderProjectCard) {
  const name = renameValue.value.trim()
  if (!name)
    return
  emit('rename', card.id, name)
  cancelRename()
}

/** 指定カードの画像書き出しを親へ要求する。 */
function exportCard(cardId: string, format: 'png' | 'jpeg') {
  closeMenu()
  if (format === 'png')
    emit('exportPng', cardId)
  else
    emit('exportJpeg', cardId)
}

/** 選択入力をリセットし、カード追加が許可されている場合だけ画像を親へ渡す。 */
function pickImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = consumeSelectedFiles(input)
  if (props.canAddCards && files.length > 0)
    emit('add', files)
}

/** 画面付近のカードだけ画像を読むための表示監視。 */
let thumbnailObserver: IntersectionObserver | null = null

/** 画面付近に入ったカードだけサムネイルを要求し、大量カードの初期読み込みを抑える。 */
function observeCardThumbnails() {
  thumbnailObserver?.disconnect()
  if (!('IntersectionObserver' in window)) {
    props.cards.forEach(card => emit('requestThumbnail', card.id))
    return
  }
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting)
          return
        const cardId = (entry.target as HTMLElement).dataset.cardId
        if (cardId)
          emit('requestThumbnail', cardId)
        thumbnailObserver?.unobserve(entry.target)
      })
    },
    { root: cardListPanel.value, rootMargin: '300px 0px' },
  )
  cardItems.value.forEach(item => thumbnailObserver?.observe(item))
}

// カード一覧のDOM更新後にサムネイルの表示監視を張り直す。
watch(
  () => props.cards.map(card => card.id),
  () => nextTick(observeCardThumbnails),
  { flush: 'post' },
)

// 一覧表示時に外側クリックとサムネイルの監視を開始する。
onMounted(() => {
  window.addEventListener('pointerdown', closeMenu)
  observeCardThumbnails()
})
// 一覧終了時にクリックイベントと表示監視を解除する。
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeMenu)
  thumbnailObserver?.disconnect()
})
</script>

<template>
  <aside ref="cardListPanel" class="card-list-panel" @keydown.esc="closeMenu">
    <header>
      <h2>カード一覧</h2>
      <div class="card-list-header-actions">
        <span>
          {{ activeCount }}枚
          <template v-if="pendingCount">・削除予定{{ pendingCount }}枚</template>
        </span>
        <details v-if="activeCount > 1" class="card-list-batch-export">
          <summary>{{ exportingCards ? '書出中…' : '一括保存' }}</summary>
          <div>
            <button
              type="button"
              :disabled="exportingCards || addingCards || loadingCardId !== null || batchOcrRunning"
              @click="$emit('exportAll', 'png')"
            >
              全カードをPNG保存
            </button>
            <button
              type="button"
              :disabled="exportingCards || addingCards || loadingCardId !== null || batchOcrRunning"
              @click="$emit('exportAll', 'jpeg')"
            >
              全カードをJPEG保存
            </button>
          </div>
        </details>
      </div>
    </header>
    <button
      type="button"
      class="card-list-print-link"
      :disabled="loadingCardId !== null || addingCards || exportingCards || batchOcrRunning"
      @click="$emit('openPrintLayout')"
    >
      <strong>PDF(A4)作成</strong>
      <small>
        印刷範囲 {{ cards.filter(card => card.printArea).length }}/{{ activeCount }}枚
      </small>
    </button>
    <section
      v-if="activeCount > 1 && (batchOcrEligibleCount > 1 || batchOcrTotal > 0)"
      class="card-list-batch-ocr"
      aria-label="複数カードのOCR"
    >
      <template v-if="batchOcrRunning">
        <div class="card-list-batch-ocr-progress" aria-live="polite">
          <span>一括OCR {{ batchOcrCompleted }}/{{ batchOcrTotal }}枚</span>
          <progress :value="batchOcrCompleted" :max="batchOcrTotal" />
        </div>
        <button type="button" @click="$emit('cancelBatchOcr')">
          現在のカード後に中止
        </button>
      </template>
      <template v-else-if="batchOcrEligibleCount > 1">
        <p>領域未作成の{{ batchOcrEligibleCount }}枚を1枚ずつ解析します。</p>
        <button
          type="button"
          :disabled="loadingCardId !== null || addingCards || exportingCards || batchOcrRunning"
          @click="$emit('startBatchOcr')"
        >
          まとめて領域検出
        </button>
      </template>
      <p v-else>
        一括OCR: {{ batchOCRResultSummary || '処理済み' }}
      </p>
    </section>
    <section v-if="batchTranslationAvailable" class="card-list-batch-ocr" aria-label="複数カードの翻訳">
      <p>{{ batchTranslationCount ?? 0 }}枚の原文・訳文をまとめて確認します。</p>
      <button
        type="button"
        :disabled="!batchTranslationCount || translationRunning || loadingCardId !== null || addingCards || exportingCards || batchOcrRunning"
        @click="$emit('startBatchTranslation')"
      >
        {{ translationRunning ? '翻訳候補を取得中…' : 'まとめて翻訳' }}
      </button>
    </section>
    <details class="project-region-search">
      <summary>プロジェクト内を検索</summary>
      <div class="project-region-search-controls">
        <input
          v-model="projectQuery"
          type="search"
          aria-label="プロジェクト内の領域を検索"
          placeholder="原文・訳文を検索"
        >
        <select v-model="projectStatus" aria-label="プロジェクト内を翻訳ステータスで絞り込み">
          <option value="all">
            すべて
          </option>
          <option value="untranslated">
            未翻訳
          </option>
          <option value="draft">
            下書き
          </option>
          <option value="reviewed">
            確認済み
          </option>
        </select>
      </div>
      <p v-if="!projectSearchActive" class="muted">
        検索語またはステータスを指定してください。
      </p>
      <p v-else-if="projectSearchResults.length === 0" class="muted">
        条件に一致する領域はありません。
      </p>
      <div v-else class="project-region-search-results">
        <button
          v-for="result in projectSearchResults"
          :key="`${result.cardId}-${result.region.id}`"
          type="button"
          :disabled="loadingCardId !== null || addingCards || exportingCards"
          @click="$emit('selectRegion', result.cardId, result.region.id)"
        >
          <small>{{ result.cardName }}</small>
          <strong>{{ result.region.displayName || result.region.regionId }}</strong>
          <span>{{ result.region.translatedText || result.region.originalText }}</span>
        </button>
      </div>
    </details>
    <ol>
      <li
        v-for="card in cards"
        ref="cardItems"
        :key="card.id"
        :data-card-id="card.id"
        class="card-list-item"
        :class="{ pending: pendingDeletionIds.has(card.id) }"
      >
        <form
          v-if="renamingCardId === card.id"
          class="card-list-rename"
          @submit.prevent="confirmRename(card)"
        >
          <label>
            カード名
            <input v-model="renameValue" autofocus>
          </label>
          <button type="submit" :disabled="!renameValue.trim()">
            変更
          </button>
          <button type="button" @click="cancelRename">
            キャンセル
          </button>
        </form>
        <button
          v-else
          class="card-list-select"
          type="button"
          :class="{ selected: card.id === activeCardId }"
          :disabled="
            loadingCardId !== null
              || addingCards
              || exportingCards
              || batchOcrRunning
              || pendingDeletionIds.has(card.id)
          "
          :aria-current="card.id === activeCardId ? 'true' : undefined"
          @click="$emit('select', card.id)"
        >
          <span class="card-thumbnail">
            <img
              v-if="thumbnails.get(card.id)"
              :src="thumbnails.get(card.id)"
              alt=""
              loading="lazy"
              decoding="async"
            >
            <span v-else aria-hidden="true">画像</span>
          </span>
          <span class="card-list-text">
            <strong>{{ card.imageName }}</strong>
            <small v-if="loadingCardId === card.id">読み込み中…</small>
            <small v-else-if="pendingDeletionIds.has(card.id)">
              削除予定
            </small>
            <small
              v-else-if="batchOcrStates.get(card.id)"
              class="card-ocr-state"
              :class="`is-${batchOcrStates.get(card.id)?.status}`"
              :title="batchOCRStateTitle(batchOcrStates.get(card.id))"
            >
              {{ batchOCRStateLabel(batchOcrStates.get(card.id)) }}
            </small>
            <span v-else class="card-progress">
              <small :title="`編集領域 ${card.regions.length}件`">
                領域 {{ card.regions.length }}
              </small>
              <small
                :title="`原文入力済み ${cardProgress(card.regions).originalText}/${card.regions.length}件`"
              >
                原文 {{ progressLabel(cardProgress(card.regions).originalText, card.regions.length) }}
              </small>
              <small
                :title="`訳文入力済み ${cardProgress(card.regions).translatedText}/${card.regions.length}件`"
              >
                訳 {{ progressLabel(cardProgress(card.regions).translatedText, card.regions.length) }}
              </small>
              <small
                :title="`確認済み ${cardProgress(card.regions).reviewed}/${card.regions.length}件`"
              >
                確認 {{ progressLabel(cardProgress(card.regions).reviewed, card.regions.length) }}
              </small>
              <small
                :class="{ 'needs-attention': !card.printArea || !card.sourceDpi }"
                :title="card.printArea
                  ? card.sourceDpi ? '印刷範囲とDPIを設定済み' : '印刷範囲は設定済み、DPIは未確認'
                  : '印刷範囲が未設定'"
              >
                印刷 {{ card.printArea ? card.sourceDpi ? '設定済' : 'DPI未確認' : '未設定' }}
              </small>
            </span>
          </span>
        </button>
        <div class="card-list-menu" @pointerdown.stop>
          <button
            type="button"
            class="card-list-menu-trigger"
            :disabled="loadingCardId !== null || addingCards || exportingCards || batchOcrRunning"
            :aria-expanded="menuCardId === card.id"
            :aria-controls="`card-menu-${card.id}`"
            :aria-label="`${card.imageName}の操作メニュー`"
            @click.stop="toggleMenu(card.id)"
          >
            ⋯
          </button>
          <div
            v-if="menuCardId === card.id"
            :id="`card-menu-${card.id}`"
            class="card-list-menu-popup"
            role="menu"
          >
            <template v-if="!pendingDeletionIds.has(card.id)">
              <button
                type="button"
                role="menuitem"
                @click="startRename(card)"
              >
                名前を変更
              </button>
              <button
                type="button"
                role="menuitem"
                :disabled="pendingCount > 0 || cards.findIndex(item => item.id === card.id) === 0"
                @click="$emit('move', card.id, -1); closeMenu()"
              >
                上へ移動
              </button>
              <button
                type="button"
                role="menuitem"
                :disabled="pendingCount > 0 || cards.findIndex(item => item.id === card.id) === cards.length - 1"
                @click="$emit('move', card.id, 1); closeMenu()"
              >
                下へ移動
              </button>
              <button
                type="button"
                role="menuitem"
                @click="exportCard(card.id, 'png')"
              >
                PNG保存
              </button>
              <button
                type="button"
                role="menuitem"
                @click="exportCard(card.id, 'jpeg')"
              >
                JPEG保存
              </button>
              <button
                type="button"
                role="menuitem"
                @click="$emit('exportCsv', card.id); closeMenu()"
              >
                翻訳CSV保存
              </button>
            </template>
            <button
              v-if="pendingDeletionIds.has(card.id)"
              type="button"
              role="menuitem"
              class="restore"
              @click="cancelDelete(card.id)"
            >
              削除を取り消す
            </button>
            <button
              v-else
              type="button"
              role="menuitem"
              class="delete"
              :disabled="activeCount <= 1"
              :title="activeCount <= 1 ? '最後の1枚は削除できません' : undefined"
              @click="requestDelete(card.id)"
            >
              カードを削除
            </button>
          </div>
        </div>
      </li>
      <li class="card-list-add">
        <button
          type="button"
          class="card-list-add-files"
          :disabled="
            loadingCardId !== null
              || addingCards
              || exportingCards
              || batchOcrRunning
              || !canAddCards
              || pendingCount > 0
          "
          :title="
            additionDisabledReason
              ?? (pendingCount > 0
                ? 'カードを追加する前に削除予定を保存または取り消してください'
                : undefined)
          "
          @click="imageInput?.click()"
        >
          <span aria-hidden="true">＋</span>
          <strong>{{ addingCards ? '追加しています…' : 'カードを追加' }}</strong>
          <small v-if="canAddCards && pendingCount > 0">
            削除予定を保存または取り消してください
          </small>
          <small v-else-if="canAddCards">PNG / JPEGを複数選択できます</small>
        </button>
        <button
          type="button"
          class="card-list-add-folder"
          :disabled="
            loadingCardId !== null
              || addingCards
              || exportingCards
              || batchOcrRunning
              || !canAddCards
              || pendingCount > 0
          "
          @click="$emit('addFolder')"
        >
          フォルダから追加
        </button>
        <p v-if="additionDisabledReason" class="muted">
          {{ additionDisabledReason }}
        </p>
        <input
          ref="imageInput"
          class="visually-hidden"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          :disabled="!canAddCards"
          @change="pickImages"
        >
      </li>
    </ol>
  </aside>
</template>
