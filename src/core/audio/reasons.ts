/**
 * Why a track cannot be previewed, and the copy the player bar shows for it.
 * Kept as data + a pure label function so the wording is under test and the
 * component stays a thin view.
 */
export type UnplayableReason =
  | 'no-source'
  | 'needs-permission'
  | 'no-location'
  | 'not-found'
  | 'ambiguous'
  | 'unsupported'
  | 'read-error'

export interface ReasonContext {
  /** The demo library has no audio at all; say that rather than blaming the folder. */
  sampleLibrary: boolean
  /** Name of the granted folder, for "not found in X". */
  rootName: string | null
  ambiguousCount?: number
  extension?: string | null
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
        ? 'format unsupported in this browser'
        : `format unsupported in this browser (${ctx.extension.toUpperCase()})`
    case 'read-error':
      return 'couldn’t read the file'
  }
}
