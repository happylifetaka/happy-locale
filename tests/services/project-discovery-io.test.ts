import { expect, it } from 'vitest'
import { createFolderProject, saveFolderProject } from '~/services/project/folder'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { discoveryProject } from '../fixtures/asset-discovery'

/** Writes commit at close, matching the browser file writer's transactional boundary. */
function memoryFolder() {
  const files = new Map<string, string | Blob>()
  const writes: string[] = []
  const failures = new Set<string>()
  function directory(prefix = ''): FileSystemDirectoryHandle {
    return {
      name: 'Synthetic folder',
      async getDirectoryHandle(name: string) { return directory(`${prefix}${name}/`) },
      async removeEntry(name: string) { files.delete(`${prefix}${name}`) },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = `${prefix}${name}`
        if (!files.has(path) && !options?.create)
          throw new DOMException('Missing', 'NotFoundError')
        return {
          async getFile() { return new File([files.get(path)!], name) },
          async createWritable() {
            let staged: string | Blob
            return {
              async write(value: string | Blob) {
                if (failures.has(path))
                  throw new Error(`Write failed: ${path}`)
                staged = value
              },
              async close() {
                files.set(path, staged)
                writes.push(path)
              },
              async abort() {},
            }
          },
        }
      },
    } as unknown as FileSystemDirectoryHandle
  }
  return { files, writes, failures, directory: directory() }
}

it('persists first-save discovery JSON after its asset PNG and restores identical review state', async () => {
  const io = memoryFolder()
  const project = discoveryProject()
  const blob = new Blob(['synthetic PNG'])
  const saved = await createFolderProject(
    io.directory,
    project.cards[0]!,
    new File(['synthetic image'], 'synthetic.png'),
    project.activeCardId,
    project.assets,
    [],
    [],
    new Map([['asset-1', blob]]),
    [],
    project.cards[0]!.ocrCandidates,
    project.assetDiscovery,
  )
  expect(io.files.get('assets/asset-1.png')).toBe(blob)
  expect(io.writes.indexOf('assets/asset-1.png')).toBeLessThan(io.writes.indexOf('project.json'))
  expect(saved.version).toBe(4)
  expect(parseFolderProject(io.files.get('project.json') as string).assetDiscovery).toEqual(project.assetDiscovery)
})

it.each(['success', 'project.json', 'project.backup.json', 'invalid-data'] as const)('preserves save ordering and prior image references for %s', async (failure) => {
  const io = memoryFolder()
  const project = discoveryProject()
  const previous = serializeFolderProject(project)
  const oldImage = new Blob(['old PNG'])
  io.files.set('project.json', previous)
  io.files.set('project.backup.json', 'older backup')
  io.files.set('assets/asset-1.png', oldImage)
  const updated = structuredClone(project)
  updated.assetDiscovery!.groups[0]!.name = 'Reviewed'
  if (failure === 'invalid-data')
    updated.assetDiscovery!.occurrences[0]!.cardId = 'missing'
  else if (failure !== 'success')
    io.failures.add(failure)
  const newImage = new Blob(['new PNG'])
  const saving = saveFolderProject(io.directory, updated, updated.cards[0]!, updated.assets, [], [], new Map([['asset-1', newImage]]))
  if (failure === 'success') {
    const saved = await saving
    const path = saved.assets[0]!.imagePath
    expect(io.files.get(path)).toBe(newImage)
    expect(io.writes.indexOf(path)).toBeLessThan(io.writes.indexOf('project.backup.json'))
    expect(io.writes.indexOf('project.backup.json')).toBeLessThan(io.writes.indexOf('project.json'))
    expect(io.files.get('project.backup.json')).toBe(previous)
    expect(parseFolderProject(io.files.get('project.json') as string).assetDiscovery).toEqual(updated.assetDiscovery)
  }
  else {
    await expect(saving).rejects.toThrow(failure === 'invalid-data' ? 'アイコン候補' : 'Write failed')
    expect(io.files.get('project.json')).toBe(previous)
    expect(io.files.get('assets/asset-1.png')).toBe(oldImage)
    expect([...io.files.keys()].filter(path => path.startsWith('assets/'))).toEqual(['assets/asset-1.png'])
    if (failure === 'invalid-data')
      expect(io.files.get('project.backup.json')).toBe('older backup')
  }
})
