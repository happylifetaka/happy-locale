import type { OCRResult } from '~/services/ocr/types'
import type { FolderProjectDocument } from '~/types/editor'

/** Synthetic data only. Coordinates and text are not taken from private cards. */
export function baselineOCR(): OCRResult {
  return {
    text: 'Synthetic Card\n$ CASTLE 4\nChoose an ally.\nDraw two cards.\nnoise text\nzero noise',
    confidence: 70,
    blocks: [
      { text: 'Synthetic Card', x: 40, y: 20, width: 240, height: 40, confidence: 95 },
      { text: '$ CASTLE 4', x: 40, y: 120, width: 240, height: 32, confidence: 55 },
      { text: 'Choose an ally.', x: 30, y: 170, width: 260, height: 28, confidence: 90 },
      { text: 'Draw two cards.', x: 30, y: 210, width: 260, height: 28, confidence: 80 },
      { text: 'noise text', x: 30, y: 300, width: 100, height: 24, confidence: 34 },
      { text: 'zero noise', x: 30, y: 360, width: 100, height: 24, confidence: 0 },
    ],
    words: [
      { text: '$', x: 40, y: 120, width: 30, height: 32, confidence: 10 },
      { text: 'CASTLE', x: 80, y: 120, width: 120, height: 32, confidence: 93 },
      { text: '4', x: 245, y: 120, width: 30, height: 32, confidence: 50 },
    ],
  }
}

export function baselineProject(): FolderProjectDocument {
  return {
    version: 4,
    name: 'Synthetic regression project',
    activeCardId: 'synthetic-1',
    cards: [{
      id: 'synthetic-1',
      imagePath: 'images/synthetic-1.png',
      imageName: 'synthetic.png',
      imageWidth: 200,
      imageHeight: 240,
      regions: [],
      printArea: null,
      sourceDpi: { x: 300, y: 300 },
    }],
    assets: [],
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
  }
}
