import type { OCRProgress, OCRProvider, OCRResult } from '~/services/ocr/types'
import type { IconOccurrence } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset, SourceIcon, TextRegion } from '~/types/editor'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { validateAssetName } from '~/utils/assets'
import { assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'
import { regionTextLayout } from '~/utils/region-text-layout'
import { sourceIconProblems, textWithSourceIcons } from '~/utils/source-icons'
import { ASSET_DISCOVERY_LIMITS, parseAssetDiscovery } from './format'
import { containsBounds, proposedSourceIcons } from './review'

export interface SourceIconOCRContext {
  card: Pick<FolderProjectCard, 'id' | 'imageWidth' | 'imageHeight' | 'regions'>
  occurrences: readonly IconOccurrence[]
  assets: readonly ImageAsset[]
  /** 元画像・PNGの実バイトから確認した値。未読込の推測値を入れない。 */
  imageDigest: string
  assetDigests: ReadonlyMap<string, string>
}

export interface SourceIconOCRScope {
  session: symbol
  /** 編集→Undo・画像変更→復元でも呼出元が世代を進め、古い案を復活させない。 */
  revision: number
}

export interface SourceIconOCRDraft {
  readonly cardId: string
  readonly regionId: string
  readonly occurrenceIds: readonly string[]
  /** 画像への影響を確認するための独立コピー。Store・通常履歴には入れない。 */
  readonly region: Readonly<TextRegion>
}

export interface SourceIconOCRPreview {
  readonly draft: SourceIconOCRDraft
  readonly originalText: string
  readonly confidence: number | null
}

interface DraftSnapshot {
  signature: string
  session: symbol
  revision: number
  assets: ImageAsset[]
}
const drafts = new WeakMap<SourceIconOCRDraft, DraftSnapshot>()
const previews = new WeakSet<SourceIconOCRPreview>()
const hash = (value: string | undefined): boolean => /^[a-f0-9]{64}$/u.test(value ?? '')
export const SOURCE_ICON_OCR_LIMITS = Object.freeze({ words: 10000 })

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree)
    Object.freeze(value)
  }
  return value
}

function inspect(context: SourceIconOCRContext, regionId: string, occurrenceIds: readonly string[], scope: SourceIconOCRScope) {
  const { card, assets } = context
  assertImageDimensions(card.imageWidth, card.imageHeight)
  const region = card.regions.find(item => item.id === regionId)
  if (!card.id.trim() || !hash(context.imageDigest) || typeof scope.session !== 'symbol' || !Number.isSafeInteger(scope.revision) || scope.revision < 0
    || card.regions.length > FILE_LIMITS.projectRegionsPerCard || card.regions.filter(item => item.id === regionId).length !== 1
    || !region || !containsBounds({ x: 0, y: 0, width: card.imageWidth, height: card.imageHeight }, region)) {
    throw new Error('再OCRの対象領域・元画像・レビュー世代を確認してください。')
  }
  if (!occurrenceIds.length || occurrenceIds.length > ASSET_DISCOVERY_LIMITS.perCard || new Set(occurrenceIds).size !== occurrenceIds.length
    || context.occurrences.length > ASSET_DISCOVERY_LIMITS.project || assets.length > FILE_LIMITS.projectAssets || new Set(assets.map(asset => asset.id)).size !== assets.length) {
    throw new Error('再OCRに使うアイコン候補と登録先を選び直してください。')
  }
  const chosen = context.occurrences.filter(item => occurrenceIds.includes(item.id))
  if (chosen.length !== occurrenceIds.length)
    throw new Error('選択したアイコン候補が見つかりません。')
  const occurrences = parseAssetDiscovery({ occurrences: chosen, groups: [] }, { cards: [card], assetIds: new Set(assets.map(asset => asset.id)) }).occurrences
  const icons = proposedSourceIcons(region, occurrences, card.id, context.imageDigest, context.assetDigests)
  const working = { ...region, sourceIcons: icons }
  const problems = sourceIconProblems(working, assets)
  if (problems.length || new Set(icons.map(icon => icon.id)).size !== icons.length)
    throw new Error(problems.join('\n') || '原文アイコンのIDが重複しています。')
  const usedIds = new Set(icons.map(icon => icon.assetId))
  const usedAssets = assets.filter(asset => usedIds.has(asset.id))
  for (const asset of usedAssets) {
    const problem = validateAssetName(asset.name, assets, asset.id)
    if (problem || asset.name !== asset.name.trim() || !hash(context.assetDigests.get(asset.id)))
      throw new Error(problem ?? '原文アイコンのアセット名・画像の同一性を確認してください。')
  }
  const signature = JSON.stringify([card.id, card.imageWidth, card.imageHeight, context.imageDigest, region, occurrences, usedAssets.map(asset => [asset, context.assetDigests.get(asset.id)])])
  return { working, usedAssets, signature }
}

/** 選択した承認済み出現だけを作業コピーへ足す。重なる手動指定を勝手に置換しない。 */
export function prepareSourceIconOCR(context: SourceIconOCRContext, regionId: string, occurrenceIds: readonly string[], scope: SourceIconOCRScope): SourceIconOCRDraft {
  const inspected = inspect(context, regionId, occurrenceIds, scope)
  const draft = freezeTree({ cardId: context.card.id, regionId, occurrenceIds: [...occurrenceIds], region: JSON.parse(JSON.stringify(inspected.working)) as TextRegion })
  drafts.set(draft, { signature: inspected.signature, session: scope.session, revision: scope.revision, assets: JSON.parse(JSON.stringify(inspected.usedAssets)) as ImageAsset[] })
  return draft
}

