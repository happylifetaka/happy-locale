import type { FolderProjectDocument } from '../../../app/types/editor'
import { useCardEditor } from '../../../app/composables/useCardEditor'
import { iconThumbnailCacheName } from '../../../app/services/asset-discovery/thumbnail-cache'
import { serializeFolderProject } from '../../../app/services/project/format'
import { baselineProject } from '../../fixtures/refactoring-baseline'

/** The ordinary app opens this synthetic OPFS project through its real folder workflow. */
export async function prepareDiscoveryUIProject(groupCount = 0) {
  const root = await navigator.storage.getDirectory()
  const name = `discovery-ui-${crypto.randomUUID()}`
  const directory = await root.getDirectoryHandle(name, { create: true })
  const images = await directory.getDirectoryHandle('images', { create: true })
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 900
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#182028'
  ctx.fillRect(0, 0, 600, 900)
  ctx.fillStyle = '#fafafa'
  ctx.font = '28px serif'
  ctx.fillText('Gain two tokens', 80, 610)
  ctx.fillStyle = '#ee3030'
  ctx.fillRect(275, 574, 32, 42)
  ctx.fillStyle = '#a0a0a0'
  ctx.fillRect(320, 574, 32, 42)
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG failed')), 'image/png'))
  canvas.width = canvas.height = 1
  const editor = useCardEditor()
  editor.loadImageProject('one.png', 600, 900)
  editor.addRegion({ x: 60, y: 540, width: 360, height: 120 }, '#182028')
  editor.updateRegion(editor.selectedRegionId.value!, { originalText: 'Keep the source text.', translatedText: '既存の訳文', translationStatus: 'reviewed', backgroundMode: 'none' })
  const project = baselineProject()
  const base = project.cards[0]!
  project.activeCardId = 'one'
  project.cards = ['one', 'two'].map(id => ({ ...base, id, imageName: `${id}.png`, imagePath: `images/${id}.png`, imageWidth: 600, imageHeight: 900, regions: structuredClone(editor.project.value.regions) }))
  if (groupCount) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await png.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    project.assetDiscovery = {
      occurrences: Array.from({ length: groupCount }, (_, index) => ({
        id: `occurrence-${index}`,
        cardId: 'one',
        imageDigest: digest,
        imageSize: { width: 600, height: 900 },
        bounds: { x: 275, y: 574, width: index === groupCount - 1 ? 77 : 32, height: 42 },
        detectedBounds: null,
        origin: 'manual',
        detectorRevision: 'synthetic-ui',
        decision: 'pending',
        assetId: null,
        approval: null,
        owner: null,
      })),
      groups: Array.from({ length: groupCount }, (_, index) => ({
        id: `internal-${index}`,
        name: '',
        memberIds: [`occurrence-${index}`],
        representativeId: `occurrence-${index}`,
        proposedAssetId: null,
      })),
    }
  }
  for (const id of ['one', 'two']) {
    const writer = await (await images.getFileHandle(`${id}.png`, { create: true })).createWritable()
    await writer.write(png)
    await writer.close()
  }
  const writer = await (await directory.getFileHandle('project.json', { create: true })).createWritable()
  await writer.write(serializeFolderProject(project))
  await writer.close()
  Object.assign(window, { showDirectoryPicker: async () => directory })
  return { name, regions: project.cards.map(card => card.regions) }
}

/** Invented pre-classified icon without a region owner. */
export async function prepareIconRegionUIProject(fresh = false, protrusion = false) {
  const fixture = await prepareDiscoveryUIProject(1)
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
  const handle = await directory.getFileHandle('project.json')
  const project = JSON.parse(await (await handle.getFile()).text()) as FolderProjectDocument
  const occurrence = project.assetDiscovery!.occurrences[0]!
  occurrence.bounds.width = 32
  occurrence.assetId = 'token'
  occurrence.owner = null
  project.assetDiscovery!.groups[0]!.proposedAssetId = 'token'
  project.assets = [{ id: 'token', name: 'token', sourceImageId: 'one', sourceRect: occurrence.bounds, imagePath: 'assets/token.png', scale: 1, baselineOffset: 0, inlinePadding: 0 }]
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 42
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ee3030'
  ctx.fillRect(0, 0, 32, 42)
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
  const assets = await directory.getDirectoryHandle('assets', { create: true })
  const assetWriter = await (await assets.getFileHandle('token.png', { create: true })).createWritable()
  await assetWriter.write(png)
  await assetWriter.close()
  if (protrusion)
    project.cards[0]!.regions[0]!.height = 73
  if (fresh) {
    const region = project.cards[0]!.regions[0]!
    project.cards[0]!.ocrCandidates = [{ id: 'saved-candidate', x: region.x, y: region.y, width: region.width, height: region.height, selected: true, text: 'Gain two tokens', confidence: 90, lines: [] }]
    project.cards[0]!.regions = []
  }
  const writer = await handle.createWritable()
  await writer.write(serializeFolderProject(project))
  await writer.close()
  return { name: fixture.name, project }
}

/** Single-pixel stripes expose accidental whole-card downsampling in candidate previews. */
export async function prepareDiscoveryThumbnailUIProject() {
  const fixture = await prepareDiscoveryUIProject(32)
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
  const handle = await directory.getFileHandle('project.json')
  const project = JSON.parse(await (await handle.getFile()).text()) as FolderProjectDocument
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 900
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#555555'
  ctx.fillRect(0, 0, 600, 900)
  for (const [index, item] of project.assetDiscovery!.occurrences.entries()) {
    item.cardId = index % 2 ? 'two' : 'one'
    item.bounds = { x: 12 + (index % 6) * 90, y: 20 + Math.floor(index / 6) * 130, width: 32, height: 42 }
    for (let x = 0; x < 32; x++) {
      ctx.fillStyle = x % 2 ? '#ffffff' : '#000000'
      ctx.fillRect(item.bounds.x + x, item.bounds.y, 1, item.bounds.height)
    }
  }
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
  canvas.width = canvas.height = 1
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await png.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
  for (const item of project.assetDiscovery!.occurrences) item.imageDigest = digest
  const images = await directory.getDirectoryHandle('images')
  for (const id of ['one', 'two']) {
    const writer = await (await images.getFileHandle(`${id}.png`)).createWritable()
    await writer.write(png)
    await writer.close()
  }
  const writer = await handle.createWritable()
  await writer.write(serializeFolderProject(project))
  await writer.close()
  return { name: fixture.name, project, cacheName: await iconThumbnailCacheName(project.assetDiscovery!.occurrences.at(-1)!) }
}
