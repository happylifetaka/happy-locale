import type { FolderProjectDocument } from '~/types/editor'
import { describe, expect, it, vi } from 'vitest'
import {
  activateProjectCard,
  countProjectFontUsage,
  finalizeProjectCardDeletions,
  moveProjectCard,
  removeProjectFont,
  renameProjectAssetTokens,
  renameProjectCard,
  updateProjectCard,
} from '~/services/project/cards'
import {
  addFolderProjectCards,
  folderProjectExists,
  listImageFiles,
  loadFolderProjectCardImage,
  openFolderProject,
  removeFolderProjectCardImages,
  saveFolderProject,
} from '~/services/project/folder'

function projectDocument(): FolderProjectDocument {
  return {
    version: 2,
    name: 'Cards',
    activeCardId: 'card-1',
    cards: [
      {
        id: 'card-1',
        imagePath: 'images/card-1.png',
        imageName: 'one.png',
        imageWidth: 100,
        imageHeight: 200,
        regions: [],
        printArea: null,
        sourceDpi: null,
      },
      {
        id: 'card-2',
        imagePath: 'images/card-2.png',
        imageName: 'two.png',
        imageWidth: 100,
        imageHeight: 200,
        regions: [],
        printArea: null,
        sourceDpi: null,
      },
    ],
    assets: [],
    fonts: [],
    ocrDictionary: [],
    glossary: [],
    printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
  }
}

