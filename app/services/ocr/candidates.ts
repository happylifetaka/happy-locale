import type { OCRTextBlock, RegionCandidate } from './types'

export interface RegionCandidateOptions {
  scale?: number
  imageWidth: number
  imageHeight: number
  padding?: number
  minimumConfidence?: number
  minimumLatinLetters?: number
  maximumNonAlphanumericRatio?: number
  minimumHeightRatio?: number
  words?: readonly OCRTextBlock[]
  refineHeadingBounds?: (bounds: OCRTextBlock) => OCRTextBlock
  refineTextBounds?: (bounds: OCRTextBlock) => OCRTextBlock
  labelBounds?: readonly OCRTextBlock[]
}

/** 画素で文字列の範囲が裏付けられた場合だけ、外にある低信頼度の飾りを除く。 */
function refineLabel(block: OCRTextBlock, options: RegionCandidateOptions): OCRTextBlock {
  if (!options.refineHeadingBounds || !/[A-Z]{3}/u.test(block.text))
    return block
  const words = (options.words ?? []).filter(word =>
    word.x + word.width / 2 >= block.x && word.x + word.width / 2 <= block.x + block.width
    && word.y + word.height / 2 >= block.y && word.y + word.height / 2 <= block.y + block.height,
  ).sort((a, b) => a.x - b.x)
  const matching = words.map(word => word.text.trim()).join(' ') === block.text.trim().replace(/\s+/gu, ' ')
  // 高信頼度の純粋な語だけなら横幅は語座標を保持。文字の端を画素閾値で欠かさない。
  if (matching && words.length && words.every(w => /^[A-Z]{2,}$/u.test(w.text) && (w.confidence ?? 0) >= 80))
    return block
  const uppercase = !/[a-z]/u.test(block.text)
  if (!uppercase && !(matching && words.some(w => /^[A-Z]{3,}$/u.test(w.text))
    && words.every(w => /^[A-Z]{2,}$/u.test(w.text) || (w.confidence !== null && w.confidence <= 20)))) {
    return block
  }
  // 帯全体では背景が多すぎる場合、信頼できる中央語を実画素で再測定する。
  if (matching) {
    const core = words.filter(w => /^[A-Z]{2,}$/u.test(w.text) && (w.confidence ?? 0) >= 60)
    const decorations = words.filter(w => !core.includes(w))
    if (core.length && decorations.length && decorations.every(w => w.confidence !== null && w.confidence <= 20)) {
      const proposed = { ...groupBounds(core), text: core.map(w => w.text).join(' ') }
      if (decorations.every(w => w.x + w.width <= proposed.x || w.x >= proposed.x + proposed.width)) {
        const refined = options.refineHeadingBounds(proposed)
        if (refined.height <= proposed.height * 0.85 && refined.width >= proposed.width * 0.8)
          return refined
      }
    }
  }
  const measured = options.refineHeadingBounds(block)
  if (measured === block || (measured.x === block.x && measured.y === block.y
    && measured.width === block.width && measured.height === block.height)) {
    return block
  }
  if (matching && measured.width < block.width * 0.85) {
    const inside = words.filter(w => w.x + w.width / 2 >= measured.x && w.x + w.width / 2 <= measured.x + measured.width)
    const outside = words.filter(w => !inside.includes(w))
    if (inside.length && inside.every(w => /^[A-Z]{2,}$/u.test(w.text))
      && outside.length && outside.every(w => w.confidence !== null && w.confidence <= 65)) {
      return { ...measured, text: inside.map(w => w.text).join(' '), confidence: groupBounds(inside).confidence }
    }
    if (outside.length)
      return block
  }
  // 小文字を含む行では、正規の語を除去できた裏付けがない限り変更しない。
  return uppercase ? measured : block
}

