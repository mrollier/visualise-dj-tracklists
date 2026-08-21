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

/**
 * Why one format does or does not play, in a sentence a person can act on
 * (v29 #7). "format unsupported in this browser" named neither the format nor
 * the reason, and this is the message a Rekordbox library hits most often.
 *
 * Keyed by extension, because that is all we know: the verdict comes from
 * `canPlayType` on a MIME string built from the extension, and nothing here
 * ever opens the file to look inside it.
 */
const AIFF_NOTE =
  'AIFF is uncompressed Apple audio, and the format Rekordbox writes when it converts. ' +
  'Chrome and Firefox ship no AIFF decoder at all; Safari does. ' +
  'So: open Zodiac Tracker in Safari, or convert these tracks to FLAC or WAV.'

export const FORMAT_NOTES: Readonly<Record<string, string>> = {
  aif: AIFF_NOTE,
  aiff: AIFF_NOTE,
  m4a:
    'An .m4a holds either AAC, which every browser plays, or ALAC (Apple Lossless), ' +
    'which only Safari decodes — the extension is the same either way. ' +
    'An .m4a that will not play is almost certainly ALAC.',
  flac:
    'FLAC plays in Chrome, Firefox and Safari 11 and later, ' +
    'so a refusal here points at an old browser or a file that is not really FLAC.',
  wav:
    'WAV plays everywhere as long as it holds ordinary PCM. ' +
    'A WAV that will not play usually holds something else — 32-bit float, or ADPCM.',
  ogg: 'Ogg Vorbis and Opus play in Chrome and Firefox. Safari plays neither.',
  mp3: 'MP3 plays in every browser, so a refusal here is about this file rather than the format.',
}

/** The note for an extension, or a general one when the extension is unknown. */
export function formatNote(extension: string | null): string {
  if (extension === null)
    return 'The file has no extension, so nothing can guess what is inside it.'
  return (
    FORMAT_NOTES[extension] ??
    `.${extension} is not an audio extension this app recognises, so it was never indexed.`
  )
}
