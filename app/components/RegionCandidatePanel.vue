<script setup lang="ts">
import type { RegionCandidate } from '~/services/ocr/types'

defineProps<{
  hasImage: boolean
  detectionDisabledReason?: string
  running: boolean
  progress: number | null
  status: string
  candidates: RegionCandidate[]
  selectedCandidateId: string | null
  canUndoChange: boolean
}>()

defineEmits<{
  detect: []
  toggle: [id: string]
  split: [id: string]
  undoChange: []
  selectAll: [selected: boolean]
  confirm: []
  cancel: []
}>()
</script>

<template>
  <section class="candidate-panel">
    <h2>領域候補</h2>
    <button
      v-if="candidates.length === 0"
      type="button"
      :disabled="!hasImage || running || !!detectionDisabledReason"
      @click="$emit('detect')"
    >
      {{ running ? '画像全体を解析しています…' : '領域候補を表示' }}
    </button>
    <template v-if="running">
      <progress v-if="progress !== null" :value="progress" max="1" />
      <small>{{ status }}</small>
    </template>
    <template v-if="candidates.length > 0">
      <p class="muted">
        チェックは追加対象です。画像上の候補をクリックすると青枠へ切り替わり、内部のドラッグで移動、辺や角のドラッグでサイズ変更できます。
      </p>
      <div class="candidate-actions">
        <button type="button" @click="$emit('selectAll', true)">
          すべて選択
        </button>
        <button type="button" @click="$emit('selectAll', false)">
          すべて解除
        </button>
        <button
          type="button"
          :disabled="!canUndoChange"
          @click="$emit('undoChange')"
        >
          候補変更を戻す
        </button>
      </div>
      <ol class="candidate-list">
        <li v-for="(candidate, index) in candidates" :key="candidate.id">
          <div
            class="candidate-item"
            :class="{ selected: candidate.id === selectedCandidateId }"
          >
            <label>
              <input
                type="checkbox"
                :checked="candidate.selected"
                @change="$emit('toggle', candidate.id)"
              >
              <span>
                {{ index + 1 }}. {{ candidate.text.replace(/\n/gu, ' / ') }}
                <small v-if="candidate.confidence !== null">
                  信頼度 {{ Math.round(candidate.confidence) }}%
                </small>
              </span>
            </label>
            <button
              v-if="candidate.lines.length >= 2"
              type="button"
              title="文章の中央付近で候補を上下に分けます"
              @click="$emit('split', candidate.id)"
            >
              上下に分割
            </button>
          </div>
        </li>
      </ol>
      <div class="candidate-actions candidate-actions-final">
        <button type="button" class="primary" @click="$emit('confirm')">
          選択した候補を追加
        </button>
        <button type="button" @click="$emit('cancel')">
          破棄
        </button>
      </div>
    </template>
    <small v-else-if="!running">
      {{ detectionDisabledReason || 'OCRで文字のまとまりを探し、未確定の領域候補として表示します。' }}
    </small>
  </section>
</template>
