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

/**
 * The level each SLOT has been asked to sit at, so a de-click duck can fade
 * back to the right value instead of assuming 1. Indexed by slot, not by deck,
 * because a promote moves the letters and not the nodes — an element keeps its
 * level across a role swap, which is what makes the swap inaudible.
 *
 * Initialised to the GainNode default so a duck before the first `setGains`
 * cannot silence a deck.
 */
const commanded: [number, number] = [1, 1]
/** Ducks in flight per slot, so overlapping ones cannot restore early. */
const ducks: [number, number] = [0, 0]

/** Fade down before a discontinuity, fade back after it. Milliseconds. */
const DUCK_MS = 8
const RESTORE_MS = 14
/** Crossfade / play-in ramp. Long enough to have no edge, short enough to feel instant. */
const GAIN_RAMP_MS = 20

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
    // `latencyHint: 'playback'` asks for a LARGE render buffer (v29 #5). The
    // default 'interactive' asks for the smallest one the device will give,
    // which is right for an instrument and wrong here: nothing in this app
    // responds to input in real time, and the main thread is busy painting a
    // wheel of up to 500 SVG stars under d3 zoom. A starved render quantum is
    // a dropout, and a dropout is the random mid-track crack.
    context = new AudioContext({ latencyHint: 'playback' })
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
      // Cheap while the deck is empty; `loadDeck` raises it to 'auto' once
      // there is a file, so the element buffers ahead of the playhead instead
      // of streaming from cold off a slow external drive.
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

/**
 * Move one slot's gain to `value` over `ms`, from wherever the parameter
 * actually is right now.
 *
 * cancel + setValueAtTime + linearRamp, NOT a bare `setTargetAtTime` (v29 #5):
 * an exponential approach never arrives, and every fader `oninput` used to
 * stack another one on top of the last, so the level chased a moving target it
 * never reached.
 */
function rampTo(slot: 0 | 1, value: number, ms: number): void {
  if (context === null || gains === null) return
  const param = gains[slot].gain
  const now = context.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(value, now + ms / 1000)
}

/**
 * Silence a slot, do the thing that would otherwise click, fade it back.
 *
 * Pausing, seeking and swapping `src` all stop the waveform dead at whatever
 * sample it was on. That step discontinuity is the click Michiel hears on
 * play / pause / track change (v29 #5); a few milliseconds of fade on either
 * side removes it entirely.
 *
 * A PAUSED element cannot click, so it is acted on synchronously — which also
 * keeps the common `load then play` path free of any deferral. The returned
 * promise resolves once the action has actually run, so a caller that needs to
 * play the file it just loaded can await it.
 */
function whileSilenced(slot: 0 | 1, action: () => void): Promise<void> {
  const element = elements?.[slot]
  if (context === null || gains === null || element === undefined || element.paused) {
    action()
    return Promise.resolve()
  }
  ducks[slot] += 1
  rampTo(slot, 0, DUCK_MS)
  return new Promise((resolve) => {
    setTimeout(() => {
      action()
      ducks[slot] -= 1
      if (ducks[slot] === 0) rampTo(slot, commanded[slot], RESTORE_MS)
      resolve()
    }, DUCK_MS + 4)
  })
}

export function loadDeck(deck: DeckId, file: File): Promise<void> {
  if (elements === null) return Promise.resolve()
  const slot = roles[deck]
  const element = elements[slot]
  return whileSilenced(slot, () => {
    element.pause()
    element.preload = 'auto'
    const next = URL.createObjectURL(file)
    const previous = urls[slot]
    // Assigning `src` already runs the resource-selection algorithm; the
    // explicit `load()` that used to follow ran it a SECOND time, tearing the
    // media pipeline down and rebuilding it under whatever the other deck was
    // playing (v29 #5).
    element.src = next
    urls[slot] = next
    // Revoke only after the new src has landed, so the element is never pointed
    // at a URL that has already been freed.
    if (previous !== null) URL.revokeObjectURL(previous)
  })
}

/** The synchronous core of clearDeck, for teardown paths that cannot wait. */
function clearSlot(slot: 0 | 1): void {
  if (elements === null) return
  const element = elements[slot]
  element.pause()
  element.removeAttribute('src')
  // Required here, unlike in loadDeck: removing the attribute is not itself a
  // resource selection, so without this the element keeps the old media open.
  element.load()
  element.preload = 'metadata'
  const previous = urls[slot]
  urls[slot] = null
  if (previous !== null) URL.revokeObjectURL(previous)
}

export function clearDeck(deck: DeckId): void {
  if (elements === null) return
  const slot = roles[deck]
  void whileSilenced(slot, () => clearSlot(slot))
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
  if (elements === null) return
  const slot = roles[deck]
  void whileSilenced(slot, () => elements?.[slot].pause())
}

export function seek(deck: DeckId, seconds: number): void {
  if (elements === null) return
  const slot = roles[deck]
  void whileSilenced(slot, () => {
    if (elements !== null) elements[slot].currentTime = seconds
  })
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

/** The media element's own verdict: 1 aborted, 2 network, 3 decode, 4 unsupported. */
export function errorCodeOf(deck: DeckId): number | null {
  return elements?.[roles[deck]].error?.code ?? null
}

/**
 * Apply the gains the pure crossfade curve computed.
 *
 * The commanded value is recorded even while a duck is in flight, so the
 * duck's own restore lands on the new level rather than the stale one — and it
 * does not fight the fade by ramping over the top of it.
 */
export function setGains(a: number, b: number): void {
  if (context === null || gains === null) return
  commandGain(roles.a, a)
  commandGain(roles.b, b)
}

function commandGain(slot: 0 | 1, value: number): void {
  commanded[slot] = value
  if (ducks[slot] === 0) rampTo(slot, value, GAIN_RAMP_MS)
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
 *
 * The clears are the synchronous ones: a deferred de-click fade would land
 * after the context is closed and the nodes are gone.
 */
export function dispose(): void {
  clearSlot(0)
  clearSlot(1)
  void context?.close()
  context = null
  elements = null
  gains = null
  limiter = null
  roles = { a: 0, b: 1 }
  commanded[0] = 1
  commanded[1] = 1
  ducks[0] = 0
  ducks[1] = 0
}

/** Whether the graph exists yet — it only can once a gesture has paid for one. */
export function hasContext(): boolean {
  return context !== null
}
