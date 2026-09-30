import { afterEach, describe, expect, test } from 'vitest'
import {
  computeGenreCoverage,
  learnGenreBridge,
  setGenreBridge,
  genreComponents,
  genreFamilyOf,
  genreSimilarity,
  sharedGenreAncestor,
  normalizeGenre,
  packNeighbours,
  UMBRELLA_GENRES,
} from '../src/core/genre'

describe('the Discogs400 widening of the curated tree', () => {
  test('curated pairs keep their specific shared ancestor', () => {
    expect(sharedGenreAncestor('Deep House', 'Tech House')).toBe('house')
    expect(sharedGenreAncestor('Jungle', 'Drum & Bass')).toBe('jungle')
  })

  test('a predicted style the curated tree lacks still gets a lineage, but no family', () => {
    expect(sharedGenreAncestor('Euro House', 'Deep Techno')).toBe('electronic')
    expect(genreFamilyOf('deep techno')).toBeNull()
  })

  test("Discogs' own spellings normalize onto the curated labels", () => {
    expect(normalizeGenre('Drum n Bass')).toBe('drum & bass')
    expect(normalizeGenre('Psy-Trance')).toBe('psytrance')
    expect(normalizeGenre('Synth-pop')).toBe('synthpop')
  })
})

describe('normalizeGenre', () => {
  test('lowercases, trims, and unifies separators', () => {
    expect(normalizeGenre('  Tech-House ')).toBe('tech house')
    expect(normalizeGenre('2-Step')).toBe('2 step')
  })

  test('resolves common aliases (Schreiber-style normalization)', () => {
    expect(normalizeGenre('DnB')).toBe('drum & bass')
    expect(normalizeGenre("Drum'n'Bass")).toBe('drum & bass')
    expect(normalizeGenre('Drum and Bass')).toBe('drum & bass')
    expect(normalizeGenre('D&B')).toBe('drum & bass')
    expect(normalizeGenre('RnB')).toBe('r&b')
    expect(normalizeGenre('Hip-Hop')).toBe('hip hop')
    expect(normalizeGenre('Psy Trance')).toBe('psytrance')
  })
})

describe('genreComponents', () => {
  test('plain labels stay whole', () => {
    expect(genreComponents('Deep House')).toEqual(['deep house'])
    // '&' is never a separator: these are atomic genre names.
    expect(genreComponents('Drum & Bass')).toEqual(['drum & bass'])
  })

  test('splits multi-genre fields on slashes and commas', () => {
    expect(genreComponents('House / Techno')).toEqual(['house', 'techno'])
    expect(genreComponents('Melodic House, Techno')).toEqual(['melodic house', 'techno'])
  })

  test('known compound labels resolve as aliases instead of splitting', () => {
    // "Organic House / Downtempo" is a Beatport category, not two genres.
    expect(genreComponents('Organic House / Downtempo')).toEqual(['organic house'])
  })

  test('memoised: repeated calls return the identical array (v37 perf)', () => {
    // The combo pair loop calls this twice per O(n²) pair — the cache is
    // what keeps a criteria change from re-splitting every raw label
    // millions of times.
    expect(genreComponents('House / Techno')).toBe(genreComponents('House / Techno'))
  })
})

describe('genreSimilarity: multi-genre fields', () => {
  test('takes the best component pair', () => {
    // "House / Techno" contains techno, so it must match Minimal Techno as
    // well as plain "Techno" does.
    const compound = genreSimilarity('House / Techno', 'Minimal Techno')
    const plain = genreSimilarity('Techno', 'Minimal Techno')
    expect(compound).toBe(plain)
    expect(genreSimilarity('House / Techno', 'Techno')).toBe(1)
  })
})

describe('packNeighbours', () => {
  test('returns nearby genres from the hybrid pack, skipping umbrella tags', () => {
    const neighbours = packNeighbours('Techno', 3)
    expect(neighbours.length).toBe(3)
    for (const [label, score] of neighbours) {
      expect(UMBRELLA_GENRES).not.toContain(label)
      expect(score).toBeGreaterThan(0)
    }
  })

  test('unknown labels yield nothing', () => {
    expect(packNeighbours('Zydeco Fusion Wave', 3)).toEqual([])
  })
})