/** 大文字見出しの両端にある、大きく低信頼度な装飾誤認だけを単語座標から除く。 */
function trimHeadingDecorations(block: OCRTextBlock, words: readonly OCRTextBlock[], refine?: RegionCandidateOptions['refineHeadingBounds']): OCRTextBlock {
  // Tesseractの単語枠は親の行枠からはみ出すことがある。中心と面積の重なりで照合する。
  const parts = words.filter((word) => {
    // 行の下辺に紛れた薄い罫線は照合に混ぜない。行テキストとの一致条件は維持する。
    if (word.confidence !== null && word.confidence <= 20 && !/[a-z0-9]/iu.test(word.text)
      && word.height <= block.height * 0.15 && word.y >= block.y + block.height * 0.75) {
      return false
    }
    const overlapWidth = Math.max(0, Math.min(word.x + word.width, block.x + block.width) - Math.max(word.x, block.x))
    const overlapHeight = Math.max(0, Math.min(word.y + word.height, block.y + block.height) - Math.max(word.y, block.y))
    return word.x + word.width / 2 >= block.x && word.x + word.width / 2 <= block.x + block.width
      && word.y + word.height / 2 >= block.y && word.y + word.height / 2 <= block.y + block.height
      && overlapWidth * overlapHeight >= word.width * word.height * 0.65
  })
    .sort((a, b) => a.x - b.x)
  if (parts.length < 2 || parts.length > 7
    || parts.map(part => part.text.trim()).join(' ') !== block.text.trim().replace(/\s+/gu, ' ')) {
    return block
  }
  const first = parts[0]!
  const last = parts.at(-1)!
  const leadingWords = parts.slice(0, -1)
  // 一方の飾りが低信頼度の先頭語に融合し、反対側が数字化した場合は画素による裏付けも要求する。
  if (refine && leadingWords.length >= 3 && leadingWords.length <= 5
    && leadingWords.every(word => /^[A-Z]{2,}$/u.test(word.text))
    && first.confidence !== null && first.confidence <= 40
    && leadingWords.filter(word => word.confidence !== null && word.confidence >= 80).length >= 2
    && /^[^a-z\s]+$/iu.test(last.text) && last.confidence !== null && last.confidence <= 75) {
    const content = groupBounds(leadingWords)
    const glyphWidth = leadingWords.reduce((sum, word) => sum + word.width, 0) / leadingWords.reduce((sum, word) => sum + word.text.length, 0)
    const gap = last.x - (content.x + content.width)
    if (content.confidence !== null && content.confidence >= 60
      && last.width >= glyphWidth * 1.3 && last.width / last.height >= 0.6 && last.width / last.height <= 1.5
      && last.height >= content.height * 0.6 && gap >= 0 && gap <= content.height * 0.7) {
      const proposed = { ...content, text: leadingWords.map(word => word.text).join(' ') }
      const measured = refine(proposed)
      if (measured.x - proposed.x >= glyphWidth * 0.7 && measured.height <= proposed.height * 0.85)
        return proposed
    }
  }
  if (parts.length === 2) {
    const word = /^[A-Z]{3,}$/u.test(first.text) ? first : last
    const decoration = word === first ? last : first
    const gap = last.x - (first.x + first.width)
    if (/^[A-Z]{3,}$/u.test(word.text) && word.confidence !== null && word.confidence >= 80
      && /^[^a-z0-9\s]+$/iu.test(decoration.text) && decoration.confidence !== null && decoration.confidence <= 40
      && decoration.width >= word.width / word.text.length * 1.5
      && decoration.width / decoration.height >= 0.6 && decoration.width / decoration.height <= 1.5
      && decoration.height >= word.height * 0.8
      && gap >= -decoration.width * 0.25 && gap <= word.height * 0.7) {
      return { ...word }
    }
    return block
  }
  // 片側の装飾だけが独立し、反対側は末尾の句点として単語に混ざる場合。
  const phrase = parts.slice(1)
  if (phrase.length >= 2 && phrase.length <= 5
    && /^[^a-z0-9\s]+$/iu.test(first.text) && first.confidence !== null && first.confidence <= 20
    && phrase.every((word, index) => (index === phrase.length - 1 ? /^[A-Z]{2,}\.?$/u : /^[A-Z]{2,}$/u).test(word.text))
    && phrase.filter(word => word.confidence !== null && word.confidence >= 80).length >= 2
    && phrase.every(word => word.confidence !== null && word.confidence >= 30)) {
    const bounds = groupBounds(phrase)
    const gap = phrase[0]!.x - (first.x + first.width)
    if (bounds.confidence !== null && bounds.confidence >= 70
      && first.width / first.height >= 0.6 && first.width / first.height <= 1.5
      && gap >= -first.width * 0.25 && gap <= bounds.height * 0.5) {
      return { ...bounds, text: phrase.map(word => word.text.replace(/\.$/u, '')).join(' ') }
    }
  }
  const core = parts.slice(1, -1)
  if (!core.every(word => /^[A-Z]{2,}$/u.test(word.text) && word.confidence !== null && word.confidence >= 80)
    || !/^[^a-z0-9\s]+$/iu.test(first.text)
    || !/^[^a-z\s]+$/iu.test(last.text)) {
    return block
  }
  const bounds = groupBounds(core)
  const glyphWidth = core.reduce((sum, word) => sum + word.width, 0) / core.reduce((sum, word) => sum + word.text.length, 0)
  const decorative = (word: OCRTextBlock) => word.confidence !== null && word.confidence <= 65
    && word.width >= glyphWidth * 1.5 && word.width / word.height >= 0.6 && word.width / word.height <= 1.5
    && word.height >= bounds.height * 0.8
  if (!decorative(first) || !decorative(last)
    || Math.min(first.width, last.width) / Math.max(first.width, last.width) < 0.65) {
    return block
  }
  return { ...bounds, text: core.map(word => word.text).join(' ') }
}

