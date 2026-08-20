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
import { library, selectedId, settings } from '../../stores'
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
      materialised.a = materialised.b
      materialised.b = null
    } else if (effect.kind === 'clear') {
      engine.clearDeck(effect.deck)
      materialised[effect.deck] = null
      resetDeckUi(effect.deck)
    } else {
      resetDeckUi(effect.deck)
      // Only pre-load once a gesture has paid for the graph; before that the
      // first play click materialises it.
      if (engine.hasContext()) void materialise(effect.deck, effect.trackId)
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
  const source = currentSource()
  const resolution = resolutionFor(trackId)
  if (source === null || resolution === undefined || resolution.kind !== 'playable') {
    const reason: UnplayableReason =
      resolution !== undefined && resolution.kind === 'unplayable' ? resolution.reason : 'no-source'
    deckError.update((e) => ({ ...e, [deck]: reason }))
    return false
  }
  try {
    engine.loadDeck(deck, await source.fileFor(resolution.handle))
  } catch {
    deckError.update((e) => ({ ...e, [deck]: 'read-error' }))
    return false
  }
  materialised[deck] = trackId
  return true
}

export async function togglePlay(deck: DeckId): Promise<void> {
  // First and synchronous: Safari wants the resume in the gesture's own task.
  engine.ensureContext()
  const trackId = get(decks)[deck]
  if (trackId === null) return
  if (engine.isPlaying(deck)) {
    engine.pause(deck)
    playing.update((p) => ({ ...p, [deck]: false }))
    return
  }
  if (!(await materialise(deck, trackId))) return
  applyGains(get(decks))
  try {
    await engine.play(deck)
    playing.update((p) => ({ ...p, [deck]: true }))
  } catch {
    deckError.update((e) => ({ ...e, [deck]: 'read-error' }))
  }
}

export function seekDeck(deck: DeckId, seconds: number): void {
  const landed = clampSeek(seconds, get(durations)[deck])
  engine.seek(deck, landed)
  positions.update((p) => ({ ...p, [deck]: landed }))
}

export function lockDeck(): void {
  dispatch({ type: 'lock' })
}

export function unlockDeck(): void {
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

  selectedId.subscribe((id) => dispatch({ type: 'select', id }))
  library.subscribe((tracks) => {
    dispatch({ type: 'library', knownIds: new Set(tracks.map((t) => t.id)) })
    reindex()
  })

  settings.subscribe((s) => {
    // Turning the feature off must genuinely silence it, not just hide the
    // bar. The folder link survives — it is a property of this machine.
    if (!s.audioPreview && engine.hasContext()) {
      engine.dispose()
      materialised.a = null
      materialised.b = null
      decks.set(EMPTY_DECKS)
      playing.set({ a: false, b: false })
    }
  })

  void restoreSavedFolder()
}
