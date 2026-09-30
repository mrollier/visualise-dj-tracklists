import type { Track } from './model'

/**
 * Quick find: type-ahead over artist and title. Every word of the query must
 * appear somewhere in "artist title", ignoring case and accents. Matches rank
 * by how they match — an artist or title that starts with the query first,
 * then every word at a word start, then anywhere — and alphabetically by
 * title within a rank, so the same query always lists the same tracks.
 */

interface Entry {
  track: Track
  artist: string
  title: string
  haystack: string
}

/** Lowercase, accents stripped, whitespace collapsed. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Normalised once per library array: the stores hand out the same array until
// the library or the filters change, so each keystroke only compares strings.
const entriesOf = new WeakMap<readonly Track[], Entry[]>()

function entries(tracks: readonly Track[]): Entry[] {
  let found = entriesOf.get(tracks)
  if (found === undefined) {
    found = tracks.map((track) => {
      const artist = normalize(track.artist ?? '')
      const title = normalize(track.title)
      return { track, artist, title, haystack: `${artist} ${title}` }
    })
    entriesOf.set(tracks, found)
  }
  return found
}

const startsWord = (haystack: string, word: string): boolean => {
  for (let at = haystack.indexOf(word); at !== -1; at = haystack.indexOf(word, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1])) return true
  }
  return false
}

export function quickFind(
  tracks: readonly Track[],
  query: string,
  limit = 8,
): { matches: Track[]; total: number } {
  const q = normalize(query)
  if (q === '') return { matches: [], total: 0 }
  const words = q.split(' ')
  const ranked: { entry: Entry; rank: number }[] = []
  for (const entry of entries(tracks)) {
    if (!words.every((w) => entry.haystack.includes(w))) continue
    const rank =
      entry.title.startsWith(q) || entry.artist.startsWith(q)
        ? 0
        : words.every((w) => startsWord(entry.haystack, w))
          ? 1
          : 2
    ranked.push({ entry, rank })
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.title.localeCompare(b.entry.title) ||
      a.entry.track.id.localeCompare(b.entry.track.id),
  )
  return { matches: ranked.slice(0, limit).map((r) => r.entry.track), total: ranked.length }
}