interface CandidateGroup {
  lines: OCRTextBlock[]
}

/** 大文字主体のラベルと通常の文章の境界。固有の見出し語には依存しない。 */
function isUppercaseLabel(text: string): boolean {
  const letters = text.match(/[a-z]/giu) ?? []
  return letters.length >= 3
    && letters.filter(letter => letter === letter.toUpperCase()).length / letters.length >= 0.8
}

/** 同じ行の断片だけを横結合する。離れた段組みはまとめない。 */
function canJoinOnSameRow(a: OCRTextBlock, b: OCRTextBlock): boolean {
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  const proseFragments = !isUppercaseLabel(a.text) && !isUppercaseLabel(b.text)
    && (a.text.match(/[a-z]+/giu)?.length ?? 0) >= 1
    && (b.text.match(/[a-z]+/giu)?.length ?? 0) >= 1
    && Math.max(a.text.match(/[a-z]+/giu)?.length ?? 0, b.text.match(/[a-z]+/giu)?.length ?? 0) >= 3
    && Math.max(a.confidence ?? 0, b.confidence ?? 0) >= 70
    && Math.min(a.confidence ?? 0, b.confidence ?? 0) >= 25
  const rightFragment = a.x > b.x ? a : b
  const iconFragment = proseFragments && /^[^a-z]+/iu.test(rightFragment.text)
  if (isInitiallySelected(a) !== isInitiallySelected(b) && !(proseFragments && (gap <= 0 || iconFragment)))
    return false
  const height = Math.min(a.height, b.height)
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return height / Math.max(a.height, b.height) >= 0.4
    && overlap >= height * 0.7
    && gap >= -(iconFragment ? Math.min(height * 1.5, Math.min(a.width, b.width) * 0.4) : height * (proseFragments ? 0.5 : 0.2))
    && gap <= height * 1.5
}

/** 行内の断片を先に復元し、その行が別候補の外接矩形に取り残されるのを防ぐ。 */
function joinRowFragments(blocks: OCRTextBlock[]): OCRTextBlock[] {
  const rows: OCRTextBlock[] = []
  for (const block of blocks) {
    const index = rows.findLastIndex(row => canJoinOnSameRow(row, block))
    if (index < 0) {
      rows.push(block)
      continue
    }
    const parts = [rows[index]!, block].sort((a, b) => a.x - b.x)
    rows[index] = { ...groupBounds(parts), text: parts.map(part => part.text).join(' ') }
  }
  return rows.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 認識文字と寸法・信頼度から編集候補として使える行か判定する。 */
function isCandidateBlock(
  block: OCRTextBlock,
  options: Required<
    Pick<
      RegionCandidateOptions,
      | 'imageHeight'
      | 'maximumNonAlphanumericRatio'
      | 'minimumConfidence'
      | 'minimumHeightRatio'
      | 'minimumLatinLetters'
    >
  >,
): boolean {
  const text = block.text.trim()
  if (!text || block.width < 2 || block.height < 2)
    return false
  if (
    block.confidence !== null
    && (block.confidence <= 0 || block.confidence < options.minimumConfidence)
  ) {
    return false
  }
  const latinLetters = text.match(/[a-z]/giu)?.length ?? 0
  if (latinLetters < options.minimumLatinLetters)
    return false
  const visibleCharacters = text.replace(/\s/gu, '')
  const alphanumericCharacters
    = visibleCharacters.match(/[a-z0-9]/giu)?.length ?? 0
  const nonAlphanumericRatio
    = visibleCharacters.length === 0
      ? 1
      : 1 - alphanumericCharacters / visibleCharacters.length
  if (nonAlphanumericRatio > options.maximumNonAlphanumericRatio)
    return false
  return block.height / options.imageHeight >= options.minimumHeightRatio
}

/** 二つの認識範囲の横方向の重なりを求める。 */
function horizontalOverlap(a: OCRTextBlock, b: OCRTextBlock): number {
  const overlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  )
  return overlap / Math.max(1, Math.min(a.width, b.width))
}

