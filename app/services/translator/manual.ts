import type { TranslationProvider } from './types'

/**
 * Keeps the current text unchanged. The UI uses this provider for manual input
 * and does not start an automatic translation request.
 */
export class ManualProvider implements TranslationProvider {
  /** 自動翻訳を行わず入力文字列をそのまま返す。 */
  async translate(
    text: string,
    _sourceLang: string,
    _targetLang: string,
  ): Promise<string> {
    return text
  }
}
