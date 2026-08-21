import type { Track } from '../model'
import { type CanPlayProbe, extensionOf, formatVerdict } from './formats'
import { type FileIndex, matchLocation } from './pathMatch'
import type { UnplayableReason } from './reasons'

/**
 * Turning a library plus a granted folder into "what can I actually hear?",
 * and the one-line answer the bar shows.
 */

export type TrackResolution<H> =
  | { kind: 'playable'; handle: H; verdict: 'supported' | 'unknown' }
  | {
      kind: 'unplayable'
      reason: UnplayableReason
      ambiguousCount?: number
      extension?: string | null
    }

export interface CoverageReport {
  total: number
  playable: number
  unsupported: number
  notFound: number
  ambiguous: number
  noLocation: number
}

export function resolveTrack<H>(
  track: Track,
  index: FileIndex<H>,
  probe: CanPlayProbe,
): TrackResolution<H> {
  if (track.location === null) return { kind: 'unplayable', reason: 'no-location' }
  const match = matchLocation(index, track.location)
  if (match.kind === 'miss') return { kind: 'unplayable', reason: 'not-found' }
  if (match.kind === 'ambiguous')
    return { kind: 'unplayable', reason: 'ambiguous', ambiguousCount: match.count }
  const extension = extensionOf(track.location)
  const verdict = formatVerdict(extension, probe)
  // 'unknown' still counts as playable: canPlayType cannot see inside an m4a,
  // and refusing to try on its say-so would hide tracks that play fine.
  if (verdict === 'unsupported') return { kind: 'unplayable', reason: 'unsupported', extension }
  return { kind: 'playable', handle: match.entry.handle, verdict }
}

export function summarize<H>(resolutions: readonly TrackResolution<H>[]): CoverageReport {
  const report: CoverageReport = {
    total: resolutions.length,
    playable: 0,
    unsupported: 0,
    notFound: 0,
    ambiguous: 0,
    noLocation: 0,
  }
  for (const resolution of resolutions) {
    if (resolution.kind === 'playable') report.playable += 1
    else if (resolution.reason === 'unsupported') report.unsupported += 1
    else if (resolution.reason === 'not-found') report.notFound += 1
    else if (resolution.reason === 'ambiguous') report.ambiguous += 1
    else if (resolution.reason === 'no-location') report.noLocation += 1
  }
  return report
}

/** e.g. `2043 of 2080 playable · 31 unsupported format · 6 not found`. */
export function coverageLine(report: CoverageReport): string {
  if (report.total === 0) return 'No tracks'
  const clauses = [`${report.playable} of ${report.total} playable`]
  if (report.unsupported > 0) clauses.push(`${report.unsupported} unsupported format`)
  if (report.notFound > 0) clauses.push(`${report.notFound} not found`)
  if (report.ambiguous > 0) clauses.push(`${report.ambiguous} ambiguous`)
  if (report.noLocation > 0) clauses.push(`${report.noLocation} without a file path`)
  return clauses.join(' · ')
}

/**
 * The same answer at the width the player bar's right column actually has
 * (v29 #6): `2043/2080 playable`. The clauses `coverageLine` adds move into
 * the ⓘ beside it, where they can be read in full rather than truncated —
 * and the reasons a track failed are the interesting half.
 */
export function coverageShort(report: CoverageReport): string {
  if (report.total === 0) return 'No tracks'
  return `${report.playable}/${report.total} playable`
}
