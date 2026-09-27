/** 値がnull以外のオブジェクトとして扱えるか判定する。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 文字列ならその値を返し、それ以外は既定値へ戻す。 */
export function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 有効な数値ならその値を返し、それ以外は既定値へ戻す。 */
export function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 真偽値ならその値を返し、それ以外は既定値へ戻す。 */
export function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
