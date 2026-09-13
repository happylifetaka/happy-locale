import type { TranslationProvider } from './types'

/** 配布サンプルの原文と日本語訳の固定対応表。 */
const translations: [string, string][] = [
  ['LANTERN GROVE', '灯りの木立'],
  ['PLACE', '場所'],
  ['FOREST / QUIET', '森／静寂'],
  ['CLOUD COURIER', '雲の配達人'],
  ['TRAVELER', '旅人'],
  ['AIR / MESSENGER', '空／使者'],
  ['TIDAL COMPASS', '潮の羅針盤'],
  ['TOOL', '道具'],
  ['NAVIGATION', '航行'],
  ['GLASS ORCHARD', 'ガラスの果樹園'],
  ['SITE', '拠点'],
  ['GROWTH', '成長'],
  ['THE QUIET BRIDGE', '静かな橋'],
  ['EVENT', 'イベント'],
  ['ONE USE', '使い切り'],
  ['When you enter this place, gain 2 [icon:sun].', 'この場所に入ったとき、2 [icon:sun]を得る。'],
  ['Spend 1 [icon:drop]: move one marker from this card to your reserve.', '1 [icon:drop]を消費する：このカードのマーカー1個を自分の予備置き場に移す。'],
  ['Spend 1 [icon:drop]: move one marker', '1 [icon:drop]を消費する：マーカー1個を移す'],
  ['from this card to your reserve.', '（このカードから自分の予備置き場へ）。'],
  ['AFTER MOVING', '移動後'],
  ['Draw 2 cards, then keep 1.', 'カードを2枚引き、そのうち1枚を残す。'],
  ['If your reserve is empty, gain 1 [icon:sun].', '自分の予備置き場が空なら、1 [icon:sun]を得る。'],
  ['Choose a direction.', '方向を1つ選ぶ。'],
  ['Spend 2 [icon:drop] to move up to 3 spaces.', '2 [icon:drop]を消費し、最大3マス移動する。'],
  ['You may stop on an occupied space.', '他の駒があるマスで止まってもよい。'],
  ['AT DAWN', '夜明け'],
  ['AT DUSK', '夕暮れ'],
  ['Place 1 [icon:sun] on this card.', 'このカードに1 [icon:sun]を置く。'],
  ['Remove 3 [icon:sun]: gain 2 points.', '3 [icon:sun]を取り除く：2点を得る。'],
  ['All travelers may move 1 space.', 'すべての旅人は1マス移動してもよい。'],
  ['A traveler who stays in place gains 2 [icon:drop] instead. Discard this card.', '移動しなかった旅人は、代わりに2 [icon:drop]を得る。このカードを捨てる。'],
  ['A traveler who stays in place gains', '移動しなかった旅人は'],
  ['2 [icon:drop] instead. Discard this card.', '代わりに2 [icon:drop]を得る。このカードを捨てる。'],
]

/** サンプル原文を固定訳との照合に使用する表記へ整える。 */
function normalize(text: string) {
  return text.trim().split(/(\[icon:[^\]\r\n]+\])/gu).map((part, index) => index % 2 ? part : part.replace(/\s+/gu, ' ').toLowerCase()).join('').replace(/\s+([.,:])/gu, '$1')
}
/** 長い原文を先に照合するために正規化・並べ替えたサンプル訳。 */
const entries = translations.map(([source, target]) => ({ source: normalize(source), target }))
  .sort((a, b) => b.source.length - a.source.length)

/** Offline demo lookup. Unknown or misrecognized text is never guessed. */
// 配布サンプルの原文に対する固定訳を返す。デモでも通常の翻訳インターフェースを使う。
export class SampleTranslationProvider implements TranslationProvider {
  /** サンプル原文に一致する固定訳を返し、対応しない入力はエラーにする。 */
  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    if (sourceLang.toUpperCase() !== 'EN' || targetLang.toUpperCase() !== 'JA')
      throw new Error('サンプル翻訳は英語から日本語への翻訳に対応しています。')
    let remaining = normalize(text)
    if (!remaining)
      throw new Error('翻訳する原文を入力してください。')
    const result: string[] = []
    while (remaining) {
      const match = entries.find(entry => remaining === entry.source || remaining.startsWith(`${entry.source} `))
      if (!match)
        throw new Error('サンプル5枚の登録済み英文に一致しません。OCRの誤字とアイコンを確認してください（[icon:sun] / [icon:drop]）。')
      result.push(match.target)
      remaining = remaining.slice(match.source.length).trim()
    }
    return result.join('\n')
  }
}
