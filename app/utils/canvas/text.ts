export type TextMeasureContext = Pick<
  CanvasRenderingContext2D,
  'measureText'
> & {
  font: string
}

export interface TextLayout {
  fontSize: number
  lineHeight: number
  lines: string[]
}

export interface TextExclusion {
  x: number
  y: number
  width: number
  height: number
}

export interface TextRun {
  text: string
  x: number
  y: number
  width: number
}

export interface FlowTextLayout {
  fontSize: number
  lineHeight: number
  runs: TextRun[]
  fits: boolean
}

/** 行幅を超える単語を文字単位で分割する。一文字だけで幅を超える場合も、その文字は残す。 */
function splitLongToken(
  context: TextMeasureContext,
  token: string,
  maxWidth: number,
) {
  const parts: string[] = []
  let part = ''
  for (const character of token) {
    if (part && context.measureText(part + character).width > maxWidth) {
      parts.push(part)
      part = character
    }
    else {
      part += character
    }
  }
  if (part)
    parts.push(part)
  return parts
}

/** 単語の区切りを優先して改行し、一語でも幅を超える場合は文字単位で分割する。 */
export function wrapText(
  context: TextMeasureContext,
  text: string,
  maxWidth: number,
): string[] {
  if (!text)
    return []
  const lines: string[] = []

  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    const tokens = paragraph.match(/\S+\s*/gu) ?? []
    let line = ''
    for (const rawToken of tokens) {
      const token = rawToken.trimEnd()
      const candidate = line ? `${line} ${token}` : token
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      if (line)
        lines.push(line)
      const parts = splitLongToken(context, token, maxWidth)
      line = parts.pop() ?? ''
      lines.push(...parts)
    }
    if (line)
      lines.push(line)
  }
  return lines
}

/** 指定範囲に収まる文字サイズと折り返し行を探し、収まらない場合は最小サイズの結果を返す。 */
export function fitText(
  context: TextMeasureContext,
  text: string,
  width: number,
  height: number,
  requestedFontSize: number,
  minimumFontSize = 8,
  fontFamily = 'sans-serif',
): TextLayout {
  const maxSize = Math.max(minimumFontSize, requestedFontSize)
  for (let fontSize = maxSize; fontSize >= minimumFontSize; fontSize -= 1) {
    context.font = `${fontSize}px ${fontFamily}`
    const lines = wrapText(context, text, width)
    const lineHeight = Math.ceil(fontSize * 1.25)
    if (lines.length * lineHeight <= height)
      return { fontSize, lineHeight, lines }
  }
  context.font = `${minimumFontSize}px ${fontFamily}`
  return {
    fontSize: minimumFontSize,
    lineHeight: Math.ceil(minimumFontSize * 1.25),
    lines: wrapText(context, text, width),
  }
}

/** 行と重なる保護領域を除いた、文字を配置できる横方向の区間を求める。 */
function availableSegments(
  width: number,
  lineTop: number,
  lineHeight: number,
  exclusions: readonly TextExclusion[],
) {
  let segments = [{ x: 0, width }]
  for (const exclusion of exclusions) {
    const overlapsLine
      = exclusion.y < lineTop + lineHeight
        && exclusion.y + exclusion.height > lineTop
    if (!overlapsLine)
      continue
    const exclusionLeft = Math.max(0, exclusion.x)
    const exclusionRight = Math.min(width, exclusion.x + exclusion.width)
    segments = segments.flatMap((segment) => {
      const segmentRight = segment.x + segment.width
      if (exclusionRight <= segment.x || exclusionLeft >= segmentRight) {
        return [segment]
      }
      const result: { x: number, width: number }[] = []
      if (exclusionLeft > segment.x) {
        result.push({ x: segment.x, width: exclusionLeft - segment.x })
      }
      if (exclusionRight < segmentRight) {
        result.push({ x: exclusionRight, width: segmentRight - exclusionRight })
      }
      return result
    })
  }
  return segments.filter(segment => segment.width >= 4)
}

/** 指定した行幅へ収まる文字列と残りを分ける。 */
function takeTextForWidth(
  context: TextMeasureContext,
  input: string,
  width: number,
) {
  const text = input.replace(/^ +/u, '')
  const leadingRemoved = input.length - text.length
  if (text.startsWith('\n')) {
    return { text: '', consumed: leadingRemoved + 1, forcedBreak: true }
  }
  let candidate = ''
  let lastWhitespace = -1
  let index = 0
  for (const character of text) {
    if (character === '\n') {
      return {
        text: candidate.trimEnd(),
        consumed: leadingRemoved + index + 1,
        forcedBreak: true,
      }
    }
    if (context.measureText(candidate + character).width > width)
      break
    candidate += character
    index += character.length
    if (/\s/u.test(character))
      lastWhitespace = index
  }
  if (index === text.length) {
    return {
      text: candidate.trimEnd(),
      consumed: leadingRemoved + index,
      forcedBreak: false,
    }
  }
  if (lastWhitespace > 0) {
    candidate = text.slice(0, lastWhitespace).trimEnd()
    index = lastWhitespace
  }
  return {
    text: candidate,
    consumed: leadingRemoved + index,
    forcedBreak: false,
  }
}

/** 指定サイズで保護領域を避けながら文字を行へ配置する。 */
function flowTextAtSize(
  context: TextMeasureContext,
  text: string,
  width: number,
  height: number,
  fontSize: number,
  exclusions: readonly TextExclusion[],
  fontFamily: string,
): FlowTextLayout {
  context.font = `${fontSize}px ${fontFamily}`
  const lineHeight = Math.ceil(fontSize * 1.25)
  const runs: TextRun[] = []
  let remaining = text.replace(/\r\n?/gu, '\n')

  for (let y = 0; y + lineHeight <= height && remaining; y += lineHeight) {
    const segments = availableSegments(width, y, lineHeight, exclusions)
    for (const segment of segments) {
      const chunk = takeTextForWidth(context, remaining, segment.width)
      if (chunk.consumed === 0)
        continue
      remaining = remaining.slice(chunk.consumed)
      if (chunk.text)
        runs.push({ ...segment, text: chunk.text, y })
      if (chunk.forcedBreak || !remaining)
        break
    }
  }

  return { fontSize, lineHeight, runs, fits: remaining.trim().length === 0 }
}

/** 各行の保護領域を避けながら配置し、入りきらない場合はフォントサイズを下げて再試行する。 */
export function fitTextAroundExclusions(
  context: TextMeasureContext,
  text: string,
  width: number,
  height: number,
  requestedFontSize: number,
  exclusions: readonly TextExclusion[],
  minimumFontSize = 8,
  fontFamily = 'sans-serif',
): FlowTextLayout {
  const maxSize = Math.max(minimumFontSize, requestedFontSize)
  let fallback: FlowTextLayout | null = null
  for (let fontSize = maxSize; fontSize >= minimumFontSize; fontSize -= 1) {
    const layout = flowTextAtSize(
      context,
      text,
      width,
      height,
      fontSize,
      exclusions,
      fontFamily,
    )
    fallback = layout
    if (layout.fits)
      return layout
  }
  return (
    fallback ?? {
      fontSize: minimumFontSize,
      lineHeight: Math.ceil(minimumFontSize * 1.25),
      runs: [],
      fits: !text,
    }
  )
}
