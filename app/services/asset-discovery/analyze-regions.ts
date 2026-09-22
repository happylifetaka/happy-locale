import type { RegionApplyIssue, SourceProtection } from './apply-issues'
import type { OCRProvider } from '~/services/ocr/types'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset, RegionDraft, TextRegion } from '~/types/editor'
import { detectRegions } from '~/services/ocr/detect-regions'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { assertImageDimensions } from '~/utils/file-limits'
import { regionTextLayout } from '~/utils/region-text-layout'
import { sourceProtectionReason } from './apply-issues'
import { intersectionArea } from './geometry'
import { regionFromCandidate } from './new-region'
import { mapDiscoveryToRegions } from './region-transfer'
import { sameBounds } from './review'
import { checkedSourceIconText, prepareSourceIconOCR, recognizeSourceIconOCR, sourceIconOCRPatch } from './source-ocr'

export interface IconRegionRow {
  region: TextRegion
  before: TextRegion | null
  candidateId?: string
  boundsBefore?: RegionDraft
  iconCount: number
  error?: string
  /** 自動反映は原文を保護し、明示プレビューへ案内する。 */
  needsTextReview?: boolean
  sourceProtection?: SourceProtection
  blockedByIconMapping?: boolean
}

interface AnalyzeIconRegionsOptions {
  card: FolderProjectCard
  discovery: AssetDiscoveryState
  assets: ImageAsset[]
  image: CanvasImageSource
  imageDigest: string
  assetDigests: ReadonlyMap<string, string>
  provider: OCRProvider
  isCurrent: () => boolean
  status: (text: string) => void
  preserveEditedText?: boolean
}

/** 小さなはみ出しだけを最小拡張し、領域が無い場合だけ検出する。結果は確認待ちのコピー。 */
export async function analyzeIconRegions(options: AnalyzeIconRegionsOptions) {
  const { card, discovery, assets, image, imageDigest, assetDigests, provider, isCurrent, status } = options
  const warnings: string[] = []
  const issues: RegionApplyIssue[] = []
  const current = () => {
    if (!isCurrent())
      throw new Error('解析対象が変更されたか中止されました。')
  }
  let candidates = card.ocrCandidates ?? []
  if (!card.regions.length && !candidates.length) {
    status('領域を新規検出しています…')
    const detection = await detectRegions({ image, imageWidth: card.imageWidth, imageHeight: card.imageHeight, provider, isCurrent, onProgress: progress => status(progress.status) })
    current()
    if (!detection)
      throw new Error('領域を検出できませんでした。')
    candidates = detection.candidates
  }
  const additions = candidates.filter(candidate => candidate.selected).filter((candidate) => {
    const overlapping = card.regions.find(region => intersectionArea(region, candidate) > 0)
    if (overlapping) {
      warnings.push('既存領域と重なる領域候補は追加しません。既存の枠を優先します。')
      issues.push({ message: warnings.at(-1)!, regionId: overlapping.id })
      return false
    }
    return true
  }).map((candidate, index) => ({ region: regionFromCandidate(candidate, card.regions.length + index), candidateId: candidate.id }))
  const regions = [...card.regions, ...additions.map(item => item.region)]
  if (regions.length > 200)
    throw new Error('一度に解析できる領域は200件までです。対象を整理してください。')
  if (!regions.length && candidates.length)
    return { rows: [], warnings, candidates, issues }
  if (!regions.length)
    throw new Error('解析対象の領域がありません。領域候補の選択や手動追加を確認してください。')
  const mapping = mapDiscoveryToRegions(discovery, card.id, regions, imageDigest, { width: card.imageWidth, height: card.imageHeight }, assets, assetDigests)
  warnings.push(...mapping.warnings)
  issues.push(...mapping.issues)
  const rows: IconRegionRow[] = []
  const cleaned = mapping.regions
  for (const [index, region] of cleaned.entries()) {
    current()
    const before = card.regions.find(item => item.id === region.id) ?? null
    const added = additions.find(item => item.region.id === region.id)
    const occurrences = mapping.mapped.get(region.id) ?? []
    if (before && !occurrences.length && !before.sourceIcons?.some(icon => icon.id.startsWith('discovery-')) && !mapping.blocked.has(region.id))
      continue
    const row: IconRegionRow = { region: structuredClone(region), before: before ? structuredClone(before) : null, candidateId: added?.candidateId, iconCount: occurrences.length }
    const previous = regions[index]!
    if (!sameBounds(previous, region))
      row.boundsBefore = { x: previous.x, y: previous.y, width: previous.width, height: previous.height }
    rows.push(row)
    if (mapping.blocked.has(region.id)) {
      row.blockedByIconMapping = true
      row.error = '対応を確定できないアイコンがあります。候補または領域の枠を調整して再解析してください。'
      continue
    }
    const protection = before && sourceProtectionReason(before)
    if (options.preserveEditedText && before && protection) {
      row.region = structuredClone(before)
      delete row.boundsBefore
      row.needsTextReview = true
      row.sourceProtection = protection
      row.error = protection === 'edited' ? '編集済みの原文を保護しました' : 'OCR履歴がないため、原文を保護しました'
      continue
    }
    try {
      status(`${index + 1}/${regions.length} 領域内のアイコンと原文を確認しています…`)
      if (occurrences.length) {
        const context = { card: { ...card, regions: cleaned }, occurrences, assets, imageDigest, assetDigests }
        const scope = { session: Symbol('icon-region'), revision: 0 }
        const draft = prepareSourceIconOCR(context, region.id, occurrences.map(item => item.id), scope)
        const preview = await recognizeSourceIconOCR(draft, { image, provider, current: () => isCurrent() ? { context, scope } : null })
        current()
        if (!preview)
          throw new Error('原文OCRを中止しました。')
        row.region = { ...row.region, ...sourceIconOCRPatch(context, preview, scope) }
      }
      else if (before) {
        // 除外・削除済みの自動アイコンタグを残さない。手動アイコンは引き続き使う。
        assertImageDimensions(Math.round(region.width) * 3 + 24, Math.round(region.height) * 3 + 24)
        const blob = await prepareRegionForOCR(image, region, { scale: 3, padding: 12, exclusions: [...region.exclusionAreas, ...region.sourceIcons ?? []] })
        current()
        const result = await provider.recognize(blob, { language: 'eng', layout: regionTextLayout(region) })
        current()
        row.region.originalText = checkedSourceIconText(result, region, assets)
        row.region.lastOcrText = row.region.originalText
      }
    }
    catch (error) {
      current()
      row.error = error instanceof Error ? error.message : String(error)
    }
  }
  return { rows, warnings, candidates, issues }
}
