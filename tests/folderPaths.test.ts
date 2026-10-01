import { describe, expect, test } from 'vitest'
import {
  createPathResolver,
  type Directory,
  routesUnder,
  shouldWalk,
} from '../src/core/audio/folderPaths'
import { matchLocation } from '../src/core/audio/pathMatch'

/**
 * A granted folder holding `files` (paths relative to it). File handles are the
 * relative paths themselves, so a hit is easy to read. Every lookup is recorded.
 */
function fakeFolder(files: string[]) {
  const dirCalls: string[] = []
  const fileCalls: string[] = []
  const folder = (prefix: string): Directory<string> => ({
    getDirectoryHandle(name) {
      const path = `${prefix}${name}/`
      dirCalls.push(path)
      return files.some((f) => f.startsWith(path))
        ? Promise.resolve(folder(path))
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
    getFileHandle(name) {
      const path = `${prefix}${name}`
      fileCalls.push(path)
      return files.includes(path)
        ? Promise.resolve(path)
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
  })
  return { root: folder(''), dirCalls, fileCalls }
}

const loc = (path: string) => `file://localhost${encodeURI(path)}`

describe('routesUnder', () => {
  test('the route after the granted folder name', () => {
    expect(routesUnder('Music', loc('/Volumes/SD 1TB/Music/House/x.mp3'))).toEqual([
      ['House', 'x.mp3'],
    ])
  })

  test('one route per occurrence of the name, deepest first', () => {
    expect(routesUnder('Music', loc('/Volumes/Music/Music/x.mp3'))).toEqual([
      ['x.mp3'],
      ['Music', 'x.mp3'],
    ])
  })

  test('no route when the name is absent, or only names the file', () => {
    expect(routesUnder('Music', loc('/Users/dj/Tunes/x.mp3'))).toEqual([])
    expect(routesUnder('Music', loc('/Users/dj/Music'))).toEqual([])
  })

  test('the folder name compares case- and accent-form-insensitively', () => {
    const nfd = 'Électro'.normalize('NFD')
    expect(routesUnder(nfd, loc('/Volumes/SD/électro/x.mp3'))).toEqual([['x.mp3']])
  })

  test('a Windows drive location', () => {
    expect(routesUnder('Music', 'file://localhost/C:/Users/dj/Music/x.mp3')).toEqual([['x.mp3']])
  })
})

describe('shouldWalk', () => {
  test('walks when fewer than half were found, or nothing was asked', () => {
    expect(shouldWalk(0, 0)).toBe(true)
    expect(shouldWalk(0, 10)).toBe(true)
    expect(shouldWalk(4, 10)).toBe(true)
    expect(shouldWalk(5, 10)).toBe(false)
    expect(shouldWalk(10, 10)).toBe(false)
  })
})

describe('createPathResolver', () => {
  const library = [
    loc('/Volumes/SD 1TB/Music/House/a.mp3'),
    loc('/Volumes/SD 1TB/Music/House/b.mp3'),
    loc('/Volumes/SD 1TB/Music/House/c.mp3'),
  ]

  test('finds each track along its path and builds a matching index', async () => {
    const { root } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    const { index, found } = await createPathResolver(root, 'Music').lookUp(library)
    expect(found).toBe(3)
    const hit = matchLocation(index, library[1])
    expect(hit.kind === 'hit' ? hit.entry.handle : hit.kind).toBe('House/b.mp3')
  })

  test('a folder shared by many tracks is looked up once', async () => {
    const { root, dirCalls } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    await createPathResolver(root, 'Music').lookUp(library)
    expect(dirCalls.filter((p) => p === 'House/')).toHaveLength(1)
  })

  test('a later call looks up only locations it has not tried', async () => {
    const { root, fileCalls } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3', 'd.mp3'])
    const resolver = createPathResolver(root, 'Music')
    await resolver.lookUp(library)
    const before = fileCalls.length
    const more = [...library, loc('/Volumes/SD 1TB/Music/d.mp3')]
    const { found, index } = await resolver.lookUp(more)
    expect(fileCalls.length - before).toBe(1)
    expect(found).toBe(4)
    expect(index.size).toBe(4)
  })

  test('a missing file is a miss, not an error', async () => {
    const { root } = fakeFolder(['House/a.mp3'])
    const { found, index } = await createPathResolver(root, 'Music').lookUp(library)
    expect(found).toBe(1)
    expect(matchLocation(index, library[2]).kind).toBe('miss')
  })

  test('every occurrence of the folder name is tried', async () => {
    const { root } = fakeFolder(['Music/x.mp3'])
    const { found } = await createPathResolver(root, 'Music').lookUp([
      loc('/Volumes/Music/Music/x.mp3'),
    ])
    expect(found).toBe(1)
  })

  test('with a file at two depths, the deeper path match wins, as after a walk', async () => {
    const { root } = fakeFolder(['x.mp3', 'Music/x.mp3'])
    const location = loc('/Volumes/Music/Music/x.mp3')
    const { index } = await createPathResolver(root, 'Music').lookUp([location])
    const hit = matchLocation(index, location)
    expect(hit.kind === 'hit' ? hit.entry.handle : hit.kind).toBe('Music/x.mp3')
  })

  test('two locations reaching one file stay one entry', async () => {
    const { root } = fakeFolder(['x.mp3'])
    const twins = [loc('/Users/dj/Music/x.mp3'), loc('/Volumes/SD/Music/x.mp3')]
    const { index, found } = await createPathResolver(root, 'Music').lookUp(twins)
    expect(found).toBe(2)
    expect(index.size).toBe(1)
    expect(twins.map((l) => matchLocation(index, l).kind)).toEqual(['hit', 'hit'])
  })

  test('reports progress and finishes at the total', async () => {
    const { root } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    const seen: [number, number][] = []
    await createPathResolver(root, 'Music').lookUp(library, (done, total) =>
      seen.push([done, total]),
    )
    expect(seen.at(-1)).toEqual([3, 3])
  })
})
