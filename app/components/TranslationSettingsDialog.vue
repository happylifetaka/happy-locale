<script setup lang="ts">
import type { TranslationSettings } from '~/services/translator/types'
import {
  LocalTranslationProvider,
  translationErrorMessage,
} from '~/services/translator/local'

const props = defineProps<{
  open: boolean
  settings: TranslationSettings
  endpointEnabled: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [settings: TranslationSettings]
}>()

/** 設定ダイアログで編集する複製。保存操作まで有効な設定を変えない。 */
const draft = ref<TranslationSettings>({ ...props.settings })
/** 翻訳接続先のヘルスチェック中か。 */
const checking = ref(false)
/** 接続確認の未実施・成功・失敗と応答情報。 */
const connectionStatus = ref<
  | { state: 'idle' }
  | { state: 'connected', provider?: string }
  | { state: 'failed', message: string }
>({ state: 'idle' })

// 設定画面を開いたら現在値を下書きへコピーし、接続結果を初期化する。
watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = { ...props.settings }
      connectionStatus.value = { state: 'idle' }
    }
  },
)

// 接続先が変わったら以前のヘルスチェック結果を無効にする。
watch(
  () => draft.value.endpoint,
  () => {
    connectionStatus.value = { state: 'idle' }
  },
)

/** 入力中の接続先へヘルスチェックを行う。設定の保存と原文の送信はこの操作では行わない。 */
async function checkConnection() {
  checking.value = true
  connectionStatus.value = { state: 'idle' }
  try {
    const health = await new LocalTranslationProvider(
      draft.value.endpoint,
    ).checkHealth()
    connectionStatus.value = {
      state: 'connected',
      ...(health.provider ? { provider: health.provider } : {}),
    }
  }
  catch (error) {
    connectionStatus.value = {
      state: 'failed',
      message: translationErrorMessage(error),
    }
  }
  finally {
    checking.value = false
  }
}

/** 入力中の翻訳設定を親へ渡す。 */
function save() {
  emit('save', {
    provider: draft.value.provider,
    endpoint: draft.value.endpoint.trim(),
  })
}
</script>

<template>
  <div
    v-if="open"
    class="confirmation-backdrop"
    @click.self="$emit('close')"
  >
    <section
      class="translation-settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="translation-settings-title"
      @keydown.esc="$emit('close')"
    >
      <h2 id="translation-settings-title">
        翻訳
      </h2>
      <fieldset>
        <legend>翻訳プロバイダー</legend>
        <label>
          <input v-model="draft.provider" type="radio" value="manual">
          手動
        </label>
        <label v-if="endpointEnabled">
          <input v-model="draft.provider" type="radio" value="local">
          Translation Endpoint（α）
        </label>
      </fieldset>
      <template v-if="endpointEnabled && draft.provider === 'local'">
        <label class="translation-endpoint-field">
          Endpoint
          <input
            v-model="draft.endpoint"
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="http://localhost:4578"
          >
        </label>
        <button
          type="button"
          :disabled="checking || !draft.endpoint.trim()"
          @click="checkConnection"
        >
          {{ checking ? '確認しています…' : '接続確認' }}
        </button>
        <div class="translation-connection-status" aria-live="polite">
          <strong>接続状態:</strong>
          <span v-if="checking">確認中</span>
          <span
            v-else-if="connectionStatus.state === 'connected'"
            class="translation-status-success"
          >
            ✓ 接続済み<span v-if="connectionStatus.provider">
              （{{ connectionStatus.provider }}）
            </span>
          </span>
          <span
            v-else-if="connectionStatus.state === 'failed'"
            class="translation-status-error"
          >{{ connectionStatus.message }}</span>
          <span v-else class="muted">未確認</span>
        </div>
        <p class="muted translation-security-note">
          α機能です。実際の翻訳サーバーとの結合動作は未確認です。HappyLocaleは指定したHTTP(S) Endpointへ翻訳対象のテキストと言語だけを送信します。外部URLを指定した場合、原文はその外部サービスへ送信されます。APIキーや認証情報は保持・送信しません。
        </p>
      </template>
      <div class="confirmation-actions">
        <button type="button" autofocus @click="$emit('close')">
          キャンセル
        </button>
        <button type="button" class="primary" @click="save">
          保存
        </button>
      </div>
    </section>
  </div>
</template>
