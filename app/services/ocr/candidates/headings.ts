import type { RegionCandidateOptions } from './options'
import type { OCRTextBlock } from '~/types/ocr'
import { groupBounds } from './geometry'

/** 画素で文字列の範囲が裏付けられた場合だけ、外にある低信頼度の飾りを除く。 */
export function refineLabel(block: OCRTextBlock, options: RegionCandidateOptions): OCRTextBlock {
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
export function trimHeadingDecorations(block: OCRTextBlock, words: readonly OCRTextBlock[], refine?: RegionCandidateOptions['refineHeadingBounds']): OCRTextBlock {
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
