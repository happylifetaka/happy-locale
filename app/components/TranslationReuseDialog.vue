<script setup lang="ts">
import type { ImageAsset, TextRegion } from '~/types/editor'
import type { ReusableTranslation } from '~/utils/translation-reuse'
import { translationConsistencyWarnings } from '~/utils/translation-reuse'

const props = defineProps<{ region: TextRegion, candidates: ReusableTranslation[], assets: ImageAsset[] }>()
const emit = defineEmits<{ close: [], apply: [translation: string] }>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
/** 再利用候補の選択位置。候補配列のインデックス。 */
const selected = ref(0)
/** 再利用候補を元に編集している、反映前の訳文。 */
const draft = ref(props.candidates[0]?.translation ?? '')
/** 現在の下書きに対する確認事項。 */
const warnings = computed(() => translationConsistencyWarnings(props.region.originalText, draft.value, props.assets))
// 候補選択が変わったら編集用の訳文を選択候補に入れ替える。
watch(selected, index => draft.value = props.candidates[index]?.translation ?? '')
// マウント後に既存訳の確認モーダルを開く。
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="reuse-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
    <h2 :id="titleId">
      既存訳を確認して再利用
    </h2>
    <p>空白・改行の違いを除いて原文が一致する候補です。文脈を確認し、必要なら修正してください。採用すると下書きになります。</p>
    <label>再利用する候補<select v-model="selected"><option v-for="(candidate, index) in candidates" :key="index" :value="index">{{ index + 1 }}: {{ candidate.translation }}</option></select></label>
    <p>出典: {{ candidates[selected]?.sources.join('、') }}</p>
    <label>照合した原文<textarea :value="region.originalText" rows="3" readonly /></label>
    <label>現在の訳文<textarea :value="region.translatedText" rows="3" readonly /></label>
    <label>再利用する訳文<textarea v-model="draft" rows="5" /></label>
    <ul v-if="warnings.length" role="status">
      <li v-for="warning in warnings" :key="warning">
        {{ warning }}
      </li>
    </ul>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!draft.trim()" @click="emit('apply', draft)">
        確認した訳文を反映
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.reuse-dialog { width: min(640px, calc(100vw - 48px)); max-height: 85vh; overflow: auto; border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; }
.reuse-dialog::backdrop { background: #0f172a88; }
label { display: grid; gap: 6px; margin-block: 12px; }
textarea, select { width: 100%; box-sizing: border-box; }
</style>