/** 位置と行間から隣接するOCR行を同じ領域へまとめられるか判定する。 */
function canJoin(previous: OCRTextBlock, next: OCRTextBlock): boolean {
  if (isInitiallySelected(previous) !== isInitiallySelected(next))
    return false
  const verticalGap = next.y - (previous.y + previous.height)
  // 大きな装飾・アイコンを巻き込んだ一行が、段落間の許容間隔を広げない。
  const lineHeight = Math.min(previous.height, next.height)
  const largerHeight = Math.max(previous.height, next.height)
  const previousLabel = isUppercaseLabel(previous.text)
  // 左揃え本文はアイコンや小文字だけの行で行高が変わる。従来の上限内で余裕を残す。
  const alignedBody = !previousLabel && Math.abs(previous.x - next.x) <= lineHeight * 0.5
    && lineHeight / largerHeight >= 0.4
    && (previous.confidence === null || previous.confidence >= 70)
    && (next.confidence === null || next.confidence >= 70)
  const maximumGap = alignedBody
    ? Math.min(lineHeight * 1.5, largerHeight * 1.1)
    : lineHeight * 0.8
  return (
    verticalGap >= -lineHeight * 0.35
    && verticalGap <= maximumGap
    && horizontalOverlap(previous, next) >= 0.2
    && previousLabel === isUppercaseLabel(next.text)
    && (!previousLabel || lineHeight / largerHeight >= 0.72)
  )
}

/** 信頼度不明は従来どおり選択。低信頼度は検出結果を残し、追加のみ任意にする。 */
function isInitiallySelected(block: OCRTextBlock): boolean {
  return block.confidence === null || block.confidence > 40
}

/** 複数のOCR行を覆う範囲と本文をまとめる。 */
function groupBounds(lines: OCRTextBlock[]): OCRTextBlock {
  const x = Math.min(...lines.map(line => line.x))
  const y = Math.min(...lines.map(line => line.y))
  const right = Math.max(...lines.map(line => line.x + line.width))
  const bottom = Math.max(...lines.map(line => line.y + line.height))
  const confidences = lines
    .map(line => line.confidence)
    .filter((value): value is number => value !== null)
  return {
    text: lines.map(line => line.text).join('\n'),
    x,
    y,
    width: right - x,
    height: bottom - y,
    confidence: confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null,
  }
}

