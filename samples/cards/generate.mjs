import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Original vector artwork, symbols, card names and fictional rules.
// No external images, fonts, logos or game text are loaded.
const directory = fileURLToPath(new URL('./svg/', import.meta.url))
await mkdir(directory, { recursive: true })
const cards = [
  ['01', 'LANTERN GROVE', 'PLACE', 'FOREST / QUIET', '#356b61', 'grove', ['When you enter this place, gain 2 {sun}.', 'Spend 1 {drop}: move one marker', 'from this card to your reserve.']],
  ['02', 'CLOUD COURIER', 'TRAVELER', 'AIR / MESSENGER', '#547991', 'cloud', ['AFTER MOVING', 'Draw 2 cards, then keep 1.', 'If your reserve is empty, gain 1 {sun}.']],
  ['03', 'TIDAL COMPASS', 'TOOL', 'NAVIGATION', '#326e83', 'compass', ['Choose a direction.', 'Spend 2 {drop} to move up to 3 spaces.', 'You may stop on an occupied space.']],
  ['04', 'GLASS ORCHARD', 'SITE', 'GROWTH', '#657146', 'orchard', ['AT DAWN', 'Place 1 {sun} on this card.', 'AT DUSK', 'Remove 3 {sun}: gain 2 points.']],
  ['05', 'THE QUIET BRIDGE', 'EVENT', 'ONE USE', '#836649', 'bridge', ['All travelers may move 1 space.', 'A traveler who stays in place gains', '2 {drop} instead. Discard this card.']],
]
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const sun = '<g fill="none" stroke="currentColor" stroke-width="3"><circle r="8"/><path d="M0-15v4M0 11v4M-15 0h4M11 0h4M-11-11l3 3M8 8l3 3M-11 11l3-3M8-8l3-3"/></g>'
const drop = '<path d="M0-16C-3-10-12 0-12 6a12 12 0 0024 0C12 0 3-10 0-16Z" fill="currentColor"/>'
function symbols() {
  return `<defs><g id="sun">${sun}</g><g id="drop">${drop}</g></defs>`
}
function line(text, x, y, size = 26) {
  // Position inline symbols explicitly so OCR has separate word/icon bounds.
  let cursor = x
  return text.split(/(\{sun\}|\{drop\})/).map(part => {
    if (!part) return ''
    if (part.startsWith('{')) {
      const value = `<use href="#${part.slice(1, -1)}" transform="translate(${cursor + 15} ${y - 9})"/>`
      cursor += 34
      return value
    }
    const value = `<text x="${cursor}" y="${y}" font-size="${size}">${escape(part)}</text>`
    cursor += part.length * size * 0.6
    return value
  }).join('')
}
function art(kind, color) {
  const sky = `<rect width="600" height="350" fill="${color}"/><circle cx="475" cy="70" r="45" fill="#f4db9b"/><path d="M0 275Q140 170 300 260T600 230V350H0Z" fill="#203e47"/><path d="M0 305Q180 260 310 320T600 285V350H0Z" fill="#162d35"/>`
  const branch = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0V-115M0-50l-40-35M0-65l35-30" stroke="#d9bd87" stroke-width="9"/><path d="M-58-90l30-70 45 12 45 65-60 32Z" fill="#93b4a0"/><circle cy="-115" r="14" fill="#f6dfa4"/></g>`
  const drawing = {
    grove: branch(140, 280) + branch(315, 305, 1.4) + branch(485, 270, 0.8),
    cloud: '<path d="M75 145q0-35 40-35q10-55 70-35q35-35 60 10q55-5 60 50v25H75Z" fill="#e5e9dd"/><path d="M215 225l100-95 140 35-90 105Z" fill="#e6c78e"/><path d="M315 130l10 105 130-70M215 225l110 10 40 35" fill="none" stroke="#826b53" stroke-width="5"/><path d="M80 240h110M115 275h80" stroke="#c3d8db" stroke-width="5"/>',
    compass: '<circle cx="300" cy="175" r="120" fill="#d9bd83"/><circle cx="300" cy="175" r="99" fill="#f1ead8"/><path d="M300 60l30 115-30 115-30-115Z" fill="#476e7c"/><path d="M185 175l115-30 115 30-115 30Z" fill="#8a7556"/><circle cx="300" cy="175" r="14" fill="#ead19c"/>',
    orchard: branch(125, 300, 1.1) + branch(300, 295, 1.4) + branch(475, 300, 1.1) + '<path d="M70 220L300 55l230 165M70 220v100h460V220M300 55v265" stroke="#dbecdf" fill="none" stroke-width="5"/>',
    bridge: '<path d="M200 350q140-110 60-190l85-10q-35 140 95 200" fill="#82b3bb"/><path d="M60 240q240-210 480 0v45q-240-185-480 0Z" fill="#d3bd93"/><path d="M65 205q235-190 470 0M110 180v45M205 140v45M300 127v45M395 140v45M490 180v45" fill="none" stroke="#eee0bb" stroke-width="8"/>',
  }[kind]
  return sky + drawing
}

