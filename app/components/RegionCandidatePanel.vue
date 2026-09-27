<script setup lang="ts">
import type { RegionCandidate } from '~/types/ocr'

defineProps<{
  hasImage: boolean
  detectionDisabledReason?: string
  running: boolean
  progress: number | null
  status: string
  candidates: RegionCandidate[]
  selectedCandidateId: string | null
  canUndoChange: boolean
  iconReflectionAvailable?: boolean
  reflectIcons?: boolean
  cancellable?: boolean
}>()

defineEmits<{
  'detect': []
  'toggle': [id: string]
  'split': [id: string]
  'undoChange': []
  'selectAll': [selected: boolean]
  'confirm': []
  'cancel': []
  'stop': []
  'update:reflectIcons': [value: boolean]
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
      <button v-if="cancellable" type="button" @click="$emit('stop')">
        中止
      </button>
    </template>
    <div v-if="candidates.length > 0" class="candidate-review" :inert="running">
      <p class="muted">
        追加する候補を選択。枠は画像上で調整できます。
      </p>
      <details>
        <summary>候補の扱い</summary>
        <p class="muted">
          信頼度0%は除外、40%以下は未選択です。未確定の候補もプロジェクトに保存できます（デモを除く）。
        </p>
      </details>
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
      <label v-if="iconReflectionAvailable"><input type="checkbox" :checked="reflectIcons" @change="$emit('update:reflectIcons', ($event.target as HTMLInputElement).checked)">アイコンも反映</label>
      <div class="candidate-actions candidate-actions-final">
        <button type="button" class="primary" :disabled="running || !candidates.some(candidate => candidate.selected)" @click="$emit('confirm')">
          {{ iconReflectionAvailable && reflectIcons ? '追加・アイコン反映' : '選択した候補を追加' }}
        </button>
        <button type="button" @click="$emit('cancel')">
          破棄
        </button>
      </div>
    </div>
    <small v-else-if="!running">
      {{ detectionDisabledReason || 'OCRで文字のまとまりを探し、未確定の領域候補として表示します。' }}
    </small>
  </section>
</template>

<style scoped>
.candidate-review { display: grid; gap: 0.65rem; }
</style>