describe('the curated tree: shared ancestors', () => {
  test('a parent–child pair shares the parent; cousins share their grandparent', () => {
    expect(sharedGenreAncestor('House', 'Deep House')).toBe('house')
    expect(sharedGenreAncestor('Liquid Drum & Bass', 'Neurofunk')).toBe('drum & bass')
  })

  test('multi-parent genres sit under every parent (DAG, not strict tree)', () => {
    expect(sharedGenreAncestor('Tech House', 'Techno')).toBe('techno')
    expect(sharedGenreAncestor('Tech House', 'House')).toBe('house')
  })

  test('is symmetric', () => {
    expect(sharedGenreAncestor('Dub', 'Dubstep')).toBe(sharedGenreAncestor('Dubstep', 'Dub'))
    expect(sharedGenreAncestor('Gabber', 'Deep House')).toBe(
      sharedGenreAncestor('Deep House', 'Gabber'),
    )
  })
})

describe('genreSimilarity (embedding retrofitted toward the curated tree)', () => {
  test('covers curated club genres the tagging data never saw', () => {
    // Neither label exists in the AcousticBrainz vocabulary; the retrofit
    // gives them vectors from their tree neighbourhood (drum & bass).
    expect(genreSimilarity('Liquid Drum & Bass', 'Neurofunk')).toBeGreaterThan(0.3)
    expect(genreSimilarity('Melodic Techno', 'Techno')).toBeGreaterThan(0.3)
  })

  test('keeps the embedding’s real-world associations', () => {
    expect(genreSimilarity('Techno', 'Tech House')).toBeGreaterThan(0.5)
    expect(genreSimilarity('Disco', 'Funk')).toBeGreaterThan(
      genreSimilarity('Disco', 'Death Metal'),
    )
  })

  test('labels unknown to pack and tree fall back to lexical', () => {
    expect(genreSimilarity('Warehouse House', 'House')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno')).toBe(0)
  })
})

describe('genreSimilarity: the pack', () => {
  test('near neighbours in the pack score higher than distant genres', () => {
    const near = genreSimilarity('House', 'Deep House')
    const far = genreSimilarity('House', 'Gabber')
    expect(near).toBeGreaterThan(far)
  })

  test('same genre is 1 and unknown labels fall back to lexical', () => {
    expect(genreSimilarity('Techno', 'techno')).toBe(1)
    // "warehouse house" is no real pack label; token overlap carries it.
    expect(genreSimilarity('Warehouse House', 'House')).toBeGreaterThan(0)
  })

  test('known labels that are not neighbours score 0, not lexical', () => {
    // Both are pack labels sharing the token "hard", but unrelated music:
    // the pack must answer 0 instead of falling back to word overlap.
    expect(genreSimilarity('Hard Rock', 'Hard Trance')).toBe(0)
  })

  test('umbrella labels are damped and cannot act as hubs', () => {
    const umbrella = genreSimilarity('House', 'Electronic')
    expect(umbrella).toBeLessThanOrEqual(0.5)
    expect(genreSimilarity('House', 'Deep House')).toBeGreaterThan(umbrella)
  })

  test('stays within [0, 1]', () => {
    for (const pair of [
      ['Techno', 'Minimal Techno'],
      ['Trance', 'Jazz'],
      ['Dubstep', 'Riddim'],
    ] as const) {
      const s = genreSimilarity(pair[0], pair[1])
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  test('the real AcousticBrainz pack orders relatedness sensibly', () => {
    const techHouse = genreSimilarity('Techno', 'Tech House')
    const house = genreSimilarity('Techno', 'House')
    const folk = genreSimilarity('Techno', 'Folk')
    expect(techHouse).toBeGreaterThan(house)
    expect(house).toBeGreaterThan(folk)
    expect(genreSimilarity('Trance', 'Progressive Trance')).toBeGreaterThan(0.5)
    expect(genreSimilarity('Disco', 'Funk')).toBeGreaterThan(
      genreSimilarity('Disco', 'Death Metal'),
    )
  })

  test('umbrella labels are damped in the hybrid too', () => {
    expect(genreSimilarity('House', 'Electronic')).toBeLessThanOrEqual(0.5)
  })

  test('space-collapsed pack labels are found from spaced app labels', () => {
    // The dataset spells some labels without spaces ("eurodance"); a spaced
    // user label must still hit the same vector, not the lexical fallback.
    expect(genreSimilarity('Euro Dance', 'Eurodance')).toBe(1)
  })
})

describe('normalization fixes (science doc §6.4)', () => {
  test('periods strip: U.K. Garage reaches uk garage', () => {
    expect(normalizeGenre('U.K. Garage')).toBe('uk garage')
  })

  test('bare Garage aliases to uk garage', () => {
    expect(normalizeGenre('Garage')).toBe('uk garage')
  })

  test('en/em dashes separate components: Pop – Synthpop splits', () => {
    expect(genreComponents('Pop – Synthpop')).toEqual(['pop', 'synthpop'])
    expect(genreComponents('Pop — Synthpop')).toEqual(['pop', 'synthpop'])
  })

  test('hyphens still bind words: hip-hop stays one label', () => {
    expect(genreComponents('Hip-Hop')).toEqual(['hip hop'])
  })

  test('r&b survives inside a longer label', () => {
    // The &-unit repair keeps r&b whole mid-phrase; an unaliased phrase shows
    // the mechanics (the real-library label itself now aliases to 'soul').
    expect(normalizeGenre('Bass And R&B')).toBe('bass & r&b')
    expect(normalizeGenre('Classic Soul And R&B')).toBe('soul')
  })

  test("Discogs's compound Folk, World, & Country stays whole", () => {
    expect(genreComponents('Folk, World, & Country')).toEqual(['folk'])
  })
})

/** Two genres meet below the electronic/music umbrellas in the curated tree. */
function expectSpecificAncestor(a: string, b: string): void {
  const ancestor = sharedGenreAncestor(a, b)
  expect(ancestor, `${a} ~ ${b}`).not.toBeNull()
  expect(['electronic', 'music']).not.toContain(ancestor)
}

describe('curated-tree additions', () => {
  test('the free-party cluster hangs under techno', () => {
    expectSpecificAncestor('tribe', 'tekno')
    expectSpecificAncestor('acidcore', 'acid techno')
    expectSpecificAncestor('raggatek', 'jungle')
    expectSpecificAncestor('tekno', 'techno')
  })

  test('regional funk joins the funk family', () => {
    expectSpecificAncestor('turkish funk', 'funk')
    expectSpecificAncestor('turkish funk', 'persian funk')
    expect(sharedGenreAncestor('turkish funk', 'trance')).toBeNull()
  })

  test('the plain gaps have lineage now', () => {
    expectSpecificAncestor('acid trance', 'trance')
    expectSpecificAncestor('future garage', 'uk garage')
    expectSpecificAncestor('minimal house', 'house')
    expectSpecificAncestor('new beat', 'acid house')
    expectSpecificAncestor('jumpstyle', 'hardstyle')
    expectSpecificAncestor('electro swing', 'electronica')
    expectSpecificAncestor('uk hardcore', 'happy hardcore')
    expectSpecificAncestor('juke', 'footwork')
  })
})

describe('computeGenreCoverage', () => {
  const t = (genre: string | null) => ({ genre })

  test('classifies blank, covered, fallback and invisible tracks', () => {
    const cov = computeGenreCoverage([
      t(null),
      t(''),
      t('Techno'),
      t('DnB'),
      t('Techno Dreaming'),
      t('Xyzzyfoo'),
    ])
    expect(cov.total).toBe(6)
    expect(cov.blank).toBe(2)
    expect(cov.tagged).toBe(4)
    expect(cov.outside).toBe(2)
    expect(cov.invisible).toBe(1)
  })

  test('the best component decides: one covered component rescues the track', () => {
    const cov = computeGenreCoverage([t('Xyzzyfoo / Techno')])
    expect(cov.outside).toBe(0)
  })

  test('tree additions count as covered', () => {
    const cov = computeGenreCoverage([t('Tribe'), t('Turkish Funk')])
    expect(cov.outside).toBe(0)
  })

  test('the top list ranks uncovered labels by track count', () => {
    const cov = computeGenreCoverage([
      t('Techno Dreaming'),
      t('Techno Dreaming'),
      t('House Glimmer'),
    ])
    expect(cov.top[0]).toEqual({ label: 'techno dreaming', count: 2 })
    expect(cov.top[1]).toEqual({ label: 'house glimmer', count: 1 })
  })
})

describe('mined aliases from the real-library dry run', () => {
  test('personal descriptors map to their nearest genre', () => {
    expect(normalizeGenre('Techno Melancholic')).toBe('melodic techno')
    expect(normalizeGenre('Techno Melodieus')).toBe('melodic techno')
    expect(normalizeGenre('House Ethno')).toBe('organic house')
    expect(normalizeGenre('Techno Rave')).toBe('hard techno')
    expect(normalizeGenre('Techno Half Tempo')).toBe('techno')
  })

  test('shorthand and foreign spellings resolve', () => {
    expect(normalizeGenre('Minimal')).toBe('minimal techno')
    expect(normalizeGenre('NDW')).toBe('new wave')
    expect(normalizeGenre('Electronique')).toBe('electronic')
    expect(normalizeGenre('Nederpop')).toBe('pop')
    expect(normalizeGenre('Funk Thai')).toBe('thai funk')
    expect(normalizeGenre('Psychedelic')).toBe('psytrance')
  })

  test('mined tree nodes have lineage', () => {
    expectSpecificAncestor('balkan', 'folk')
    expectSpecificAncestor('thai funk', 'turkish funk')
    expectSpecificAncestor('jackin house', 'chicago house')
    expectSpecificAncestor('halftime', 'drum & bass')
  })

  test('noise labels stay unmapped — the reject class is silence', () => {
    // "Nieuw!!!", "90s", site watermarks: not genres, so no alias may
    // confidently mis-map them; they stay (correctly) genre-invisible.
    expect(normalizeGenre('Nieuw!!!')).toBe('nieuw!!!')
    expect(normalizeGenre('90s')).toBe('90s')
  })
})

describe('the learned vocabulary bridge', () => {
  afterEach(() => setGenreBridge())

  // Each pair is one track: the genre the DJ wrote, and the style the
  // analyser predicted for that same audio.
  const tribe = (n: number): [string, string][] =>
    Array.from({ length: n }, () => ['Tribe', 'Tribal'] as [string, string])

  test('a label the model agrees about earns an alias, weighted by that agreement', () => {
    expect(learnGenreBridge([...tribe(7), ['Tribe', 'Techno'], ['Tribe', 'Techno']])).toEqual([
      { own: 'tribe', style: 'tribal', weight: 7 / 9 },
    ])
  })

  test('too few tracks, or no majority, earns nothing', () => {
    expect(learnGenreBridge(tribe(2))).toEqual([])
    expect(
      learnGenreBridge([...tribe(2), ['Tribe', 'Techno'], ['Tribe', 'Techno'], ['Tribe', 'House']]),
    ).toEqual([])
  })

  test('a multi-genre label votes per component, and never aliases itself', () => {
    const pairs: [string, string][] = Array.from(
      { length: 3 },
      () => ['Techno / Tribe', 'Tribal'] as [string, string],
    )
    expect(learnGenreBridge(pairs)).toEqual([
      { own: 'techno', style: 'tribal', weight: 1 },
      { own: 'tribe', style: 'tribal', weight: 1 },
    ])
    expect(
      learnGenreBridge(Array.from({ length: 3 }, () => ['Tribal', 'tribal'] as [string, string])),
    ).toEqual([])
  })

  test('an installed alias links two words the pack does not link', () => {
    expect(genreSimilarity('tribe', 'tribal')).toBeLessThan(0.2)
    setGenreBridge([{ own: 'tribe', style: 'tribal', weight: 0.64 }])
    expect(genreSimilarity('tribe', 'tribal')).toBeCloseTo(0.64)
    expect(genreSimilarity('tribal', 'tribe')).toBeCloseTo(0.64)
    // And it never lowers a similarity the methods already found.
    expect(genreSimilarity('deep house', 'house')).toBeGreaterThan(0.64)
  })

  test('clearing restores the curated numbers exactly', () => {
    const before = genreSimilarity('tribe', 'tribal')
    setGenreBridge([{ own: 'tribe', style: 'tribal', weight: 0.64 }])
    setGenreBridge()
    expect(genreSimilarity('tribe', 'tribal')).toBe(before)
  })
})

describe('sharedGenreAncestor (the pair card on the genre map)', () => {
  test('names the most specific ancestor two genres share in the curated tree', () => {
    expect(sharedGenreAncestor('Deep House', 'Tech House')).toBe('house')
    expect(sharedGenreAncestor('Liquid Drum & Bass', 'Neurofunk')).toBe('drum & bass')
    expect(sharedGenreAncestor('Tribe', 'Acidcore')).toBe('tekno')
  })

  test('a genre and its own ancestor share that ancestor', () => {
    expect(sharedGenreAncestor('Tech House', 'Techno')).toBe('techno')
  })

  test('only the root in common, or a label the tree lacks, gives null', () => {
    expect(sharedGenreAncestor('Techno', 'Jazz')).toBeNull()
    expect(sharedGenreAncestor('Zydeco', 'Techno')).toBeNull()
  })

  test('multi-genre fields answer through their best component', () => {
    expect(sharedGenreAncestor('Jazz / Deep House', 'Tech House')).toBe('house')
  })
})