describe('project card state', () => {
  it('distinguishes an existing project from a new folder', async () => {
    const existingDirectory = {
      getFileHandle: vi.fn().mockResolvedValue({}),
    } as unknown as FileSystemDirectoryHandle
    const newDirectory = {
      getFileHandle: vi.fn().mockRejectedValue(
        new DOMException('missing', 'NotFoundError'),
      ),
    } as unknown as FileSystemDirectoryHandle

    await expect(folderProjectExists(existingDirectory)).resolves.toBe(true)
    await expect(folderProjectExists(newDirectory)).resolves.toBe(false)
  })

  it('lists only direct PNG and JPEG files in natural filename order', async () => {
    const entries = [
      {
        kind: 'file',
        name: 'card10.jpg',
        getFile: async () => new File(
          [''],
          'card10.jpg',
          { type: 'image/jpeg' },
        ),
      },
      { kind: 'directory', name: 'nested' },
      {
        kind: 'file',
        name: 'notes.txt',
        getFile: async () => new File(
          [''],
          'notes.txt',
          { type: 'text/plain' },
        ),
      },
      {
        kind: 'file',
        name: 'card2.PNG',
        getFile: async () => new File(
          [''],
          'card2.PNG',
          { type: 'image/png' },
        ),
      },
    ]
    const directory = {
      async* values() {
        yield* entries
      },
    } as unknown as FileSystemDirectoryHandle

    const files = await listImageFiles(directory)

    expect(files.map(file => file.name)).toEqual(['card2.PNG', 'card10.jpg'])
  })

  it('updates one card without changing its file identity', () => {
    const document = projectDocument()
    const updated = updateProjectCard(document, 'card-1', {
      imageName: 'edited.png',
      imageWidth: 120,
      imageHeight: 220,
      regions: [],
    })

    expect(updated.cards[0]).toMatchObject({
      id: 'card-1',
      imagePath: 'images/card-1.png',
      imageName: 'edited.png',
      imageWidth: 120,
    })
    expect(updated.cards[1]).toEqual(document.cards[1])
  })

  it('activates only an existing card', () => {
    const document = projectDocument()

    expect(activateProjectCard(document, 'card-2').activeCardId).toBe('card-2')
    expect(activateProjectCard(document, 'missing')).toBe(document)
  })

  it('renames a card without changing its image file identity', () => {
    const updated = renameProjectCard(projectDocument(), 'card-1', 'Main card')

    expect(updated.cards[0]).toMatchObject({
      imageName: 'Main card',
      imagePath: 'images/card-1.png',
    })
    expect(renameProjectCard(updated, 'card-1', ' ')).toBe(updated)
  })

  it('moves cards while preserving the active card identity', () => {
    const document = projectDocument()
    const updated = moveProjectCard(document, 'card-1', 1)

    expect(updated.cards.map(card => card.id)).toEqual(['card-2', 'card-1'])
    expect(updated.activeCardId).toBe('card-1')
    expect(moveProjectCard(updated, 'card-1', 1)).toBe(updated)
  })

  it('keeps each card edit isolated while switching between images', () => {
    const document = projectDocument()
    const firstEdited = updateProjectCard(document, 'card-1', {
      imageName: 'one.png',
      imageWidth: 100,
      imageHeight: 200,
      regions: [{ translatedText: 'First card' }] as never,
    })
    const secondActive = activateProjectCard(firstEdited, 'card-2')
    const secondEdited = updateProjectCard(secondActive, 'card-2', {
      imageName: 'two.png',
      imageWidth: 100,
      imageHeight: 200,
      regions: [{ translatedText: 'Second card' }] as never,
    })
    const firstActive = activateProjectCard(secondEdited, 'card-1')

    expect(firstActive.activeCardId).toBe('card-1')
    expect(firstActive.cards[0]!.regions[0]!.translatedText).toBe('First card')
    expect(firstActive.cards[1]!.regions[0]!.translatedText).toBe('Second card')
  })

  it('renames an inline asset token across every card', () => {
    const document = projectDocument()
    document.assets = [{
      id: 'coin-id',
      name: 'coin',
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: 'assets/coin-id.png',
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }]
    document.cards[0]!.regions = [
      {
        translatedText: 'Gain [icon:coin].',
        originalText: 'Gain [icon:coin].',
        inlineAssetStyles: [{
          start: 5,
          end: 16,
          assetId: 'coin-id',
          scale: 1.4,
        }],
        textStyles: [],
      },
    ] as never
    document.cards[1]!.regions = [
      { originalText: 'Spend [icon:coin].', translatedText: 'Spend [icon:coin].' },
    ] as never

    const updated = renameProjectAssetTokens(document, 'coin', 'gold')
    expect(updated.cards[0]!.regions[0]!.originalText).toBe('Gain [icon:gold].')
    expect(updated.cards[1]!.regions[0]!.originalText).toBe('Spend [icon:gold].')

    expect(updated.cards[0]!.regions[0]!.translatedText).toBe(
      'Gain [icon:gold].',
    )
    expect(updated.cards[1]!.regions[0]!.translatedText).toBe(
      'Spend [icon:gold].',
    )
    expect(updated.cards[0]!.regions[0]!.inlineAssetStyles).toEqual([{
      start: 5,
      end: 16,
      assetId: 'coin-id',
      scale: 1.4,
    }])
  })

  it('keeps styles on a card already renamed in the active editor', () => {
    const document = projectDocument()
    document.cards[0]!.regions = [{
      translatedText: '[icon:gold]',
      originalText: '[icon:gold]',
      inlineAssetStyles: [{
        start: 0,
        end: 11,
        assetId: 'coin-id',
        scale: 1.4,
      }],
    }] as never

    const updated = renameProjectAssetTokens(
      document,
      'coin',
      'gold',
      'coin-id',
    )

    expect(updated.cards[0]!.regions[0]!.inlineAssetStyles).toEqual([{
      start: 0,
      end: 11,
      assetId: 'coin-id',
      scale: 1.4,
    }])
  })

  it('removes a font and clears whole-region and inline references', () => {
    const document = projectDocument()
    document.fonts = [{
      id: 'font-1',
      displayName: 'Example',
      familyName: 'ExampleFont',
      fileName: 'example.woff2',
      source: 'user',
    }]
    document.cards[0]!.regions = [{
      fontId: 'font-1',
      textStyles: [
        { start: 0, end: 2, fontId: 'font-1' },
        { start: 2, end: 4, fontId: 'font-1', textColor: '#ff0000' },
      ],
    }] as never
    document.cards[1]!.regions = [{
      fontId: null,
      textStyles: [{ start: 0, end: 2, fontId: 'font-1' }],
    }] as never

    expect(countProjectFontUsage(document, 'font-1')).toBe(2)

    const updated = removeProjectFont(document, 'font-1')

    expect(updated.fonts).toEqual([])
    expect(updated.cards[0]!.regions[0]).toMatchObject({
      fontId: null,
      textStyles: [{ start: 2, end: 4, textColor: '#ff0000' }],
    })
    expect(updated.cards[1]!.regions[0]!.textStyles).toEqual([])
  })

  it('removes pending cards only when deletion is finalized', () => {
    const document = projectDocument()
    const result = finalizeProjectCardDeletions(
      document,
      new Set(['card-1']),
    )

    expect(document.cards.map(card => card.id)).toEqual(['card-1', 'card-2'])
    expect(result.document.cards.map(card => card.id)).toEqual(['card-2'])
    expect(result.document.activeCardId).toBe('card-2')
    expect(result.deletedCards.map(card => card.id)).toEqual(['card-1'])
  })

  it('does not finalize deletion of every card', () => {
    const document = projectDocument()
    const result = finalizeProjectCardDeletions(
      document,
      new Set(['card-1', 'card-2']),
    )

    expect(result.document).toBe(document)
    expect(result.deletedCards).toEqual([])
  })

  it('loads only the requested card image path from the project folder', async () => {
    const expected = { name: 'card-2.png' } as File
    const getFile = vi.fn().mockResolvedValue(expected)
    const getFileHandle = vi.fn().mockResolvedValue({ getFile })
    const getDirectoryHandle = vi.fn().mockResolvedValue({ getFileHandle })
    const directory = { getDirectoryHandle } as unknown as FileSystemDirectoryHandle

    const result = await loadFolderProjectCardImage(
      directory,
      projectDocument().cards[1]!,
    )

    expect(result).toBe(expected)
    expect(getDirectoryHandle).toHaveBeenCalledWith('images')
    expect(getFileHandle).toHaveBeenCalledWith('card-2.png')
    expect(getFile).toHaveBeenCalledOnce()
  })

  it('opens the active card image and restores available shared assets', async () => {
    const document = projectDocument()
    document.activeCardId = 'card-2'
    document.assets = [
      {
        id: 'coin',
        name: 'coin',
        sourceImageId: 'card-1',
        sourceRect: { x: 1, y: 2, width: 8, height: 8 },
        imagePath: 'assets/coin.png',
        scale: 1,
        baselineOffset: 0,
        inlinePadding: 0,
      },
      {
        id: 'missing',
        name: 'missing',
        sourceImageId: 'card-1',
        sourceRect: { x: 1, y: 2, width: 8, height: 8 },
        imagePath: 'assets/missing.png',
        scale: 1,
        baselineOffset: 0,
        inlinePadding: 0,
      },
    ]
    const projectFile = new File(
      [JSON.stringify(document)],
      'project.json',
      { type: 'application/json' },
    )
    const cardFile = new File(['card'], 'card-2.png', { type: 'image/png' })
    const assetFile = new File(['coin'], 'coin.png', { type: 'image/png' })
    const files = new Map([
      ['project.json', projectFile],
      ['images/card-2.png', cardFile],
      ['assets/coin.png', assetFile],
    ])
    const directory = {
      name: 'Cards',
      getFileHandle: vi.fn(async (name: string) => {
        const file = files.get(name)
        if (!file)
          throw new DOMException('missing', 'NotFoundError')
        return { getFile: vi.fn().mockResolvedValue(file) }
      }),
      getDirectoryHandle: vi.fn(async (folder: string) => ({
        getFileHandle: vi.fn(async (name: string) => {
          const file = files.get(`${folder}/${name}`)
          if (!file)
            throw new DOMException('missing', 'NotFoundError')
          return { getFile: vi.fn().mockResolvedValue(file) }
        }),
      })),
    } as unknown as FileSystemDirectoryHandle

    const opened = await openFolderProject(directory)

    expect(opened.card.id).toBe('card-2')
    expect(opened.imageFile).toBe(cardFile)
    expect(opened.assetFiles).toEqual(new Map([['coin', assetFile]]))
  })

  it('loads, edits, saves, and reorders a 30-card project without reading inactive images', async () => {
    const document: FolderProjectDocument = {
      ...projectDocument(),
      activeCardId: 'card-18',
      cards: Array.from({ length: 30 }, (_, index) => {
        const sequence = index + 1
        return {
          id: `card-${sequence}`,
          imagePath: `images/card-${sequence}.png`,
          imageName: `card-${String(sequence).padStart(2, '0')}.png`,
          imageWidth: 744,
          imageHeight: 1039,
          regions: [],
          printArea: null,
          sourceDpi: null,
        }
      }),
    }
    const projectFile = new File(
      [JSON.stringify(document)],
      'project.json',
      { type: 'application/json' },
    )
    const activeImage = new File(['active'], 'card-18.png', {
      type: 'image/png',
    })
    const imageReads: string[] = []
    const writes = new Map<string, Blob | string>()
    const directory = {
      name: 'Thirty Cards',
      getFileHandle: vi.fn(async (name: string) => ({
        getFile: vi.fn().mockResolvedValue(projectFile),
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn((contents: Blob | string) => writes.set(name, contents)),
          close: vi.fn(),
          abort: vi.fn(),
        }),
      })),
      getDirectoryHandle: vi.fn(async (name: string) => {
        expect(name).toBe('images')
        return {
          getFileHandle: vi.fn(async (fileName: string) => {
            imageReads.push(fileName)
            return { getFile: vi.fn().mockResolvedValue(activeImage) }
          }),
        }
      }),
    } as unknown as FileSystemDirectoryHandle

    const opened = await openFolderProject(directory)
    expect(opened.document.cards).toHaveLength(30)
    expect(opened.card.id).toBe('card-18')
    expect(opened.imageFile).toBe(activeImage)
    expect(imageReads).toEqual(['card-18.png'])

    const saved = await saveFolderProject(
      directory,
      opened.document,
      {
        imageName: 'edited-card-18.png',
        imageWidth: 744,
        imageHeight: 1039,
        regions: [],
      },
      [],
      [],
      [],
      new Map(),
    )
    expect(saved.cards).toHaveLength(30)
    expect(saved.cards[17]!.imageName).toBe('edited-card-18.png')
    expect(JSON.parse(writes.get('project.json') as string).cards).toHaveLength(30)

    const reordered = moveProjectCard(saved, 'card-30', -1)
    expect(reordered.cards.at(-2)?.id).toBe('card-30')
    expect(reordered.activeCardId).toBe('card-18')
  })

  it.each([false, true])('writes pending assets before committing added cards (asset failure: %s)', async (failAsset) => {
    const document = projectDocument()
    document.assets = [{ id: 'asset', name: 'icon', sourceImageId: 'card-1', sourceRect: { x: 0, y: 0, width: 10, height: 10 }, imagePath: 'assets/asset.png', scale: 1, baselineOffset: 0, inlinePadding: 0 }]
    const previousJson = JSON.stringify({ ...document, assets: [] })
    const files = new Map<string, Blob | string>([['project.json', previousJson]])
    const order: string[] = []
    function directory(prefix = ''): FileSystemDirectoryHandle {
      return {
        async getDirectoryHandle(name: string) { return directory(`${prefix}${name}/`) },
        async getFileHandle(name: string) {
          const path = prefix + name
          return {
            async getFile() { return new File([files.get(path) ?? ''], name) },
            async createWritable() {
              return {
                async write(value: Blob | string) {
                  if (failAsset && path.startsWith('assets/'))
                    throw new Error('asset write failed')
                  order.push(path)
                  files.set(path, value)
                },
                async close() {},
                async abort() {},
              }
            },
          }
        },
      } as unknown as FileSystemDirectoryHandle
    }
    const blob = new Blob(['asset'])
    const result = addFolderProjectCards(directory(), document, [{
      id: 'card-3',
      file: new File(['image'], 'third.png', { type: 'image/png' }),
      imageWidth: 100,
      imageHeight: 140,
    }], new Map([['asset', blob]]))
    if (failAsset) {
      await expect(result).rejects.toThrow('asset write failed')
      expect(files.get('project.json')).toBe(previousJson)
    }
    else {
      const saved = await result
      const path = saved.assets[0]!.imagePath
      expect(files.get(path)).toBe(blob)
      expect(order.indexOf(path)).toBeLessThan(order.indexOf('project.json'))
      expect(JSON.parse(files.get('project.json') as string).cards).toHaveLength(3)
    }
  })

  it('writes added images and appends their card metadata', async () => {
    const writes: unknown[] = []
    const writable = () => ({
      write: vi.fn((value: unknown) => writes.push(value)),
      close: vi.fn(),
    })
    const imageGetFileHandle = vi.fn().mockImplementation(async () => ({
      createWritable: vi.fn().mockResolvedValue(writable()),
    }))
    const rootGetFileHandle = vi.fn().mockImplementation(async () => ({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(projectDocument())),
      }),
      createWritable: vi.fn().mockResolvedValue(writable()),
    }))
    const directory = {
      getDirectoryHandle: vi.fn().mockResolvedValue({
        getFileHandle: imageGetFileHandle,
      }),
      getFileHandle: rootGetFileHandle,
    } as unknown as FileSystemDirectoryHandle
    const file = new File(['image'], 'new-card.png', { type: 'image/png' })

    const updated = await addFolderProjectCards(
      directory,
      projectDocument(),
      [{ id: 'card-3', file, imageWidth: 300, imageHeight: 400 }],
    )

    expect(updated.cards.at(-1)).toMatchObject({
      id: 'card-3',
      imagePath: 'images/card-3.png',
      imageName: 'new-card.png',
      imageWidth: 300,
      imageHeight: 400,
      regions: [],
    })
    expect(imageGetFileHandle).toHaveBeenCalledWith('card-3.png', {
      create: true,
    })
    expect(writes).toContain(file)
  })

  it('removes only the requested card image files', async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined)
    const getDirectoryHandle = vi.fn().mockResolvedValue({ removeEntry })
    const directory = {
      getDirectoryHandle,
    } as unknown as FileSystemDirectoryHandle

    await removeFolderProjectCardImages(directory, [
      projectDocument().cards[1]!,
    ])

    expect(getDirectoryHandle).toHaveBeenCalledWith('images')
    expect(removeEntry).toHaveBeenCalledWith('card-2.png')
    expect(getDirectoryHandle).toHaveBeenCalledWith('thumbnails')
    expect(removeEntry).toHaveBeenCalledWith('card-2.jpg')
  })

  it('updates the project document before deleting card image files', async () => {
    const events: string[] = []
    const document = projectDocument()
    const deletedCard = document.cards[1]!
    document.cards = [document.cards[0]!]
    const getFileHandle = vi.fn().mockImplementation(async (name: string) => ({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(document)),
      }),
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn(() => events.push(`write:${name}`)),
        close: vi.fn(),
      }),
    }))
    const directory = {
      getFileHandle,
      getDirectoryHandle: vi.fn().mockResolvedValue({
        removeEntry: vi.fn((name: string) => events.push(`remove:${name}`)),
      }),
    } as unknown as FileSystemDirectoryHandle

    await saveFolderProject(
      directory,
      document,
      document.cards[0]!,
      [],
      [],
      [],
      new Map(),
      [deletedCard],
    )

    expect(events.indexOf('write:project.json')).toBeLessThan(
      events.indexOf('remove:card-2.png'),
    )
  })

  it('updates the project document before deleting asset files', async () => {
    const events: string[] = []
    const document = projectDocument()
    document.assets = [{
      id: 'coin',
      name: 'coin',
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: 'assets/coin.png',
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }]
    const getFileHandle = vi.fn().mockImplementation(async (name: string) => ({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(document)),
      }),
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn(() => events.push(`write:${name}`)),
        close: vi.fn(),
      }),
    }))
    const directory = {
      getFileHandle,
      getDirectoryHandle: vi.fn().mockResolvedValue({
        removeEntry: vi.fn((name: string) => events.push(`remove:${name}`)),
      }),
    } as unknown as FileSystemDirectoryHandle

    await saveFolderProject(
      directory,
      document,
      document.cards[0]!,
      [],
      [],
      [],
      new Map(),
    )

    expect(events.indexOf('write:project.json')).toBeLessThan(
      events.indexOf('remove:coin.png'),
    )
  })

  it('keeps removed asset files when writing the project document fails', async () => {
    const document = projectDocument()
    document.assets = [{
      id: 'coin',
      name: 'coin',
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: 'assets/coin.png',
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }]
    const removeEntry = vi.fn()
    const getFileHandle = vi.fn().mockImplementation(async (name: string) => ({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(document)),
      }),
      createWritable: vi.fn().mockResolvedValue({
        write: name === 'project.json'
          ? vi.fn().mockRejectedValue(new Error('disk full'))
          : vi.fn(),
        close: vi.fn(),
        abort: vi.fn(),
      }),
    }))
    const directory = {
      getFileHandle,
      getDirectoryHandle: vi.fn().mockResolvedValue({ removeEntry }),
    } as unknown as FileSystemDirectoryHandle

    await expect(saveFolderProject(
      directory,
      document,
      document.cards[0]!,
      [],
      [],
      [],
      new Map(),
    )).rejects.toThrow('disk full')

    expect(removeEntry).not.toHaveBeenCalled()
  })

  it('backs up the previous document and saves the active card edits', async () => {
    const writes = new Map<string, Blob | string>()
    const previous = JSON.stringify(projectDocument())
    const document = projectDocument()
    document.glossary = [{
      id: 'draw',
      source: 'Draw',
      translation: '引く',
      note: '',
    }]
    const editedCard = {
      ...document.cards[0]!,
      imageName: 'edited.png',
      regions: [
        {
          id: 'effect',
          originalText: 'Draw a card.',
          translatedText: 'カードを1枚引く。',
        },
      ] as never,
    }
    const getFileHandle = vi.fn(async (name: string) => ({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(previous),
      }),
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn((contents: Blob | string) => writes.set(name, contents)),
        close: vi.fn(),
        abort: vi.fn(),
      }),
    }))
    const directory = {
      getFileHandle,
    } as unknown as FileSystemDirectoryHandle

    const saved = await saveFolderProject(
      directory,
      document,
      editedCard,
      [],
      [],
      [],
      new Map(),
    )

    expect(writes.get('project.backup.json')).toBe(previous)
    expect(saved.cards[0]).toMatchObject({
      id: 'card-1',
      imagePath: 'images/card-1.png',
      imageName: 'edited.png',
    })
    expect(saved.cards[0]!.regions[0]).toMatchObject({
      originalText: 'Draw a card.',
      translatedText: 'カードを1枚引く。',
    })
    expect(
      JSON.parse(writes.get('project.json') as string).cards[0].regions[0],
    ).toMatchObject({ translatedText: 'カードを1枚引く。' })
    expect(JSON.parse(writes.get('project.json') as string).glossary).toEqual(
      document.glossary,
    )
  })
})

