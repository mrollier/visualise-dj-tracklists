import { describe, expect, test } from 'vitest'
import { NOT_IN_PLAYLIST } from '../src/core/filter'
import { importM3u } from '../src/core/importers/m3u'
import { diffLibraries, importDecision, remapWork } from '../src/core/libraryUpdate'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'
import { freshFirstSet, type TrackSet } from '../src/core/sets'
import { track } from './helpers'

const rb = (n: number, patch: Partial<Track> = {}): Track =>
  track({
    id: `rb-${n}`,
    title: `Title ${n}`,
    artist: `Artist ${n}`,
    location: `file://localhost/Music/${n}.mp3`,
    key: '8A',
    bpm: 128,
    ...patch,
  })

const bare = (id: string, patch: Partial<Track>): Track => ({
  ...EMPTY_TRACK_FIELDS,
  id,
  title: id,
  ...patch,
})

describe('diffLibraries', () => {
  test('a re-export of the same collection matches every track by id', () => {
    const old = [rb(1), rb(2), rb(3)]
    const diff = diffLibraries(old, [rb(1), rb(2), rb(3)])
    expect([...diff.idMap]).toEqual([
      ['rb-1', 'rb-1'],
      ['rb-2', 'rb-2'],
      ['rb-3', 'rb-3'],
    ])
    expect(diff.matchedById).toBe(3)
    expect(diff.added).toEqual([])
    expect(diff.gone).toEqual([])
    expect(diff.overlap).toBe(1)
  })

  test('new and removed tracks are reported', () => {
    const diff = diffLibraries([rb(1), rb(2)], [rb(1), rb(3)])
    expect(diff.added.map((t) => t.id)).toEqual(['rb-3'])
    expect(diff.gone.map((t) => t.id)).toEqual(['rb-2'])
    expect(diff.overlap).toBe(0.5)
  })

  test('a colliding TrackID from another collection is not a match', () => {
    // Rekordbox TrackIDs are small integers: rb-1 exists in every collection.
    const other = rb(1, {
      title: 'Something Else',
      artist: 'Else',
      location: 'file://localhost/x.mp3',
    })
    const diff = diffLibraries([rb(1)], [other])
    expect(diff.idMap.size).toBe(0)
    expect(diff.overlap).toBe(0)
  })

  test('renumbered ids (a converted database) still match by file location', () => {
    const diff = diffLibraries([rb(1)], [rb(1, { id: 'rb-900' })])
    expect(diff.idMap.get('rb-1')).toBe('rb-900')
    expect(diff.matchedById).toBe(0)
    expect(diff.matchedByLocation).toBe(1)
  })

  test('a moved file still matches by id when artist and title agree', () => {
    const diff = diffLibraries([rb(1)], [rb(1, { location: 'file://localhost/New/1.mp3' })])
    expect(diff.idMap.get('rb-1')).toBe('rb-1')
  })

  test('changed key or BPM is reported per track', () => {
    const diff = diffLibraries([rb(1), rb(2)], [rb(1, { key: '9A' }), rb(2)])
    expect(diff.changed).toEqual([{ id: 'rb-1', title: 'Title 1', fields: ['key'] }])
  })

  test('two old tracks never map onto the same new one', () => {
    const dupe = rb(2, {
      location: 'file://localhost/Music/1.mp3',
      title: 'Title 1',
      artist: 'Artist 1',
    })
    const diff = diffLibraries([rb(1), dupe], [rb(1)])
    expect(diff.idMap.size).toBe(1)
    expect(diff.gone.map((t) => t.id)).toEqual(['rb-2'])
  })

  test('bare M3U placeholders pick up the collection track by basename or artist/title', () => {
    const byFile = bare('m3u-0-1.mp3', { location: '/old/laptop/1.mp3' })
    const byName = bare('m3u-1-x.mp3', { title: 'Title 2', artist: 'artist 2', location: '/x.mp3' })
    const diff = diffLibraries([byFile, byName], [rb(1), rb(2)])
    expect(diff.idMap.get('m3u-0-1.mp3')).toBe('rb-1')
    expect(diff.idMap.get('m3u-1-x.mp3')).toBe('rb-2')
    // A library of placeholders has nothing of its own to lose.
    expect(diff.overlap).toBe(1)
  })
})

