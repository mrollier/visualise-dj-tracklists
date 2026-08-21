import { get, writable } from 'svelte/store'
import { coverageLine } from '../../core/audio/coverage'
import { crossfadeGains } from '../../core/audio/crossfade'
import {
  type DeckEffect,
  type DeckEvent,
  type DeckId,
  type DeckState,
  EMPTY_DECKS,
  reduceDecks,
} from '../../core/audio/decks'
import type { UnplayableReason } from '../../core/audio/reasons'
import { clampSeek, resolveDuration } from '../../core/audio/transport'
import type { Track } from '../../core/model'
import { clickedTrackId, library, settings } from '../../stores'
import * as engine from './engine'
import {
  coverage,
  currentSource,
  reindex,
  resolutionFor,
  restoreSavedFolder,
  setProbe,
} from './sourceStore'

/**
 * Transport state for the two decks. Session-only, never persisted, never
 * logged: no play count is incremented and nothing about what was heard
 * reaches the saved project.
 */
export const decks = writable<DeckState>(EMPTY_DECKS)
export const crossfade = writable(0)
export const playing = writable<Record<DeckId, boolean>>({ a: false, b: false })
export const positions = writable<Record<DeckId, number>>({ a: 0, b: 0 })
export const durations = writable<Record<DeckId, number | null>>({ a: null, b: null })
/** Set when a deck's own file proved unplayable, overriding the static verdict. */
export const deckError = writable<Record<DeckId, UnplayableReason | null>>({ a: null, b: null })

/** Which track's bytes are actually in each element right now. */
const materialised: Record<DeckId, string | null> = { a: null, b: null }
/**
 * The most recent load each deck was asked for. `fileFor` is async on the FSA
 * backend, so without a token a slow resolve can land after a newer click and
 * leave the deck holding a track nobody asked for.
 */
const wanted: Record<DeckId, string | null> = { a: null, b: null }
/**
 * Loading a track into an element starts a media pipeline, and doing that
 * repeatedly underneath a playing deck is one of the ways the audio drops out
 * (v29 #5). Clicking through the wheel need not pre-load every track it passes
 * — only the one the pointer settles on.
 */
const PRELOAD_DELAY_MS = 200
const preloadTimers: Record<DeckId, ReturnType<typeof setTimeout> | undefined> = {
  a: undefined,
  b: undefined,
}
/** togglePlay awaits a load between its own checks; one click at a time. */
const busy: Record<DeckId, boolean> = { a: false, b: false }

function cancelPreload(deck: DeckId): void {
  clearTimeout(preloadTimers[deck])
  preloadTimers[deck] = undefined
}

export function coverageText(): string {
  const report = get(coverage)
  return report === null ? '' : coverageLine(report)
}

function applyGains(state: DeckState): void {
  // With nothing pinned the fader is meaningless — deck B is simply the sound.
  if (!state.aLocked) engine.setGains(0, 1)
  else {
    const { a, b } = crossfadeGains(get(crossfade))
    engine.setGains(a, b)
  }
}

/** The roles swapped, so everything the UI knows about a deck swaps with them. */
function swapDeckUi(): void {
  const flip = <T>(v: Record<DeckId, T>): Record<DeckId, T> => ({ a: v.b, b: v.a })
  playing.update(flip)
  positions.update(flip)
  durations.update(flip)
  deckError.update(flip)
}

function resetDeckUi(deck: DeckId): void {
  playing.update((p) => ({ ...p, [deck]: false }))
  positions.update((p) => ({ ...p, [deck]: 0 }))
  durations.update((d) => ({ ...d, [deck]: null }))
  deckError.update((e) => ({ ...e, [deck]: null }))
}

function apply(effects: readonly DeckEffect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'promote') {
      engine.promote()
      // A symmetric swap, because promote runs in both directions now (v29
      // #8): lock moves B up, unlock moves A down. `swapDeckUi` was already
      // symmetric; this was not, and the `clear` effect that always follows
      // nulls whichever side is being discarded anyway.
      const held = materialised.a
      materialised.a = materialised.b
      materialised.b = held
      swapDeckUi()
    } else if (effect.kind === 'clear') {
      cancelPreload(effect.deck)
      wanted[effect.deck] = null
      engine.clearDeck(effect.deck)
      materialised[effect.deck] = null
      resetDeckUi(effect.deck)
    } else {
      resetDeckUi(effect.deck)
      // Only pre-load once a gesture has paid for the graph; before that the
      // first play click materialises it. Debounced, so a click-storm through
      // the wheel does not churn the media pipeline under a playing deck.
      const { deck, trackId } = effect
      cancelPreload(deck)
      if (engine.hasContext()) {
        preloadTimers[deck] = setTimeout(() => void materialise(deck, trackId), PRELOAD_DELAY_MS)
      }
    }
  }
}

function dispatch(event: DeckEvent): void {
  const result = reduceDecks(get(decks), event)
  decks.set(result.state)
  apply(result.effects)
  applyGains(result.state)
}

