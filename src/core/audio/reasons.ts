import { formatNote } from './formats'

/**
 * Why a track cannot be previewed, and the copy the player bar shows for it.
 * Kept as data + pure label functions so the wording is under test and the
 * component stays a thin view.
 *
 * Two levels (v29 #7): a short `reasonLabel` that fits the deck row, and a
 * `reasonDetail` behind the ⓘ beside it saying what happened, why, and what
 * to do about it. The short one alone was not enough — "format unsupported in
 * this browser" named neither the format nor the reason.
 */
export type UnplayableReason =
  | 'no-source'
  | 'needs-permission'
  | 'no-location'
  | 'not-found'
  | 'ambiguous'
  | 'unsupported'
  | 'decode-failed'
  | 'read-error'

export interface ReasonContext {
  /** The demo library has no audio at all; say that rather than blaming the folder. */
  sampleLibrary: boolean
  /** Name of the granted folder, for "not found in X". */
  rootName: string | null
  ambiguousCount?: number
  extension?: string | null
  /**
   * True when the media element itself refused the file, false when this is
   * `canPlayType`'s advance guess. They are different facts and used to read
   * identically: one is a prediction, the other is a verdict.
   */
  raised?: boolean
}

export function reasonLabel(reason: UnplayableReason, ctx: ReasonContext): string {
  const root = ctx.rootName ?? 'your music folder'
  switch (reason) {
    case 'no-source':
      return 'link your music folder to preview tracks'
    case 'needs-permission':
      return `reconnect “${root}” to preview tracks`
    case 'no-location':
      return ctx.sampleLibrary ? 'demo collection has no audio' : 'no file path in the library'
    case 'not-found':
      return `file not found in “${root}”`
    case 'ambiguous':
      return `${ctx.ambiguousCount ?? 2} files share that name — can’t tell which`
    case 'unsupported':
      return ctx.extension == null
        ? 'this browser can’t play this format'
        : `this browser can’t play ${ctx.extension.toUpperCase()}`
    case 'decode-failed':
      return 'this file wouldn’t decode'
    case 'read-error':
      return 'couldn’t read the file'
  }
}

export function reasonDetail(reason: UnplayableReason, ctx: ReasonContext): string {
  const root = ctx.rootName ?? 'your music folder'
  switch (reason) {
    case 'no-source':
      return (
        'A browser cannot open a file from the path in your library — that path is only text to a ' +
        'web page. Point the app at the folder your music lives in and it matches your tracks ' +
        'against what is really there. The audio is read on your machine and never uploaded.'
      )
    case 'needs-permission':
      return (
        `The folder “${root}” is remembered, but the permission to read it is not — browsers hand ` +
        'that back only inside a click, once per session. One press of Reconnect restores it.'
      )
    case 'no-location':
      return ctx.sampleLibrary
        ? 'The demo collection is generated, not imported: its tracks have keys, BPMs and genres, but no files behind them. Import your own library to hear anything.'
        : 'This track was imported without a file path — a CSV or a playlist that carried none — so there is nothing to match against your folder.'
    case 'not-found':
      return (
        `Nothing in “${root}” carries this file’s name. Either the file lives somewhere else, or ` +
        'the folder you linked sits below it in the tree. Linking a parent folder is always safe: ' +
        'matching is by name and folder, so a wider grant can only ever find more.'
      )
    case 'ambiguous':
      return (
        `${ctx.ambiguousCount ?? 2} files in “${root}” share this name, and their folders match ` +
        'your library’s path equally well. Playing the wrong one would quietly corrupt the very ' +
        'comparison this feature exists for, so it refuses to guess. Rename one, or link a ' +
        'narrower folder that holds only one of them.'
      )
    case 'unsupported': {
      const which = ctx.raised
        ? 'This browser opened the file and refused it.'
        : 'This browser reports no decoder for it, so it was not even tried.'
      return `${which} ${formatNote(ctx.extension ?? null)}`
    }
    case 'decode-failed':
      return (
        'The browser accepted the file, began decoding and gave up partway. That usually means ' +
        'the file is truncated or damaged, or that what is inside it is not what the extension ' +
        'says — an AIFF named .wav, for instance. Playing it in another player will tell you which.'
      )
    case 'read-error':
      return (
        `The browser got no audio out of this file. It may have been moved or renamed since “${root}” ` +
        'was linked, or be on a volume that has since been unmounted — or the file itself is ' +
        'damaged, which a browser reports as ending instantly rather than as an error. ' +
        'Re-linking the folder rebuilds the index.'
      )
  }
}
