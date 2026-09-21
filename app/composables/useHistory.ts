import type { ShallowRef } from 'vue'
import { computed, shallowRef } from 'vue'

/**
 * Editor state is JSON-compatible. Serializing first unwraps nested Vue proxies
 * (for example a mask stroke built inside a ref) before structured cloning.
 */
function clone<T>(value: T): T {
  return structuredClone(JSON.parse(JSON.stringify(value)) as T)
}

export interface HistorySnapshot<T, E = never> {
  state: T
  past: T[]
  future: T[]
  /** JSON互換の付随変更。状態ではなく履歴の辺に属し、通常の編集には付けない。 */
  effects?: { past: (E | null)[], future: (E | null)[] }
}

type BeforeTransition<T, E> = (next: T, effect: E | null) => void

/** 確定操作ごとの独立したスナップショットを保持し、Undo／Redoで参照の混在を防ぐ。 */
export function useHistory<T, E = never>(initialValue: T, limit = 100) {
  /** Undo／Redoの対象となる現在の編集スナップショット。 */
  const state = shallowRef(clone(initialValue)) as ShallowRef<T>
  /** Undoで戻れる過去のスナップショット。 */
  const past = shallowRef<T[]>([])
  /** Redoで進める取り消し済みのスナップショット。 */
  const future = shallowRef<T[]>([])
  let pastEffects: (E | null)[] = []
  let futureEffects: (E | null)[] = []

  /** 戻る先の履歴が残っているか。 */
  const canUndo = computed(() => past.value.length > 0)
  /** やり直す先の履歴が残っているか。 */
  const canRedo = computed(() => future.value.length > 0)

  /** 新しい状態を履歴へ確定し、やり直し側の分岐を解除する。 */
  function commit(nextValue: T, effect: E | null = null, before?: BeforeTransition<T, E>) {
    // Input/change events may publish the same JSON state more than once.
    // A no-op must neither consume an undo step nor discard the redo branch.
    if (effect === null && JSON.stringify(nextValue) === JSON.stringify(state.value))
      return
    const next = clone(nextValue)
    const copiedEffect = clone(effect)
    const previous = clone(state.value)
    // 外部の付随データを検証・反映できない場合は履歴も進めない。
    before?.(clone(next), clone(copiedEffect))
    pastEffects = [...pastEffects, copiedEffect].slice(-limit)
    futureEffects = []
    past.value = [...past.value, previous].slice(-limit)
    state.value = next
    future.value = []
  }

  /** 現在値を差し替え、過去と未来の履歴を初期化する。 */
  function replace(nextValue: T) {
    state.value = clone(nextValue)
    pastEffects = []
    futureEffects = []
    past.value = []
    future.value = []
  }

  /** 直前の確定状態へ履歴を戻す。 */
  function undo(before?: BeforeTransition<T, E>) {
    const previous = past.value.at(-1)
    if (!previous)
      return
    const current = clone(state.value)
    const effect = pastEffects.at(-1) ?? null
    before?.(clone(previous), clone(effect))
    pastEffects = pastEffects.slice(0, -1)
    futureEffects = [...futureEffects, effect].slice(-limit)
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, current].slice(-limit)
    state.value = previous
  }

  /** 取り消した状態へ履歴を進める。 */
  function redo(before?: BeforeTransition<T, E>) {
    const next = future.value.at(-1)
    if (!next)
      return
    const current = clone(state.value)
    const effect = futureEffects.at(-1) ?? null
    before?.(clone(next), clone(effect))
    futureEffects = futureEffects.slice(0, -1)
    pastEffects = [...pastEffects, effect].slice(-limit)
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, current].slice(-limit)
    state.value = next
  }

  /** 現在値とUndo／Redoの履歴をまとめて独立した複製として返す。 */
  function snapshot(): HistorySnapshot<T, E> {
    return clone({
      state: state.value,
      past: past.value,
      future: future.value,
      ...(pastEffects.some(effect => effect !== null) || futureEffects.some(effect => effect !== null)
        ? { effects: { past: pastEffects, future: futureEffects } }
        : {}),
    })
  }

  /** 退避した現在値と履歴を復元する。 */
  function restore(snapshotValue: HistorySnapshot<T, E>) {
    const restored = clone(snapshotValue)
    if (restored.effects && (restored.effects.past.length !== restored.past.length || restored.effects.future.length !== restored.future.length))
      throw new Error('編集履歴の付随変更が一致しません。')
    pastEffects = (restored.effects?.past ?? restored.past.map(() => null)).slice(-limit)
    futureEffects = (restored.effects?.future ?? restored.future.map(() => null)).slice(-limit)
    state.value = restored.state
    past.value = restored.past.slice(-limit)
    future.value = restored.future.slice(-limit)
  }

  return {
    state,
    canUndo,
    canRedo,
    commit,
    replace,
    undo,
    redo,
    snapshot,
    restore,
  }
}

/** カードごとに履歴を退避する。外部から本文が変更された場合は古い履歴を再利用しない。 */
export function useKeyedHistory<T, E = never>(initialValue: T, limit = 100) {
  /** 現在の編集状態とUndo／Redoの履歴を管理する窓口。 */
  const history = useHistory<T, E>(initialValue, limit)
  /** カードIDごとに退避した現在・過去・未来の履歴。 */
  const timelines = new Map<string, HistorySnapshot<T, E>>()
  /** 現在表示している履歴を対応付けるカードID。 */
  let activeKey: string | null = null

  /** カード別に保持した履歴をすべて消して初期状態を設定する。 */
  function reset(key: string | null, nextValue: T) {
    timelines.clear()
    activeKey = key
    history.replace(nextValue)
  }

  /** 現在カードの履歴を退避して別カードへ切り替える。 */
  function switchTo(key: string, nextValue: T) {
    if (activeKey)
      timelines.set(activeKey, history.snapshot())
    const saved = timelines.get(key)
    if (saved && JSON.stringify(saved.state) === JSON.stringify(nextValue))
      history.restore(saved)
    else
      history.replace(nextValue)
    activeKey = key
  }

  /** Shared metadata changes must also migrate inactive cards and redo branches. */
  function mapStates(transform: (value: T) => T) {
    const mapSnapshot = (snapshot: HistorySnapshot<T, E>): HistorySnapshot<T, E> => ({
      ...snapshot,
      state: transform(snapshot.state),
      past: snapshot.past.map(transform),
      future: snapshot.future.map(transform),
    })
    history.restore(mapSnapshot(history.snapshot()))
    for (const [key, snapshot] of timelines)
      timelines.set(key, mapSnapshot(snapshot))
  }

  /** 現在の履歴を保存後のカードIDへ結び付ける。 */
  function bindKey(key: string) {
    activeKey = key
  }

  /** 非表示カードへの一括処理もカード別のUndoへ記録する。表示カードは切り替えない。 */
  function commitTo(key: string, previous: T, next: T, effect: E | null, before: BeforeTransition<T, E>) {
    if (key === activeKey) {
      if (JSON.stringify(history.state.value) !== JSON.stringify(previous))
        throw new Error('処理中にカードが変更されました。')
      history.commit(next, effect, before)
      return
    }
    const target = useHistory<T, E>(previous, limit)
    const saved = timelines.get(key)
    if (saved && JSON.stringify(saved.state) === JSON.stringify(previous))
      target.restore(saved)
    target.commit(next, effect, before)
    timelines.set(key, target.snapshot())
  }

  return { ...history, reset, switchTo, bindKey, mapStates, commitTo }
}