async function materialise(deck: DeckId, trackId: string): Promise<boolean> {
  if (materialised[deck] === trackId) return true
  wanted[deck] = trackId
  const source = currentSource()
  const resolution = resolutionFor(trackId)
  if (source === null || resolution === undefined || resolution.kind !== 'playable') {
    const reason: UnplayableReason =
      resolution !== undefined && resolution.kind === 'unplayable' ? resolution.reason : 'no-source'
    deckError.update((e) => ({ ...e, [deck]: reason }))
    return false
  }
  try {
    const file = await source.fileFor(resolution.handle)
    // A newer click won while this one was reading the disk.
    if (wanted[deck] !== trackId) return false
    // Awaited: loadDeck fades a sounding deck down before it swaps `src`, so
    // the bytes are not in the element the instant the call returns.
    await engine.loadDeck(deck, file)
  } catch {
    deckError.update((e) => ({ ...e, [deck]: 'read-error' }))
    return false
  }
  if (wanted[deck] !== trackId) return false
  materialised[deck] = trackId
  return true
}

export async function togglePlay(deck: DeckId): Promise<void> {
  // First and synchronous: Safari wants the resume in the gesture's own task.
  engine.ensureContext()
  const trackId = get(decks)[deck]
  if (trackId === null) return
  // There is an await between the isPlaying check and the play() below, so a
  // second click during it would see a paused deck and issue a second play().
  if (busy[deck]) return
  busy[deck] = true
  try {
    if (engine.isPlaying(deck)) {
      engine.pause(deck)
      playing.update((p) => ({ ...p, [deck]: false }))
      return
    }
    cancelPreload(deck)
    if (!(await materialise(deck, trackId))) return
    // Before play(), so the element starts under a gain that is ramping up to
    // its commanded level rather than snapping to it: the fade-in IS the
    // de-click on the play side.
    applyGains(get(decks))
    await engine.play(deck)
    playing.update((p) => ({ ...p, [deck]: true }))
  } catch {
    deckError.update((e) => ({ ...e, [deck]: 'read-error' }))
  } finally {
    busy[deck] = false
  }
}

export function seekDeck(deck: DeckId, seconds: number): void {
  const landed = clampSeek(seconds, get(durations)[deck])
  engine.seek(deck, landed)
  positions.update((p) => ({ ...p, [deck]: landed }))
}

/**
 * Both pin and unpin recentre the fader (v29 #5). It was never reset, so
 * pinning with the fader parked off-centre stepped the surviving deck's level
 * in one ramp — and centre is the listening position for a comparison anyway.
 */
export function lockDeck(): void {
  crossfade.set(0)
  dispatch({ type: 'lock' })
}

export function unlockDeck(): void {
  crossfade.set(0)
  dispatch({ type: 'unlock' })
}

export function setCrossfade(position: number): void {
  crossfade.set(position)
  applyGains(get(decks))
}

function trackById(tracks: readonly Track[], id: string | null): Track | undefined {
  return id === null ? undefined : tracks.find((t) => t.id === id)
}

/** Called once from App.svelte, alongside startTheme / startAutosave / startUndo. */
export function startPlayer(): void {
  const scratch = new Audio()
  setProbe((mime) => scratch.canPlayType(mime) !== '')

  engine.onDeckEvent((deck, kind) => {
    if (kind === 'error') {
      // MEDIA_ERR_SRC_NOT_SUPPORTED is the authoritative answer canPlayType
      // could only guess at.
      const code = engine.errorCodeOf(deck)
      deckError.update((e) => ({ ...e, [deck]: code === 4 ? 'unsupported' : 'read-error' }))
      playing.update((p) => ({ ...p, [deck]: false }))
      return
    }
    if (kind === 'ended') playing.update((p) => ({ ...p, [deck]: false }))
    const { currentTime, duration } = engine.positionOf(deck)
    positions.update((p) => ({ ...p, [deck]: currentTime }))
    const track = trackById(get(library), get(decks)[deck])
    durations.update((d) => ({
      ...d,
      [deck]: resolveDuration(duration, track?.durationSec ?? null),
    }))
  })

  // The CLICK, not the selection (v29 #10). `selectedId` also moves for hub
  // picks, undo/redo, background clicks, Escape and project loads, and none of
  // those are the user asking to hear something — following it is what made a
  // stray click cut the music, and what the v28.1 latch was papering over.
  clickedTrackId.subscribe((id) => {
    if (id !== null) dispatch({ type: 'select', id })
  })
  library.subscribe((tracks) => {
    dispatch({ type: 'library', knownIds: new Set(tracks.map((t) => t.id)) })
    reindex()
  })

  settings.subscribe((s) => {
    // Turning the feature off must genuinely silence it, not just hide the
    // bar. The folder link survives — it is a property of this machine.
    if (!s.audioPreview && engine.hasContext()) {
      engine.dispose()
      cancelPreload('a')
      cancelPreload('b')
      materialised.a = null
      materialised.b = null
      wanted.a = null
      wanted.b = null
      decks.set(EMPTY_DECKS)
      playing.set({ a: false, b: false })
    }
  })

  void restoreSavedFolder()
}
