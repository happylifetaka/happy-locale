<script setup lang="ts">
import type {
  TranslationMatchIssue,
  TranslationMatchResult,
} from '~/utils/csv'

defineProps<{
  fileName: string
  rowCount: number
  result: TranslationMatchResult
}>()

defineEmits<{
  apply: []
  cancel: []
}>()

/** CSV照合の問題種別を表示用ラベルへ変換する。 */
function issueLabel(issue: TranslationMatchIssue): string {
  if (issue.kind === 'unmatched')
    return '未一致'
  if (issue.kind === 'duplicate')
    return '重複'
  return '原文差異'
}

/** CSV照合で見つかった問題の詳細を表示用に組み立てる。 */
function issueDetail(issue: TranslationMatchIssue): string {
  if (issue.kind === 'unmatched')
    return '対象のカードまたは領域が見つかりません。'
  if (issue.kind === 'duplicate')
    return '同じ対象への後の行を適用します。'
  return `CSV: ${issue.importedOriginal || '（空）'} / 現在: ${issue.expectedOriginal || '（空）'}`
}
</script>

<template>
  <div class="confirmation-backdrop" @click.self="$emit('cancel')">
    <section
      class="confirmation-dialog csv-import-preview-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-preview-title"
      @keydown.esc="$emit('cancel')"
    >
      <h2 id="csv-import-preview-title">
        CSV照合結果
      </h2>
      <p><strong>{{ fileName }}</strong> の{{ rowCount }}行を確認しました。</p>
      <dl class="csv-import-summary">
        <div><dt>適用対象</dt><dd>{{ result.applied }}件</dd></div>
        <div><dt>未一致</dt><dd>{{ result.unmatched }}件</dd></div>
        <div><dt>重複</dt><dd>{{ result.duplicateRows }}件</dd></div>
        <div><dt>原文差異</dt><dd>{{ result.originalMismatches }}件</dd></div>
      </dl>
      <p v-if="result.issues.length === 0" class="csv-import-ready">
        不一致はありません。この内容をプロジェクトへ反映できます。
      </p>
      <div v-else class="csv-import-issues">
        <table>
          <thead>
            <tr><th>行</th><th>種類</th><th>対象</th><th>内容</th></tr>
          </thead>
          <tbody>
            <tr v-for="(issue, index) in result.issues" :key="`${issue.rowNumber}-${issue.kind}-${index}`">
              <td>{{ issue.rowNumber }}</td>
              <td>{{ issueLabel(issue) }}</td>
              <td><code>{{ issue.cardId || '—' }} / {{ issue.regionId || '—' }}</code></td>
              <td>{{ issueDetail(issue) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="result.originalMismatches > 0" class="muted">
        原文差異がある行も、適用するとCSVの訳文で更新されます。
      </p>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="$emit('cancel')">
          キャンセル
        </button>
        <button
          type="button"
          class="primary"
          :disabled="result.applied === 0"
          @click="$emit('apply')"
        >
          {{ result.applied }}件を反映
        </button>
      </div>
    </section>
  </div>
</template>