describe('remapWork', () => {
  const set = (patch: Partial<TrackSet>): TrackSet => ({ ...freshFirstSet(), ...patch })

  test('sets keep their ids and names; tracks, marks and pins follow the id map', () => {
    const diff = diffLibraries([rb(1), rb(2), rb(3)], [rb(1, { id: 'rb-11' }), rb(2)])
    const work = remapWork(
      {
        sets: [
          set({
            id: 's',
            name: 'Friday',
            trackIds: ['rb-1', 'rb-3', 'rb-2'],
            mustInclude: ['rb-1', 'rb-3'],
            pinnedFirst: 'rb-1',
            pinnedLast: 'rb-3',
          }),
        ],
        manualEdges: [
          { a: 'rb-1', b: 'rb-2' },
          { a: 'rb-2', b: 'rb-3' },
        ],
        selectedId: 'rb-1',
        playlistSelection: null,
      },
      diff,
      [],
    )
    expect(work.sets[0]).toMatchObject({
      id: 's',
      name: 'Friday',
      trackIds: ['rb-11', 'rb-2'],
      mustInclude: ['rb-11'],
      pinnedFirst: 'rb-11',
      pinnedLast: null,
    })
    expect(work.manualEdges).toEqual([{ a: 'rb-11', b: 'rb-2' }])
    expect(work.selectedId).toBe('rb-11')
    expect(work.lost).toEqual({ slots: 1, marks: 2, manualEdges: 1, titles: ['Title 3'] })
  })

  test('a gone track between two copies of one track collapses the repeat', () => {
    const diff = diffLibraries([rb(1), rb(2)], [rb(1)])
    const work = remapWork(
      {
        sets: [set({ trackIds: ['rb-1', 'rb-2', 'rb-1'] })],
        manualEdges: [],
        selectedId: null,
        playlistSelection: null,
      },
      diff,
      [],
    )
    expect(work.sets[0].trackIds).toEqual(['rb-1'])
  })

  test('the playlist selection keeps the names the new collection still has', () => {
    const diff = diffLibraries([rb(1)], [rb(1)])
    const base = { sets: [set({})], manualEdges: [], selectedId: null }
    const incoming = [{ name: 'Warmup', trackIds: ['rb-1'] }]
    expect(
      remapWork({ ...base, playlistSelection: ['Warmup', 'Gone', NOT_IN_PLAYLIST] }, diff, incoming)
        .playlistSelection,
    ).toEqual(['Warmup', NOT_IN_PLAYLIST])
    expect(remapWork({ ...base, playlistSelection: null }, diff, incoming).playlistSelection).toBe(
      null,
    )
    expect(remapWork({ ...base, playlistSelection: ['Warmup'] }, diff, []).playlistSelection).toBe(
      null,
    )
  })

  test('an unmatched placeholder a set still uses is carried into the new library', () => {
    const obscure = bare('m3u-0-obscure.mp3', { title: 'Obscure Dub', location: '/obscure.mp3' })
    const unused = bare('m3u-1-unused.mp3', { title: 'Unused', location: '/unused.mp3' })
    const diff = diffLibraries([obscure, unused], [rb(1)])
    const work = remapWork(
      {
        sets: [set({ trackIds: ['m3u-0-obscure.mp3'] })],
        manualEdges: [],
        selectedId: null,
        playlistSelection: null,
      },
      diff,
      [],
    )
    expect(work.carried).toEqual([obscure])
    expect(work.sets[0].trackIds).toEqual(['m3u-0-obscure.mp3'])
    expect(work.lost.slots).toBe(0)
  })
})

describe('importDecision', () => {
  const diff = (overlap: number) => ({ ...diffLibraries([], []), overlap })

  test('an empty or sample library is simply replaced', () => {
    expect(importDecision(true, diff(0), 0)).toBe('replace')
  })

  test('a collection sharing under half its tracks asks before replacing', () => {
    expect(importDecision(false, diff(0.3), 0)).toBe('confirm-replace')
  })

  test('an update that would drop work asks first', () => {
    expect(importDecision(false, diff(0.9), 2)).toBe('confirm-update')
  })

  test('an update that loses nothing just happens', () => {
    expect(importDecision(false, diff(0.9), 0)).toBe('update')
  })
})

describe('file-name matching stays with placeholders', () => {
  test('unrelated tracks that share a generic file name do not match', () => {
    const mine = rb(1, { location: 'file://localhost/Crate/01 Intro.mp3' })
    const theirs = rb(7, {
      title: 'Another Intro',
      artist: 'Someone',
      location: 'file://localhost/Other/01 Intro.mp3',
    })
    expect(diffLibraries([mine], [theirs]).idMap.size).toBe(0)
  })
})

describe('an M3U imported before its collection', () => {
  test('the collection import turns every placeholder into the real track, in order', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:334,Artist 2 - Title 2',
      '/Users/dj/Music/elsewhere/2.mp3',
      '#EXTINF:372,Artist 1 - Title 1',
      '/Users/dj/Music/1.mp3',
    ].join('\n')
    const first = importM3u(m3u, [])
    expect(first.newTracks).toHaveLength(2)
    const collection = [rb(1), rb(2), rb(3)]
    const diff = diffLibraries(first.newTracks, collection)
    const work = remapWork(
      {
        sets: [{ ...freshFirstSet(), trackIds: first.tracklist }],
        manualEdges: [],
        selectedId: null,
        playlistSelection: null,
      },
      diff,
      [],
    )
    expect(work.sets[0].trackIds).toEqual(['rb-2', 'rb-1'])
    expect(work.carried).toEqual([])
  })
})
