<script setup lang="ts">
import type { TextRegion } from '~/types/editor'
import type { RegionStatusFilter } from '~/utils/region-filter'
import { filterRegions } from '~/utils/region-filter'

const props = defineProps<{
  regions: TextRegion[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  rename: [id: string, displayName: string]
  remove: [id: string]
  split: [id: string]
}>()

/** 一覧を絞り込む検索文字列。 */
const query = ref('')
/** 領域一覧の翻訳状態フィルター。 */
const status = ref<RegionStatusFilter>('all')
/** 表示名を編集中の領域ID。 */
const editingRegionId = ref<string | null>(null)
/** 確定前の領域表示名。 */
const displayNameDraft = ref('')
/** 改名開始時にフォーカスを移す入力要素。 */
const renameInput = ref<HTMLInputElement | null>(null)
/** 検索語と翻訳状態に一致する領域一覧。 */
const filteredRegions = computed(() =>
  filterRegions(props.regions, query.value, status.value),
)

/** 表示名の現在値を下書きへ移して改名を開始する。 */
function startRename(region: TextRegion) {
  editingRegionId.value = region.id
  displayNameDraft.value = region.displayName
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

/** 表示名の下書きを破棄して改名を終了する。 */
function cancelRename() {
  editingRegionId.value = null
  displayNameDraft.value = ''
}

/** 入力した領域名を親へ通知して改名を終了する。 */
function commitRename(region: TextRegion) {
  if (editingRegionId.value !== region.id)
    return
  const displayName = displayNameDraft.value.trim()
  cancelRename()
  if (displayName && displayName !== region.displayName)
    emit('rename', region.id, displayName)
}
</script>

<template>
  <section v-if="regions.length" class="region-list">
    <h3>領域一覧 ({{ regions.length }})</h3>
    <div class="region-list-filters">
      <input
        v-model="query"
        type="search"
        aria-label="領域を検索"
        placeholder="原文・訳文を検索"
      >
      <select v-model="status" aria-label="翻訳ステータスで絞り込み">
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
    <p v-if="filteredRegions.length === 0" class="muted">
      条件に一致する領域はありません。
    </p>
    <div
      v-for="region in filteredRegions"
      :key="region.id"
      class="region-list-item"
      :class="{ selected: region.id === selectedId }"
    >
      <button
        type="button"
        class="region-list-select"
        @click="$emit('select', region.id)"
      >
        <strong :class="{ 'region-list-name-placeholder': editingRegionId === region.id }">
          {{ region.displayName.trim() || region.regionId }}
        </strong>
        <small
          v-if="editingRegionId !== region.id"
          :class="`translation-status-${region.translationStatus}`"
        >
          {{
            region.translationStatus === 'reviewed'
              ? '確認済み'
              : region.translationStatus === 'draft' ? '下書き' : '未翻訳'
          }}
        </small>
        <span>{{
          region.translatedText || region.originalText || region.regionId
        }}</span>
      </button>
      <button type="button" class="region-split-button" :aria-label="`${region.displayName || region.regionId}を分割`" @click="emit('split', region.id)">
        分割…
      </button>
      <input
        v-if="editingRegionId === region.id"
        ref="renameInput"
        v-model="displayNameDraft"
        class="region-list-name-input"
        aria-label="領域名"
        @click.stop
        @keydown.enter.prevent="commitRename(region)"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename(region)"
      >
      <span class="region-list-actions">
        <button
          v-if="editingRegionId !== region.id"
          type="button"
          class="region-list-rename"
          :aria-label="`${region.displayName.trim() || region.regionId}の名前を変更`"
          title="領域名を変更"
          @click="startRename(region)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" />
            <path d="m13.5 7 3.5 3.5" />
          </svg>
        </button>
        <button
          type="button"
          class="region-list-remove"
          :aria-label="`${region.displayName.trim() || region.regionId}を削除`"
          title="領域を削除"
          @click="$emit('remove', region.id)"
        >
          ×
        </button>
      </span>
    </div>
  </section>
</template>
