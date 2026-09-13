import type { TranslationStatus } from '~/types/editor'

/** 訳文が空なら未翻訳、入力があれば下書きの状態を返す。 */
export function statusForTranslation(text: string): TranslationStatus {
  return text.trim() ? 'draft' : 'untranslated'
}
