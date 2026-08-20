import type { DeckId } from '../../core/audio/decks'

/**
 * The audio graph, as a module singleton:
 *
 *   audio0 ─ MediaElementAudioSourceNode ─ gain0 ─┐
 *                                                 ├─ limiter ─ destination
 *   audio1 ─ MediaElementAudioSourceNode ─ gain1 ─┘
 *
 * `<audio>` + createMediaElementSource rather than decodeAudioData: decoding a
 * ten-minute FLAC would cost ~100 MB and a multi-second stall, and we get
 * currentTime, duration and seeking for free by streaming.
 *
 * Nothing here may go inside `$state` — a deep Svelte proxy swallows writes
 * meant for third-party objects, and these are all third-party objects.
 */

/**
 * Which element currently plays which deck. `promote()` swaps this rather than
 * reloading, so the pinned track keeps playing at its exact position.
 */
let roles: Record<DeckId, 0 | 1> = { a: 0, b: 1 }

let context: AudioContext | null = null
let elements: [HTMLAudioElement, HTMLAudioElement] | null = null
let gains: [GainNode, GainNode] | null = null
let limiter: DynamicsCompressorNode | null = null
const urls: [string | null, string | null] = [null, null]

export type DeckEventKind = 'time' | 'meta' | 'ended' | 'error'
type Listener = (deck: DeckId, kind: DeckEventKind) => void
const listeners = new Set<Listener>()

function deckOf(slot: 0 | 1): DeckId {
  return roles.a === slot ? 'a' : 'b'
}

function emit(slot: 0 | 1, kind: DeckEventKind) {
  for (const listener of listeners) listener(deckOf(slot), kind)
}

/**
 * Build the graph if it does not exist, and resume it.
 *
 * MUST be the first SYNCHRONOUS statement of a click handler: Safari wants the
 * resume in the same task as the gesture, before any await. And a routed
 * element emits NOTHING while the context is suspended — no error, no clue —
 * so Chrome's auto-suspend after a long silence means resume() runs on every
 * play, not just the first.
 */
export function ensureContext(): void {
  if (context === null) {
    context = new AudioContext()
    // The crossfade curve holds BOTH decks at unity in the centre, so the sum
    // of two modern club masters is well over full scale and would hard-clip
    // at the destination — audible crunch at exactly the position the fader
    // exists for. A near-brickwall limiter on the output bus answers that
    // without a trim, which would have undone the curve. One deck alone only
    // touches it on true peaks. Both decks share the node, so its ~6 ms of
    // latency cannot pull them out of alignment with each other.
    limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.1
    limiter.connect(context.destination)
    const built: HTMLAudioElement[] = []
    const builtGains: GainNode[] = []
    for (const slot of [0, 1] as const) {
      const element = new Audio()
      element.preload = 'metadata'
      element.addEventListener('timeupdate', () => emit(slot, 'time'))
      element.addEventListener('loadedmetadata', () => emit(slot, 'meta'))
      element.addEventListener('ended', () => emit(slot, 'ended'))
      element.addEventListener('error', () => emit(slot, 'error'))
      const gain = context.createGain()
      // Once per element, EVER. A second call throws InvalidStateError and
      // permanently bricks the element — which is why loading a track only
      // ever swaps `src` and never builds a new one.
      context.createMediaElementSource(element).connect(gain)
      gain.connect(limiter)
      built.push(element)
      builtGains.push(gain)
    }
    elements = [built[0], built[1]]
    gains = [builtGains[0], builtGains[1]]
  }
  void context.resume()
}

export function onDeckEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function loadDeck(deck: DeckId, file: File): void {
  if (elements === null) return
  const slot = roles[deck]
  const element = elements[slot]
  element.pause()
  const next = URL.createObjectURL(file)
  const previous = urls[slot]
  element.src = next
  element.load()
  urls[slot] = next
  // Revoke only after the new src has landed, so the element is never pointed
  // at a URL that has already been freed.
  if (previous !== null) URL.revokeObjectURL(previous)
}

export function clearDeck(deck: DeckId): void {
  if (elements === null) return
  const slot = roles[deck]
  const element = elements[slot]
  element.pause()
  element.removeAttribute('src')
  element.load()
  const previous = urls[slot]
  urls[slot] = null
  if (previous !== null) URL.revokeObjectURL(previous)
}

/** Swap which element is deck A. No reload: the playing element keeps going. */
export function promote(): void {
  roles = { a: roles.b, b: roles.a }
}

export async function play(deck: DeckId): Promise<void> {
  if (elements === null) return
  await elements[roles[deck]].play()
}

export function pause(deck: DeckId): void {
  elements?.[roles[deck]].pause()
}

export function seek(deck: DeckId, seconds: number): void {
  if (elements === null) return
  elements[roles[deck]].currentTime = seconds
}

export function isPlaying(deck: DeckId): boolean {
  const element = elements?.[roles[deck]]
  return element !== undefined && !element.paused && !element.ended
}

export function positionOf(deck: DeckId): { currentTime: number; duration: number } {
  const element = elements?.[roles[deck]]
  return element === undefined
    ? { currentTime: 0, duration: NaN }
    : { currentTime: element.currentTime, duration: element.duration }
}

/** MEDIA_ERR_SRC_NOT_SUPPORTED is 4, MEDIA_ERR_DECODE is 3. */
export function errorCodeOf(deck: DeckId): number | null {
  return elements?.[roles[deck]].error?.code ?? null
}

/**
 * Apply the gains the pure crossfade curve computed. setTargetAtTime rather
 * than a bare assignment: no ramp bookkeeping, and no zipper noise under a
 * fast slider drag.
 */
export function setGains(a: number, b: number): void {
  if (context === null || gains === null) return
  gains[roles.a].gain.setTargetAtTime(a, context.currentTime, 0.01)
  gains[roles.b].gain.setTargetAtTime(b, context.currentTime, 0.01)
}

/**
 * Turning the feature off must genuinely silence it, not just hide the bar.
 *
 * `listeners` deliberately survives: the set belongs to the STORE's lifetime,
 * not the graph's — playerStore registers its deck-event listener exactly once
 * at app start, so clearing it here left the rebuilt graph emitting
 * loadedmetadata/timeupdate to nobody after the feature was toggled back on.
 * The symptom (v28.2): duration missing and the seek line dead, while
 * play/pause still worked because togglePlay writes the playing store itself.
 */
export function dispose(): void {
  clearDeck('a')
  clearDeck('b')
  void context?.close()
  context = null
  elements = null
  gains = null
  limiter = null
  roles = { a: 0, b: 1 }
}

/** Whether the graph exists yet — it only can once a gesture has paid for it. */
export function hasContext(): boolean {
  return context !== null
}
