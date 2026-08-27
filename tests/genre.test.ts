import { describe, expect, test } from 'vitest'
import {
  computeGenreCoverage,
  GENRE_METHODS,
  genreComponents,
  genreSimilarity,
  METHOD_LABEL,
  METHOD_LABEL_LONG,
  METHOD_PICK_ORDER,
  normalizeGenre,
  packNeighbours,
  UMBRELLA_GENRES,
} from '../src/core/genre'

describe('method labels', () => {
  test('short labels carry no parenthetical explainer (issue 9)', () => {
    for (const method of GENRE_METHODS) {
      expect(METHOD_LABEL[method]).not.toContain('(')
      expect(METHOD_LABEL[method].length).toBeGreaterThan(0)
    }
  })

  test('long labels exist for the advanced menu and extend the short ones', () => {
    for (const method of GENRE_METHODS) {
      expect(METHOD_LABEL_LONG[method]).toContain(METHOD_LABEL[method])
    }
  })

  test('the pick order puts the recommended hybrid method first (issue 7)', () => {
    expect(METHOD_PICK_ORDER[0]).toBe('hybrid')
    expect([...METHOD_PICK_ORDER].sort()).toEqual([...GENRE_METHODS].sort())
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
    const compound = genreSimilarity('House / Techno', 'Minimal Techno', 'taxonomy')
    const plain = genreSimilarity('Techno', 'Minimal Techno', 'taxonomy')
    expect(compound).toBe(plain)
    expect(genreSimilarity('House / Techno', 'Techno', 'exact')).toBe(1)
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

describe('genreSimilarity: exact', () => {
  test('1 for equal after normalization, 0 otherwise', () => {
    expect(genreSimilarity('Techno', 'techno', 'exact')).toBe(1)
    expect(genreSimilarity('DnB', 'Drum & Bass', 'exact')).toBe(1)
    expect(genreSimilarity('Techno', 'Tech House', 'exact')).toBe(0)
  })
})

describe('genreSimilarity: lexical', () => {
  test('token overlap gives partial similarity', () => {
    const s = genreSimilarity('Tech House', 'Deep House', 'lexical')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  test('identical labels score 1, disjoint labels 0', () => {
    expect(genreSimilarity('Deep House', 'deep-house', 'lexical')).toBe(1)
    expect(genreSimilarity('Techno', 'Jazz', 'lexical')).toBe(0)
  })

  test('is symmetric', () => {
    expect(genreSimilarity('Tech House', 'House', 'lexical')).toBe(
      genreSimilarity('House', 'Tech House', 'lexical'),
    )
  })
})

describe('genreSimilarity: graph', () => {
  test('direct neighbours beat two-step relations, which beat far genres', () => {
    const parent = genreSimilarity('House', 'Deep House', 'graph')
    const sibling = genreSimilarity('Techno', 'Tech House', 'graph')
    const far = genreSimilarity('Techno', 'Jazz', 'graph')
    expect(parent).toBeGreaterThan(sibling)
    expect(sibling).toBeGreaterThan(far)
  })

  test('same genre is 1; aliases resolve before lookup', () => {
    expect(genreSimilarity('Drum and Bass', 'DnB', 'graph')).toBe(1)
  })

  test('labels not in the graph fall back to lexical similarity', () => {
    // "Hard House" is not a graph node but shares a token with "House".
    expect(genreSimilarity('Hard House', 'House', 'graph')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno', 'graph')).toBe(0)
  })

  test('is symmetric', () => {
    expect(genreSimilarity('Dub', 'Dubstep', 'graph')).toBe(
      genreSimilarity('Dubstep', 'Dub', 'graph'),
    )
  })
})

describe('genreSimilarity: taxonomy (Lin over the rooted genre tree)', () => {
  test('parent–child beats cousins, which beat unrelated families', () => {
    const parentChild = genreSimilarity('House', 'Deep House', 'taxonomy')
    const cousins = genreSimilarity('Deep House', 'Tech House', 'taxonomy')
    const far = genreSimilarity('Techno', 'Jazz', 'taxonomy')
    expect(parentChild).toBeGreaterThan(cousins)
    expect(cousins).toBeGreaterThan(far)
    expect(far).toBe(0)
  })

  test('deep specific ancestors count more than shallow generic ones', () => {
    // Siblings under drum & bass (deep LCA) vs pairs relating only through
    // the electronic umbrella (shallow LCA).
    const deepLca = genreSimilarity('Liquid Drum & Bass', 'Neurofunk', 'taxonomy')
    const shallowLca = genreSimilarity('Deep House', 'Gabber', 'taxonomy')
    expect(deepLca).toBeGreaterThan(shallowLca)
  })

  test('umbrella ancestors score low against their descendants (low IC)', () => {
    const viaUmbrella = genreSimilarity('Electronic', 'Techno', 'taxonomy')
    const withinFamily = genreSimilarity('Techno', 'Minimal Techno', 'taxonomy')
    expect(withinFamily).toBeGreaterThan(viaUmbrella)
  })

  test('multi-parent genres sit close to every parent (DAG, not strict tree)', () => {
    // Tech house derives from both house and techno: each parent must score
    // clearly above an unrelated electronic family (trance).
    const toTrance = genreSimilarity('Tech House', 'Trance', 'taxonomy')
    expect(genreSimilarity('Tech House', 'Techno', 'taxonomy')).toBeGreaterThan(toTrance + 0.2)
    expect(genreSimilarity('Tech House', 'House', 'taxonomy')).toBeGreaterThan(toTrance + 0.2)
  })

  test('is symmetric and 1 for identical labels', () => {
    expect(genreSimilarity('Jungle', 'jungle', 'taxonomy')).toBe(1)
    expect(genreSimilarity('Dub', 'Dubstep', 'taxonomy')).toBe(
      genreSimilarity('Dubstep', 'Dub', 'taxonomy'),
    )
  })

  test('labels outside the tree fall back to lexical similarity', () => {
    expect(genreSimilarity('Warehouse House', 'House', 'taxonomy')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno', 'taxonomy')).toBe(0)
  })
})

describe('genreSimilarity: hybrid (embedding retrofitted toward the curated tree)', () => {
  test('covers curated club genres the tagging data never saw', () => {
    // Neither label exists in the AcousticBrainz vocabulary; the retrofit
    // gives them vectors from their tree neighbourhood (drum & bass).
    expect(genreSimilarity('Liquid Drum & Bass', 'Neurofunk', 'hybrid')).toBeGreaterThan(0.3)
    expect(genreSimilarity('Melodic Techno', 'Techno', 'hybrid')).toBeGreaterThan(0.3)
  })

  test('keeps the embedding’s real-world associations', () => {
    expect(genreSimilarity('Techno', 'Tech House', 'hybrid')).toBeGreaterThan(0.5)
    expect(genreSimilarity('Disco', 'Funk', 'hybrid')).toBeGreaterThan(
      genreSimilarity('Disco', 'Death Metal', 'hybrid'),
    )
  })

  test('labels unknown to pack and tree fall back to lexical', () => {
    expect(genreSimilarity('Warehouse House', 'House', 'hybrid')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno', 'hybrid')).toBe(0)
  })
})

describe('genreSimilarity: embedding', () => {
  test('near neighbours in the pack score higher than distant genres', () => {
    const near = genreSimilarity('House', 'Deep House', 'embedding')
    const far = genreSimilarity('House', 'Gabber', 'embedding')
    expect(near).toBeGreaterThan(far)
  })

  test('same genre is 1 and unknown labels fall back to lexical', () => {
    expect(genreSimilarity('Techno', 'techno', 'embedding')).toBe(1)
    // "warehouse house" is no real pack label; token overlap carries it.
    expect(genreSimilarity('Warehouse House', 'House', 'embedding')).toBeGreaterThan(0)
  })

  test('known labels that are not neighbours score 0, not lexical', () => {
    // Both are pack labels sharing the token "hard", but unrelated music:
    // the pack must answer 0 instead of falling back to word overlap.
    expect(genreSimilarity('Hard Rock', 'Hard Trance', 'embedding')).toBe(0)
  })

  test('umbrella labels are damped and cannot act as hubs', () => {
    const umbrella = genreSimilarity('House', 'Electronic', 'embedding')
    expect(umbrella).toBeLessThanOrEqual(0.5)
    expect(genreSimilarity('House', 'Deep House', 'embedding')).toBeGreaterThan(umbrella)
  })

  test('stays within [0, 1]', () => {
    for (const pair of [
      ['Techno', 'Minimal Techno'],
      ['Trance', 'Jazz'],
      ['Dubstep', 'Riddim'],
    ] as const) {
      const s = genreSimilarity(pair[0], pair[1], 'embedding')
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  test('the real AcousticBrainz pack orders relatedness sensibly', () => {
    const techHouse = genreSimilarity('Techno', 'Tech House', 'embedding')
    const house = genreSimilarity('Techno', 'House', 'embedding')
    const folk = genreSimilarity('Techno', 'Folk', 'embedding')
    expect(techHouse).toBeGreaterThan(house)
    expect(house).toBeGreaterThan(folk)
    expect(genreSimilarity('Trance', 'Progressive Trance', 'embedding')).toBeGreaterThan(0.5)
    expect(genreSimilarity('Disco', 'Funk', 'embedding')).toBeGreaterThan(
      genreSimilarity('Disco', 'Death Metal', 'embedding'),
    )
  })

  test('umbrella labels are damped in the hybrid too', () => {
    expect(genreSimilarity('House', 'Electronic', 'hybrid')).toBeLessThanOrEqual(0.5)
  })

  test('space-collapsed pack labels are found from spaced app labels', () => {
    // The dataset spells some labels without spaces ("eurodance"); a spaced
    // user label must still hit the same vector, not the lexical fallback.
    expect(genreSimilarity('Euro Dance', 'Eurodance', 'embedding')).toBe(1)
  })
})

describe('normalization fixes (v12 WS5, science doc §6.4)', () => {
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

describe('curated-tree additions (v12 WS5)', () => {
  test('the free-party cluster is taxonomy-similar to techno', () => {
    expect(genreSimilarity('tribe', 'tekno', 'taxonomy')).toBeGreaterThan(0.5)
    expect(genreSimilarity('acidcore', 'acid techno', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('raggatek', 'jungle', 'taxonomy')).toBeGreaterThan(0.2)
    expect(genreSimilarity('tekno', 'techno', 'taxonomy')).toBeGreaterThan(0.2)
  })

  test('regional funk joins the funk family', () => {
    expect(genreSimilarity('turkish funk', 'funk', 'taxonomy')).toBeGreaterThan(0.2)
    // Sibling leaves score lower than parent-child under intrinsic-IC Lin;
    // what matters is that they beat an unrelated pairing clearly.
    const siblings = genreSimilarity('turkish funk', 'persian funk', 'taxonomy')
    expect(siblings).toBeGreaterThan(0.1)
    expect(siblings).toBeGreaterThan(genreSimilarity('turkish funk', 'trance', 'taxonomy'))
  })

  test('the plain gaps have lineage now', () => {
    expect(genreSimilarity('acid trance', 'trance', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('future garage', 'uk garage', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('minimal house', 'house', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('new beat', 'acid house', 'taxonomy')).toBeGreaterThan(0.2)
    expect(genreSimilarity('jumpstyle', 'hardstyle', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('electro swing', 'electronica', 'taxonomy')).toBeGreaterThan(0.2)
    expect(genreSimilarity('uk hardcore', 'happy hardcore', 'taxonomy')).toBeGreaterThan(0.3)
    expect(genreSimilarity('juke', 'footwork', 'taxonomy')).toBeGreaterThan(0.2)
  })
})

describe('computeGenreCoverage (v12 WS6 — P1 productised)', () => {
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

  test('v12 tree additions count as covered now', () => {
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

describe('mined aliases from the real-library dry run (v12 WS7)', () => {
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
    expect(genreSimilarity('balkan', 'folk', 'taxonomy')).toBeGreaterThan(0.15)
    expect(genreSimilarity('thai funk', 'turkish funk', 'taxonomy')).toBeGreaterThan(0.1)
    expect(genreSimilarity('jackin house', 'chicago house', 'taxonomy')).toBeGreaterThan(0.2)
    expect(genreSimilarity('halftime', 'drum & bass', 'taxonomy')).toBeGreaterThan(0.2)
  })

  test('noise labels stay unmapped — the reject class is silence', () => {
    // "Nieuw!!!", "90s", site watermarks: not genres, so no alias may
    // confidently mis-map them; they stay (correctly) genre-invisible.
    expect(normalizeGenre('Nieuw!!!')).toBe('nieuw!!!')
    expect(normalizeGenre('90s')).toBe('90s')
  })
})
