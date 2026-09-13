import type { Translator } from './types'

export class MockTranslator implements Translator {
  /** テスト等の代替実装として入力文字列をそのまま返す。 */
  async translate(
    text: string,
    _sourceLang: string,
    _targetLang: string,
  ): Promise<string> {
    return text
  }
}
