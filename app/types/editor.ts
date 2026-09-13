export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type BackgroundMode = 'auto' | 'manual' | 'solid' | 'none'
export type AutoMaskPreset = 'auto' | 'light' | 'dark'
export type TranslationStatus = 'untranslated' | 'draft' | 'reviewed'
// Optional, user-defined classification; no card layout is assumed.
export type RegionRole = string

export interface MaskPoint { x: number, y: number }

export interface MaskStroke {
  brushSize: number
  points: MaskPoint[]
  mode?: 'paint' | 'erase'
}

export interface ExclusionArea {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface SourceIcon extends ExclusionArea {
  assetId: string
}

// 訳文文字列のUTF-16インデックスで表す半開区間 [start, end)。入力欄の選択位置と対応する。
export interface TextStyleRange {
  start: number
  end: number
  textColor?: string
  fontId?: string | null
}

export interface InlineAssetStyleRange {
  start: number
  end: number
  assetId: string
  scale?: number
  baselineOffset?: number
  inlinePadding?: number
}

// カード画像上の領域。x/yは元画像の画素座標、内部マスク・保護範囲・アイコンは領域内の相対座標。
export interface TextRegion {
  id: string
  regionId: string
  displayName: string
  role?: RegionRole
  sourceIcons?: SourceIcon[]
  ruby?: boolean
  rubyFontSize?: number
  rubyGap?: number
  x: number
  y: number
  width: number
  height: number
  originalText: string
  ocrLayout?: 'single-line' | 'sparse-text' | 'text-block'
  translatedText: string
  translationStatus: TranslationStatus
  textStyles: TextStyleRange[]
  inlineAssetStyles: InlineAssetStyleRange[]
  backgroundMode: BackgroundMode
  autoMaskPreset: AutoMaskPreset
  autoMaskSensitivity: number
  removeColorOutliers: boolean
  backgroundColor: string
  manualMaskStrokes: MaskStroke[]
  exclusionAreas: ExclusionArea[]
  textColor: string
  textStrokeColor: string
  textStrokeWidth: number
  fontSize: number
  autoFitFontSize: boolean
  fontId: string | null
  textAlign: TextAlign
  verticalAlign: VerticalAlign
}

// 共有アイコンの保存用定義。画像実体はimagePathで参照し、メモリ上の画像はruntimeが保持する。
export interface ImageAsset {
  id: string
  name: string
  sourceImageId: string
  sourceRect: RegionDraft
  imagePath: string
  scale: number
  baselineOffset: number
  inlinePadding: number
}

export interface AssetCreationDraft {
  editingAssetId: string | null
  name: string
  sourceRect: RegionDraft
  removeBackground: boolean
  backgroundColor: string | null
  backgroundThreshold: number
  edgeFeather: number
  manualMaskStrokes: MaskStroke[]
}

export interface FontReference {
  id: string
  displayName: string
  familyName: string
  fileName: string
  source: 'user' | 'system'
  postscriptName?: string
  style?: string
}

export interface OCRDictionaryEntry {
  id: string
  source: string
  replacement: string
}

export interface GlossaryEntry {
  id: string
  source: string
  translation: string
  note: string
}

export interface CardProject {
  imageName: string
  imageWidth: number
  imageHeight: number
  regions: TextRegion[]
}

export interface ImageDpi {
  x: number
  y: number
}

export interface PrintLayoutSettings {
  columns: 1 | 2 | 3
  marginMm: number
  gapMm: number
  cutMarks: boolean
}

export type FolderProjectCard = CardProject & {
  id: string
  imagePath: string
  printArea: RegionDraft | null
  sourceDpi: ImageDpi | null
}

export interface FolderProjectDocument {
  demoPreset?: 'sample-v1'
  version: 2
  name: string
  activeCardId: string
  cards: FolderProjectCard[]
  assets: ImageAsset[]
  fonts: FontReference[]
  ocrDictionary: OCRDictionaryEntry[]
  glossary: GlossaryEntry[]
  printSettings: PrintLayoutSettings
  layoutTemplates?: LayoutTemplate[]
}

export interface LayoutTemplate {
  id: string
  name: string
  imageWidth: number
  imageHeight: number
  regions: TextRegion[]
}

export type RegionDraft = Pick<TextRegion, 'x' | 'y' | 'width' | 'height'>
