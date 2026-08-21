import { describe, expect, test } from 'vitest'
import {
  basenameOf,
  commonAncestorPath,
  foldSegment,
  foldSegments,
  folderHint,
  type HintTrack,
  locationSegments,
  locationToPath,
} from '../src/core/location'

describe('locationToPath', () => {
  test('strips the file://localhost scheme Rekordbox writes', () => {
    expect(locationToPath('file://localhost/Users/m/Music/Track.mp3')).toBe(
      '/Users/m/Music/Track.mp3',
    )
  })

  test('strips a bare file:// scheme', () => {
    expect(locationToPath('file:///Users/m/Music/Track.mp3')).toBe('/Users/m/Music/Track.mp3')
  })

  test('percent-decodes escaped characters', () => {
    expect(locationToPath('file://localhost/Users/m/Some%20Track%20%232.mp3')).toBe(
      '/Users/m/Some Track #2.mp3',
    )
  })

  test('keeps the raw path when the percent-encoding is malformed', () => {
    expect(locationToPath('file://localhost/Users/m/100%.mp3')).toBe('/Users/m/100%.mp3')
  })

  test('leaves a path that has no scheme alone', () => {
    expect(locationToPath('/Volumes/DJ/Track.mp3')).toBe('/Volumes/DJ/Track.mp3')
  })
})

describe('locationSegments', () => {
  test('splits a decoded path into segments', () => {
    expect(locationSegments('file://localhost/Users/m/Music/Track.mp3')).toEqual([
      'Users',
      'm',
      'Music',
      'Track.mp3',
    ])
  })

  test('drops empty segments from doubled or trailing slashes', () => {
    expect(locationSegments('file:///Users//m/Music/')).toEqual(['Users', 'm', 'Music'])
  })

  test('keeps a Windows drive letter as an inert segment', () => {
    expect(locationSegments('file:///C:/Users/m/Track.mp3')).toEqual([
      'C:',
      'Users',
      'm',
      'Track.mp3',
    ])
  })
})

describe('foldSegment', () => {
  test('folds case', () => {
    expect(foldSegment('Track.MP3')).toBe('track.mp3')
  })

  test('folds NFD and NFC spellings of the same name together', () => {
    // macOS hands filenames to the File API in NFD; Rekordbox XML carries NFC.
    const nfc = 'Jóga.mp3'.normalize('NFC')
    const nfd = 'Jóga.mp3'.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    expect(foldSegment(nfd)).toBe(foldSegment(nfc))
  })

  test('does not strip punctuation or whitespace', () => {
    expect(foldSegment('A  B - C.mp3')).toBe('a  b - c.mp3')
  })
})

describe('foldSegments', () => {
  test('folds every segment', () => {
    expect(foldSegments(['Music', 'Björk'.normalize('NFD')])).toEqual([
      'music',
      'björk'.normalize('NFC'),
    ])
  })
})

describe('basenameOf', () => {
  test('returns the folded final segment', () => {
    expect(basenameOf('file://localhost/Users/m/Music/Some%20Track.MP3')).toBe('some track.mp3')
  })

  test('returns an empty string for a location with no segments', () => {
    expect(basenameOf('file:///')).toBe('')
  })
})