describe('asset save transactions', () => {
  function fixture(failure?: string) {
    const document = projectDocument()
    document.assets = [{
      id: 'coin',
      name: 'coin',
      sourceImageId: 'card-1',
      sourceRect: { x: 0, y: 0, width: 10, height: 10 },
      imagePath: 'assets/coin.png',
      scale: 1,
      baselineOffset: 0,
      inlinePadding: 0,
    }]
    const files = new Map<string, Blob | string>([
      ['project.json', JSON.stringify(document)],
      ['assets/coin.png', new Blob(['original'])],
    ])
    const directory = (prefix = ''): FileSystemDirectoryHandle => ({
      getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
      removeEntry: async (name: string) => { files.delete(`${prefix}${name}`) },
      getFileHandle: async (name: string) => {
        const path = `${prefix}${name}`
        return {
          getFile: async () => new File([files.get(path)!], name),
          createWritable: async () => {
            let pending: Blob | string
            return {
              write: async (value: Blob | string) => { pending = value },
              close: async () => {
                if (path === failure)
                  throw new Error('disk full')
                files.set(path, pending)
              },
              abort: async () => {},
            }
          },
        }
      },
    } as unknown as FileSystemDirectoryHandle)
    return { document, files, directory: directory() }
  }

  it.each(['project.backup.json', 'project.json'])('preserves saved images when %s fails', async (failure) => {
    const { document, files, directory } = fixture(failure)
    const previous = files.get('project.json')
    const original = files.get('assets/coin.png')
    await expect(saveFolderProject(directory, document, document.cards[0]!, document.assets, [], [], new Map([['coin', new Blob(['recropped'])]]))).rejects.toThrow('disk full')
    expect(files.get('project.json')).toBe(previous)
    expect(files.get('assets/coin.png')).toBe(original)
    expect([...files.keys()].filter(path => path.startsWith('assets/'))).toEqual(['assets/coin.png'])
  })

  it('also preserves recropped images when adding cards fails to commit', async () => {
    const { document, files, directory } = fixture('project.json')
    const previous = files.get('project.json')
    const original = files.get('assets/coin.png')
    await expect(addFolderProjectCards(directory, document, [{
      id: 'card-3',
      file: new File(['image'], 'third.png', { type: 'image/png' }),
      imageWidth: 100,
      imageHeight: 140,
    }], new Map([['coin', new Blob(['recropped'])]]))).rejects.toThrow('disk full')
    expect(files.get('project.json')).toBe(previous)
    expect(files.get('assets/coin.png')).toBe(original)
  })

  it('commits a new asset path and cleans up the replaced image', async () => {
    const { document, files, directory } = fixture()
    const saved = await saveFolderProject(directory, document, document.cards[0]!, document.assets, [], [], new Map([['coin', new Blob(['recropped'])]]))
    const path = saved.assets[0]!.imagePath
    expect(path).not.toBe('assets/coin.png')
    expect(await (files.get(path) as Blob).text()).toBe('recropped')
    expect(JSON.parse(files.get('project.json') as string).assets[0].imagePath).toBe(path)
    expect(files.has('assets/coin.png')).toBe(false)
    expect(document.assets[0]!.imagePath).toBe('assets/coin.png')
  })

  it('uses persisted assets for deletion even after the editor removes the definition', async () => {
    const { document, files, directory } = fixture()
    document.assets = []
    await saveFolderProject(directory, document, document.cards[0]!, [], [], [], new Map())
    expect(files.has('assets/coin.png')).toBe(false)
    expect(JSON.parse(files.get('project.json') as string).assets).toEqual([])
  })
})
