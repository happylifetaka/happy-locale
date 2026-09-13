export type TranslationProviderKind = 'manual' | 'local'

export interface TranslationProvider {
  translate: (
    text: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<string>
}

export interface TranslationSettings {
  provider: TranslationProviderKind
  endpoint: string
}

export interface TranslationServerHealth {
  status: 'ok'
  provider?: string
}

/** @deprecated Use TranslationProvider instead. */
export type Translator = TranslationProvider
