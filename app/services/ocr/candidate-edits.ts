import type { CardProject } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'

export interface CardCandidateEditState {
  project: CardProject
  candidates: RegionCandidate[]
}

/** 候補全部ではなく、今回変更した項目だけを通常の編集履歴へ付随させる。 */
export interface CandidateEdit {
  id: string
  before: RegionCandidate | null
  after: RegionCandidate | null
  beforeIndex?: number
}

export function cardEditingSignature(project: CardProject): string {
  return JSON.stringify([project.imageName, project.imageWidth, project.imageHeight, project.regions])
}

function candidateSignature(item: RegionCandidate | null): string {
  const block = (value: RegionCandidate['lines'][number]) => [value.text, value.x, value.y, value.width, value.height, value.confidence]
  return JSON.stringify(item && [item.id, block(item), item.selected, item.sampleRegionId ?? null, item.lines.map(block)])
}

/** 表示コピーと保存値を比較する。JSONのキー順の差だけでは履歴を破棄しない。 */
export function regionCandidatesSignature(items: readonly RegionCandidate[]): string {
  return JSON.stringify(items.map(candidateSignature))
}

/** 入力は保存形式の検証済み候補。再検出では既存候補の削除・並べ替えをしない。 */
export function candidateEdits(before: readonly RegionCandidate[], after: readonly RegionCandidate[]): CandidateEdit[] {
  const existing = new Set(before.map(item => item.id))
  if (JSON.stringify(after.filter(item => existing.has(item.id)).map(item => item.id)) !== JSON.stringify([...existing]))
    throw new Error('再検出では既存候補を削除・並べ替えできません。')
  const previous = new Map(before.map(item => [item.id, item]))
  for (const item of after) {
    const old = previous.get(item.id)
    if (old && (item.text !== old.text || item.confidence !== old.confidence || item.selected !== old.selected || item.sampleRegionId !== old.sampleRegionId))
      throw new Error('枠の修正では既存候補の文字列・信頼度・選択状態を変更できません。')
  }
  return after.flatMap(item => candidateSignature(previous.get(item.id) ?? null) === candidateSignature(item)
    ? []
    : [{ id: item.id, before: previous.get(item.id) ?? null, after: item }])
}

/** 領域へ採用した候補だけを消費する。残る候補の内容・順序は変えない。 */
export function consumedCandidateEdits(before: readonly RegionCandidate[], after: readonly RegionCandidate[]): CandidateEdit[] {
  const remaining = new Set(after.map(item => item.id))
  if (regionCandidatesSignature(before.filter(item => remaining.has(item.id))) !== regionCandidatesSignature(after))
    throw new Error('領域の採用では残す候補の内容・順序を変更できません。')
  return before.flatMap((item, index) => remaining.has(item.id) ? [] : [{ id: item.id, before: item, after: null, beforeIndex: index }])
}

/** 後から行った別候補の調整は保持する。同じ候補への編集があれば全体を止める。 */
export function applyCandidateEdits(current: readonly RegionCandidate[], edits: readonly CandidateEdit[], direction: 'forward' | 'backward'): RegionCandidate[] {
  const byId = new Map(current.map(item => [item.id, item]))
  const replacements = new Map<string, RegionCandidate | null>()
  for (const edit of edits) {
    const expected = direction === 'forward' ? edit.before : edit.after
    const next = direction === 'forward' ? edit.after : edit.before
    if (replacements.has(edit.id) || candidateSignature(byId.get(edit.id) ?? null) !== candidateSignature(expected))
      throw new Error('適用後に対象のOCR候補が変更されました。候補を確認し、再比較してください。')
    replacements.set(edit.id, next)
  }
  const result = current.flatMap(item => replacements.has(item.id) ? replacements.get(item.id) ? [replacements.get(item.id)!] : [] : [item])
  for (const edit of edits) {
    const item = replacements.get(edit.id)
    if (!byId.has(edit.id) && item)
      result.splice(direction === 'backward' ? edit.beforeIndex ?? result.length : result.length, 0, item)
  }
  return structuredClone(result)
}