function checkDraft(context: SourceIconOCRContext, draft: SourceIconOCRDraft, scope: SourceIconOCRScope): DraftSnapshot {
  const stored = drafts.get(draft)
  if (!stored || stored.session !== scope.session || stored.revision !== scope.revision
    || stored.signature !== inspect(context, draft.regionId, draft.occurrenceIds, scope).signature) {
    throw new Error('再OCRの確認中に対象・承認・画像が変わりました。現在の内容でやり直してください。')
  }
  return stored
}

/** 位置だけの明示適用用。原文・訳文や登録PNGはこのパッチに含めない。 */
export function sourceIconPositionPatch(context: SourceIconOCRContext, draft: SourceIconOCRDraft, scope: SourceIconOCRScope): { sourceIcons: SourceIcon[] } {
  checkDraft(context, draft, scope)
  return { sourceIcons: structuredClone(draft.region.sourceIcons ?? []) }
}

export function checkedSourceIconText(result: OCRResult, region: Readonly<TextRegion>, assets: ImageAsset[]): string {
  if (!result.words?.length || !result.words.some(word => word.text.trim())
    || result.words.some(word => ![word.x, word.y, word.width, word.height].every(Number.isFinite) || word.width <= 0 || word.height <= 0)) {
    throw new Error('単語の位置を認識できませんでした。OCR結果とアイコンの位置を手動で確認してください。')
  }
  if (result.words.length > SOURCE_ICON_OCR_LIMITS.words || result.words.reduce((sum, word) => sum + word.text.length, 0) > FILE_LIMITS.projectStringLength)
    throw new Error('OCR結果が処理上限を超えています。対象領域を小さくしてやり直してください。')
  if (result.confidence !== null && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100))
    throw new Error('OCR結果の信頼度が不正です。やり直してください。')
  const text = textWithSourceIcons(result, region.sourceIcons ?? [], assets, 3, 12)
  const tokens = [...text.matchAll(/\[icon:[^[\]\r\n]+\]/gu)].map(match => match[0]).sort()
  const expected = (region.sourceIcons ?? []).map(icon => `[icon:${assets.find(asset => asset.id === icon.assetId)!.name}]`).sort()
  if (text.length > FILE_LIMITS.projectStringLength || /\[\s*icon\b/iu.test(text.replace(/\[icon:[^[\]\r\n]+\]/gu, '')) || JSON.stringify(tokens) !== JSON.stringify(expected))
    throw new Error('OCR結果のアイコン記法・個数を確認してください。原文へはまだ反映していません。')
  return text
}

interface RecognizeSourceIconsOptions {
  /** 呼出元が元画像ハッシュを照合した画像を借りる。ここでは解放しない。 */
  image: CanvasImageSource
  provider: OCRProvider
  /** 取消・カード切替・画面破棄時はnull。画像・PNGの照合値も最新にする。 */
  current: () => { context: SourceIconOCRContext, scope: SourceIconOCRScope } | null
  onProgress?: (progress: OCRProgress) => void
}

/** 作業コピーだけをマスクしてOCRする。失敗・取消で確定領域や消去範囲は変わらない。 */
export async function recognizeSourceIconOCR(draft: SourceIconOCRDraft, { image, provider, current, onProgress }: RecognizeSourceIconsOptions): Promise<SourceIconOCRPreview | null> {
  if (!drafts.has(draft))
    throw new Error('このセッションで準備した再OCRの作業コピーを使用してください。')
  let invalidated = false
  let finished = false
  const isCurrent = () => {
    if (invalidated)
      return false
    try {
      const value = current()
      if (!value)
        throw new Error('cancelled')
      checkDraft(value.context, draft, value.scope)
    }
    catch {
      invalidated = true
    }
    return !invalidated
  }
  try {
    if (!isCurrent())
      return null
    assertImageDimensions(Math.max(1, Math.round(draft.region.width)) * 3 + 24, Math.max(1, Math.round(draft.region.height)) * 3 + 24, '再OCR画像')
    const blob = await prepareRegionForOCR(image, draft.region, { scale: 3, padding: 12, exclusions: [...draft.region.exclusionAreas, ...(draft.region.sourceIcons ?? [])] })
    if (!isCurrent())
      return null
    const result = await provider.recognize(blob, { language: 'eng', layout: regionTextLayout(draft.region), onProgress: (progress) => {
      if (!finished && isCurrent())
        onProgress?.(progress)
    } })
    if (!isCurrent())
      return null
    const originalText = checkedSourceIconText(result, draft.region, drafts.get(draft)!.assets)
    const preview = Object.freeze({ draft, originalText, confidence: result.confidence })
    previews.add(preview)
    return preview
  }
  catch (error) {
    if (!isCurrent())
      return null
    throw error
  }
  finally {
    finished = true
  }
}

/** 原文と消去範囲を一つの通常編集で反映するためのパッチ。適用直前にも承認を検証する。 */
export function sourceIconOCRPatch(context: SourceIconOCRContext, preview: SourceIconOCRPreview, scope: SourceIconOCRScope): Pick<TextRegion, 'sourceIcons' | 'originalText'> {
  if (!previews.has(preview))
    throw new Error('このセッションで確認した再OCRの結果を使用してください。')
  return { ...sourceIconPositionPatch(context, preview.draft, scope), originalText: preview.originalText }
}