const manifest = []
for (const [id, name, type, detail, color, kind, lines] of cards) {
  const variant = Number(id) % 3
  const artY = variant === 0 ? 68 : 182
  const titleY = variant === 0 ? 500 : 99
  const rulesY = 645
  const content = `<svg xmlns="http://www.w3.org/2000/svg" width="744" height="1039" viewBox="0 0 744 1039">
${symbols()}
<rect width="744" height="1039" rx="32" fill="#172d38"/>
<rect x="18" y="18" width="708" height="1003" rx="22" fill="#ede8d8"/>
<g font-family="Courier New, monospace" fill="#193640" color="#193640">
<text x="48" y="49" font-size="14" letter-spacing="3">FIELD NOTES / ORIGINAL SAMPLE ${id}</text>
<svg x="48" y="${artY}" width="648" height="378" viewBox="0 0 600 350">${art(kind, color)}</svg>
<text x="48" y="${titleY}" font-size="${name.length > 18 ? 36 : 42}" font-weight="bold">${name}</text>
<text x="48" y="${titleY + 42}" font-size="24" font-weight="bold">${type}</text>
<text x="48" y="${titleY + 68}" font-size="16" letter-spacing="2">${detail}</text>
<rect x="38" y="${rulesY - 42}" width="668" height="${940 - rulesY}" rx="15" fill="${id === '05' ? '#244b51' : '#fffdf4'}" stroke="${color}" stroke-width="3"/>
${id === '05' ? '<g fill="#ffffff" color="#ffffff">' : ''}${lines.map((text, index) => line(text, 57, rulesY + index * 45, /^[A-Z /]+$/.test(text) ? 22 : 23)).join('\n')}${id === '05' ? '</g>' : ''}
${Number(id) % 2 === 0 ? `<g transform="translate(650 898)"><circle r="38" fill="${color}" stroke="#ede8d8" stroke-width="6"/><text text-anchor="middle" y="12" fill="white" font-size="36">${Number(id) / 2}</text></g>` : ''}
<path d="M48 957h648" stroke="#a1aaa0"/>
<text x="48" y="983" font-size="15">SAMPLE ${id} / Fictional rules / Not a commercial game</text>
</g></svg>`
  const filename = `${id}-${kind}`
  await writeFile(`${directory}/${filename}.svg`, content)
  manifest.push({ id, filename: `${filename}.png`, name, type, detail, lines, suggestedChecks: ['OCR', 'ruby', ...(lines.some(line => line.includes('{')) ? ['source icons'] : []), ...(Number(id) % 2 === 0 ? ['protect overlapping badge'] : [])] })
}
await writeFile(new URL('./manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Created ${cards.length} original SVG cards and manifest.json`)
