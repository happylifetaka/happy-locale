import type { OCRDictionaryEntry } from '~/types/editor'

export interface OCRCorrectionChange {
  original: string
  corrected: string
  line: number
  reason: 'confusable-characters' | 'spacing' | 'user-dictionary'
}

export interface OCRCorrectionResult {
  correctedText: string
  changes: OCRCorrectionChange[]
}

export interface OCRCorrector {
  correct: (
    text: string,
    dictionary?: readonly OCRDictionaryEntry[],
  ) => Promise<OCRCorrectionResult>
}
