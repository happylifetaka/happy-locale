import type { TranslationSettings } from '~/services/translator/types'
import { onMounted, ref, watch } from 'vue'

/** 翻訳接続先が未設定の場合のローカルサーバーURL。 */
export const DEFAULT_TRANSLATION_ENDPOINT = 'http://localhost:4578'
/** ブラウザに保存する翻訳設定のキーと形式の世代。 */
export const TRANSLATION_SETTINGS_STORAGE_KEY
  = 'happy-locale.translation-settings.v1'

/** 翻訳方式と接続先の初期設定を作る。 */
function defaultSettings(): TranslationSettings {
  return {
    provider: 'manual',
    endpoint: DEFAULT_TRANSLATION_ENDPOINT,
  }
}

/** 保存値を検証し、利用できない設定は初期値へ戻す。 */
function parseSettings(value: string | null): TranslationSettings {
  if (!value)
    return defaultSettings()
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'provider' in parsed
      && (parsed.provider === 'manual' || parsed.provider === 'local' || parsed.provider === 'browser' || parsed.provider === 'sample')
      && 'endpoint' in parsed
      && typeof parsed.endpoint === 'string'
    ) {
      // 旧デモが保存したsampleは手動へ戻す。通常用の接続先は引き継ぐ。
      return { provider: parsed.provider === 'sample' ? 'manual' : parsed.provider, endpoint: parsed.endpoint }
    }
  }
  catch {
    // Ignore invalid settings and restore safe defaults.
  }
  return defaultSettings()
}

/** 翻訳方式と接続先をブラウザに保持する。保存値は読み込み時に検証してから使用する。 */
export function useTranslationSettings() {
  /** 現在有効な翻訳方式と接続先の設定。 */
  const settings = ref<TranslationSettings>(defaultSettings())
  /** ブラウザから保存済み翻訳設定を読み込み終えたか。 */
  const loaded = ref(false)

  // ブラウザの保存済み設定を読み込み、検証した値を初期状態へ反映する。
  onMounted(() => {
    try {
      settings.value = parseSettings(
        localStorage.getItem(TRANSLATION_SETTINGS_STORAGE_KEY),
      )
    }
    catch {
      settings.value = defaultSettings()
    }
    loaded.value = true
  })

  // 初期読み込み後の設定変更だけをブラウザへ保存する。
  watch(
    settings,
    (value) => {
      if (loaded.value) {
        try {
          localStorage.setItem(
            TRANSLATION_SETTINGS_STORAGE_KEY,
            JSON.stringify(value),
          )
        }
        catch {
          // Storage can be unavailable in privacy-restricted browser contexts.
        }
      }
    },
    { deep: true },
  )

  /** 渡された翻訳設定を複製し、現在の設定を差し替える。 */
  function updateSettings(value: TranslationSettings) {
    settings.value = { ...value }
  }

  return { settings, updateSettings }
}
