/**
 * Which files are audio, and whether this browser can actually play them.
 *
 * The verdict drives the coverage read-out and pre-dims the transport; it is
 * NEVER used to refuse to try. `canPlayType` is a hint and lies in both
 * directions, so ground truth stays the media element's own `error` event.
 */

/** The extensions the file importer accepts (v28: moved here from TopBar). */
export const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff?|m4a|ogg)$/i

export type FormatVerdict = 'supported' | 'unknown' | 'unsupported'

/** Injected so this module stays DOM-free: `(m) => audio.canPlayType(m) !== ''`. */
export type CanPlayProbe = (mimeType: string) => boolean

/**
 * MIME types worth asking about per extension. Containers that can hold more
 * than one codec get one candidate per codec, because the extension alone
 * cannot tell them apart.
 */
export const MIME_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  mp3: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/x-wav'],
  flac: ['audio/flac', 'audio/x-flac'],
  aif: ['audio/aiff', 'audio/x-aiff'],
  aiff: ['audio/aiff', 'audio/x-aiff'],
  m4a: ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="alac"'],
  ogg: ['audio/ogg; codecs="vorbis"', 'audio/ogg; codecs="opus"'],
}

/**
 * Containers whose extension hides which codec is inside. A partial probe
 * result here means "probably fine, might not be" rather than "yes".
 */
const AMBIGUOUS_CONTAINERS: ReadonlySet<string> = new Set(['m4a', 'ogg'])

/** The lowercased extension, or null when the name has none. */
export function extensionOf(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  return match === null ? null : match[1].toLowerCase()
}

export function isAudioFileName(fileName: string): boolean {
  return AUDIO_EXTENSIONS.test(fileName)
}

export function formatVerdict(extension: string | null, probe: CanPlayProbe): FormatVerdict {
  if (extension === null) return 'unsupported'
  const candidates = MIME_CANDIDATES[extension]
  if (candidates === undefined) return 'unsupported'
  const passing = candidates.filter((mime) => probe(mime)).length
  if (passing === 0) return 'unsupported'
  if (passing < candidates.length && AMBIGUOUS_CONTAINERS.has(extension)) return 'unknown'
  return 'supported'
}
