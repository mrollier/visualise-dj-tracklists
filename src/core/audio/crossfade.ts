/**
 * The crossfade curve. `position` runs -1 (all A) to +1 (all B).
 *
 * A UNITY PLATEAU, not equal power (v28.1 reversal). The deck the fader points
 * at stays at 1.0 across its whole half; only the far deck tapers away. So
 * centre is both tracks at full level, and nothing is turned down at the one
 * position an A/B comparison actually sits at.
 *
 * Equal power (`cos`/`sin`) is the right curve for a DJ *transition*, where
 * the two signals are meant to sum to one constant programme and each sits at
 * -3 dB in the middle of the move. This is a *comparison* tool: the two tracks
 * are candidates to be judged at their own level, not a mix to be balanced.
 *
 * `cos` is even, so a single taper term serves both decks. Its derivative is
 * zero at the origin, so the taper joins the plateau smoothly — there is no
 * audible kink crossing centre.
 *
 * The sum of two decks at unity can exceed full scale; engine.ts answers that
 * with a limiter on the output bus, NOT with a trim here. A -3 dB master trim
 * would reproduce the old centre level exactly and undo the whole point.
 */
export function crossfadeGains(position: number): { a: number; b: number } {
  const clamped = Number.isFinite(position) ? Math.min(1, Math.max(-1, position)) : 0
  const taper = Math.cos((clamped * Math.PI) / 2)
  return { a: clamped <= 0 ? 1 : taper, b: clamped >= 0 ? 1 : taper }
}