describe('commonAncestorPath', () => {
  const at = (path: string) => `file://localhost${path}`

  test('is null with nothing to go on', () => {
    expect(commonAncestorPath([])).toBe(null)
    expect(commonAncestorPath([null, ''])).toBe(null)
  })

  test('a single track yields its own folder', () => {
    expect(commonAncestorPath([at('/Users/mich/Music/DJ/House/Track.mp3')])).toBe(
      '/Users/mich/Music/DJ/House',
    )
  })

  test('several tracks yield the deepest folder they share', () => {
    expect(
      commonAncestorPath([
        at('/Users/mich/Music/DJ/House/A.mp3'),
        at('/Users/mich/Music/DJ/House/B.mp3'),
        at('/Users/mich/Music/DJ/Techno/C.mp3'),
      ]),
    ).toBe('/Users/mich/Music/DJ')
  })

  test('a library spread across volumes has no useful ancestor', () => {
    expect(commonAncestorPath([at('/Users/mich/Music/A.mp3'), at('/Volumes/DJ/Crate/B.mp3')])).toBe(
      null,
    )
  })

  test('a single shared segment is too shallow to be a hint', () => {
    expect(commonAncestorPath([at('/Users/mich/A.mp3'), at('/Users/other/B.mp3')])).toBe(null)
  })

  test('matches case-insensitively but shows the first spelling', () => {
    // The folder exists exactly once on disk; only the XML's casing varies.
    expect(commonAncestorPath([at('/Users/Mich/Music/A.mp3'), at('/users/mich/MUSIC/B.mp3')])).toBe(
      '/Users/Mich/Music',
    )
  })

  test('matches across NFD and NFC, as macOS and Rekordbox disagree', () => {
    const nfc = at('/Users/mich/Musique/Björk/A.mp3')
    const nfd = at('/Users/mich/Musique/Björk/B.mp3')
    expect(commonAncestorPath([nfc, nfd])).toBe('/Users/mich/Musique/Björk')
  })

  test('decodes percent-escapes so the path is pasteable', () => {
    expect(
      commonAncestorPath([at('/Users/mich/My%20Music/A.mp3'), at('/Users/mich/My%20Music/B.mp3')]),
    ).toBe('/Users/mich/My Music')
  })

  test('renders a Windows drive the way a Windows dialog wants it', () => {
    expect(
      commonAncestorPath(['file:///C:/Users/dj/Music/A.mp3', 'file:///C:/Users/dj/Music/B.mp3']),
    ).toBe('C:\\Users\\dj\\Music')
  })

  test('ignores a location that is nothing but a file name', () => {
    expect(
      commonAncestorPath([
        'Track.mp3',
        at('/Users/mich/Music/A.mp3'),
        at('/Users/mich/Music/B.mp3'),
      ]),
    ).toBe('/Users/mich/Music')
  })
})

describe('folderHint', () => {
  const at = (title: string, location: string | null, artist: string | null = null): HintTrack => ({
    title,
    artist,
    location,
  })

  test('names a real track, its path and the folder that path sits in', () => {
    const hint = folderHint([
      at('Nightmares', 'file://localhost/Users/mr/Music/House/2019/Nightmares.mp3', 'Dusky'),
      at('Aeon', 'file://localhost/Users/mr/Music/Techno/Aeon.aiff'),
    ])
    expect(hint.example).toEqual({
      label: 'Dusky — Nightmares',
      path: '/Users/mr/Music/House/2019/Nightmares.mp3',
      folder: '/Users/mr/Music/House/2019',
    })
    expect(hint.suggested).toBe('/Users/mr/Music')
    expect(hint.scattered).toBe(false)
  })

  test('falls back to the bare title when there is no artist', () => {
    const hint = folderHint([at('Aeon', 'file://localhost/Users/mr/Music/Techno/Aeon.aiff')])
    expect(hint.example?.label).toBe('Aeon')
  })

  test('reports scattered when one outlier collapses the shared ancestor', () => {
    // The exact case commonAncestorPath refuses to answer: one track on
    // another volume leaves no shared prefix at all. The example still says
    // something useful, which is the point of having one.
    const hint = folderHint([
      at('Nightmares', 'file://localhost/Users/mr/Music/House/Nightmares.mp3'),
      at('Stray', 'file://localhost/Volumes/Backup/Stray.mp3'),
    ])
    expect(hint.suggested).toBe(null)
    expect(hint.scattered).toBe(true)
    expect(hint.example?.folder).toBe('/Users/mr/Music/House')
  })

  test('skips tracks with no location when choosing the example', () => {
    const hint = folderHint([
      at('No path', null),
      at('Empty path', ''),
      at('Real', 'file://localhost/Users/mr/Music/House/Real.mp3'),
    ])
    expect(hint.example?.label).toBe('Real')
  })

  test('has no example at all when nothing in the library has a path', () => {
    const hint = folderHint([at('One', null), at('Two', null)])
    expect(hint).toEqual({ example: null, suggested: null, scattered: false })
  })

  test('keeps a Windows path in the form a Windows dialog accepts', () => {
    const hint = folderHint([at('Track', 'file:///C:/Users/mr/Music/House/Track.mp3')])
    expect(hint.example?.path).toBe('C:\\Users\\mr\\Music\\House\\Track.mp3')
    expect(hint.example?.folder).toBe('C:\\Users\\mr\\Music\\House')
  })

  test('percent-encoded paths are decoded for display', () => {
    const hint = folderHint([at('Track', 'file://localhost/Users/mr/Music/Deep%20House/T.mp3')])
    expect(hint.example?.folder).toBe('/Users/mr/Music/Deep House')
  })
})