/** 分割した行群から境界内に収まる領域候補を作る。 */
function candidateFromLines(
  lines: OCRTextBlock[],
  id: string,
  selected: boolean,
  boundsLimit: Pick<RegionCandidate, 'x' | 'y' | 'width' | 'height'>,
  padding: number,
): RegionCandidate {
  const bounds = groupBounds(lines)
  const x = Math.max(boundsLimit.x, Math.floor(bounds.x - padding))
  const y = Math.max(boundsLimit.y, Math.floor(bounds.y - padding))
  const right = Math.min(
    boundsLimit.x + boundsLimit.width,
    Math.ceil(bounds.x + bounds.width + padding),
  )
  const bottom = Math.min(
    boundsLimit.y + boundsLimit.height,
    Math.ceil(bounds.y + bounds.height + padding),
  )
  return {
    ...bounds,
    id,
    selected,
    lines,
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

/** 認識済みの行を使って候補を分割し、再OCRせずに原文と範囲を作り直す。 */
export function splitRegionCandidate(
  candidate: RegionCandidate,
  padding = 6,
): [RegionCandidate, RegionCandidate] | null {
  if (candidate.lines.length < 2)
    return null
  const splitIndex = Math.ceil(candidate.lines.length / 2)
  const upperLines = candidate.lines.slice(0, splitIndex)
  const lowerLines = candidate.lines.slice(splitIndex)
  return [
    candidateFromLines(
      upperLines,
      `${candidate.id}_a`,
      candidate.selected,
      candidate,
      padding,
    ),
    candidateFromLines(
      lowerLines,
      `${candidate.id}_b`,
      candidate.selected,
      candidate,
      padding,
    ),
  ]
}

/** OCRの行を位置関係でまとめ、画像端を越えない余白付きの編集候補へ変換する。 */
export function createRegionCandidates(
  blocks: readonly OCRTextBlock[],
  options: RegionCandidateOptions,
): RegionCandidate[] {
  const scale = Math.max(1, options.scale ?? 1)
  const padding = Math.max(0, options.padding ?? 8)
  const filters = {
    imageHeight: options.imageHeight,
    minimumConfidence: options.minimumConfidence ?? 0,
    minimumLatinLetters: options.minimumLatinLetters ?? 3,
    maximumNonAlphanumericRatio: options.maximumNonAlphanumericRatio ?? 0.5,
    minimumHeightRatio: options.minimumHeightRatio ?? 0.01,
  }
  const trimmedLines = new WeakSet<OCRTextBlock>()
  const normalized = blocks
    .map((original) => {
      const confirmedLabel = options.labelBounds?.includes(original) ?? false
      const trimmed = options.words ? trimHeadingDecorations(original, options.words, options.refineHeadingBounds) : original
      let block = trimmed !== original && options.refineHeadingBounds ? options.refineHeadingBounds(trimmed) : trimmed
      // 装飾の誤読パターンに一致しなくても、大文字ラベルは画像で裏付けて補正する。
      // 認識文字自体は変更しない。暗い背景の種別や曖昧な画像では元の枠を維持する。
      if (block === original)
        block = refineLabel(original, options)
      if (confirmedLabel)
        block = original
      if (!confirmedLabel && block === original && options.refineTextBounds)
        block = options.refineTextBounds(original)
      const normalized = {
        ...block,
        x: block.x / scale,
        y: block.y / scale,
        width: block.width / scale,
        height: block.height / scale,
      }
      if (block !== original || confirmedLabel)
        trimmedLines.add(normalized)
      return normalized
    })
    .filter(block => isCandidateBlock(block, filters))
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const groups: CandidateGroup[] = []
  for (const block of joinRowFragments(normalized)) {
    const group = groups.findLast((candidate) => {
      const previous = candidate.lines.at(-1)!
      if (!canJoin(previous, block))
        return false
      // 他の見出し等を飛び越えて過去の本文グループに接続しない。
      return !groups.some(other => other !== candidate && other.lines.some(line =>
        line.y > previous.y && line.y < block.y
        && horizontalOverlap(line, previous) >= 0.2
        && horizontalOverlap(line, block) >= 0.2,
      ))
    })
    if (group)
      group.lines.push(block)
    else groups.push({ lines: [block] })
  }

  const candidates = groups.map((group, index) => {
    const bounds = groupBounds(group.lines)
    const groupPadding = group.lines.every(line => trimmedLines.has(line)) ? Math.min(padding, 2) : padding
    const x = Math.max(0, Math.floor(bounds.x - groupPadding))
    const y = Math.max(0, Math.floor(bounds.y - groupPadding))
    const right = Math.min(
      options.imageWidth,
      Math.ceil(bounds.x + bounds.width + groupPadding),
    )
    const bottom = Math.min(
      options.imageHeight,
      Math.ceil(bounds.y + bounds.height + groupPadding),
    )
    return {
      ...bounds,
      id: `candidate_${index + 1}`,
      selected: isInitiallySelected(bounds),
      lines: group.lines,
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  })
  separateCandidatePadding(candidates)
  return candidates
}

/** 認識内容は離れているのに余白だけが重なる候補を、内容間の空きで分ける。 */
function separateCandidatePadding(candidates: RegionCandidate[]): void {
  const ordered = candidates.map(candidate => ({ candidate, content: groupBounds(candidate.lines) }))
    .sort((a, b) => a.content.y - b.content.y)
  for (let i = 0; i < ordered.length; i++) {
    const upper = ordered[i]!
    for (let j = i + 1; j < ordered.length; j++) {
      const lower = ordered[j]!
      if (lower.candidate.y >= upper.candidate.y + upper.candidate.height
        || horizontalOverlap(upper.candidate, lower.candidate) <= 0) {
        continue
      }
      const contentBottom = upper.content.y + upper.content.height
      const available = lower.content.y - contentBottom
      // OCR枠自体が重なる場合は、文字やアイコンを切る恐れがあるので動かさない。
      if (available < 0)
        continue
      const middle = contentBottom + available / 2
      const halfGap = Math.min(1, available) / 2
      const bottom = Math.min(upper.candidate.y + upper.candidate.height, middle - halfGap)
      const top = Math.max(lower.candidate.y, middle + halfGap)
      const lowerBottom = lower.candidate.y + lower.candidate.height
      upper.candidate.height = bottom - upper.candidate.y
      lower.candidate.y = top
      lower.candidate.height = lowerBottom - top
    }
  }
}

/** 候補の履歴を独立して保存できるよう深く複製する。 */
export function cloneRegionCandidates(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    lines: candidate.lines.map(line => ({ ...line })),
  }))
}
