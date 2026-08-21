<script lang="ts">
  import { scaleLinear } from 'd3-scale'
  import { untrack } from 'svelte'
  import { cubicOut, linear } from 'svelte/easing'
  import { Tween } from 'svelte/motion'
  import { fade, scale } from 'svelte/transition'
  import { captureDisplaced, numericMapsEqual } from '../core/displaced'
  import { ghostWalkIds } from '../core/ghosts'
  import { classIndexOfTrack } from '../core/iconClasses'
  import { ALL_CAMELOT_KEYS, camelotNumber, wheelSlotAngleDeg, type CamelotKey } from '../core/keys'
  import {
    annularSectorPath,
    gutterSlotX,
    lowerArcPath,
    relaxSlotAngles,
    spreadHalfDeg,
  } from '../core/layout'
  import type { Track } from '../core/model'
  import {
    RADIAL_MORPH_TOTAL_MS,
    radialMorphDelays,
    radialMorphProgress,
  } from '../core/radialMorph'
  import {
    COLOR_SCHEMES,
    focusEdgeOpacity,
    makeNodeColor,
    MISSING_COLORS,
    radialDomain,
  } from '../core/scales'
  import { createShapePathCache } from './shapeSymbols'
  import { createViewZoom } from './viewZoom'
  import { effectiveTheme } from './theme'
  import { motionMs } from './motion'
  import { decks as playerDecks, playing as playerPlaying } from './audio/playerStore'
  import { nextExhausted, retryState, suggestNext, type NextSuggestion } from '../core/suggest'
  import {
    addTrackToSet,
    effectiveCriteria,
    effectiveColorAxis,
    effectiveFilters,
    effectiveManualEdges,
    effectiveSettings,
    focusEdges,
    hoveredId,
    iconClasses,
    library,
    mustInclude,
    comboComplete,
    neighbours,
    pinnedFirst,
    pinnedLast,
    playlistScopedLibrary,
    radialAxis,
    type RadialAxis,
    rightPanel,
    selectedId,
    tracklist,
    visibleLibrary,
    walkRevealRange,
    walkRevealSeen,
    walkRevealTick,
    selectOrLink,
  } from '../stores'
  import {
    WALK_CHEVRON_D,
    WALK_CHEVRON_REF,
    WALK_CHEVRON_SIZE,
    WALK_CHEVRON_STROKE,
    WALK_CHEVRON_VIEW_BOX,
    walkChevronMid,
  } from '../core/walkArrow'
  import { walkRevealPlan } from '../core/walkReveal'

  const SIZE = 820
  const WIDTH = SIZE + 80 // extra room for the no-key gutter on the right
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R_MAX = 330
  const R_MIN = 110
  const R_FALLBACK = 70 // dashed inner circle: keyed tracks missing the radial value
  const GUTTER_X = SIZE + 26 // vertical strip for tracks with no key
  const GUTTER_MISSING_Y_GAP = 42

  const AXIS_LABEL = { bpm: 'BPM', rating: 'rating', year: 'year', energy: 'energy' } as const

  // Genre-class node shapes (docs/designs/design-v4.md §E): class 0 (largest)
  // keeps the circle; further classes get increasingly angular symbols. The
  // symbol list + path cache are shared with the genre map (src/lib/shapeSymbols).
  const shapePath = createShapePathCache()
  function classIndexOf(track: Track): number | null {
    return classIndexOfTrack($iconClasses, track)
  }

  interface PlacedNode {
    track: Track
    x: number
    y: number
    unkeyed: boolean
    missingRadial: boolean
  }

  let hovered: PlacedNode | null = $state(null)
  let mouse = $state({ x: 0, y: 0 })

  function polar(angleDeg: number, r: number): { x: number; y: number } {
    const rad = ((angleDeg - 90) * Math.PI) / 180 // 0° at 12 o'clock, clockwise
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  // The radial axis is the one part of the frame that rescales: its domain
  // follows the active filter for the radial metric, falling back to the
  // playlist selection's extent (design-v6 §A). Everything else — angles,
  // symbols, colour domain — stays put. The domain is niced up front and its
  // endpoints tweened, so rings, ticks and nodes glide instead of jumping.
  const radialValues = $derived(
    $playlistScopedLibrary.map((t) => t[$radialAxis]).filter((v): v is number => v !== null),
  )

  // The radial axes are all number-kind properties; narrow the stored range
  // (v11 issue 1: filters carry a per-property map) for the domain maths.
  const radialFilterRange = $derived.by((): [number, number] | null => {
    const range = $effectiveFilters.properties[$radialAxis]
    return Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number'
      ? [range[0], range[1]]
      : null
  })

  const targetDomain = $derived.by((): [number, number] => {
    const extent: [number, number] | null =
      radialValues.length === 0 ? null : [Math.min(...radialValues), Math.max(...radialValues)]
    const domain = radialDomain(radialFilterRange, extent)
    // Nice once here (not per animation frame — nicing interpolated
    // endpoints would make the tween judder in rounded steps).
    return scaleLinear().domain(domain).nice().domain() as [number, number]
  })

  // Deliberately seeds the tween with the initial domain (no mount
  // animation); the $effect below keeps it tracking changes.
  // 600ms reads noticeably calmer than the original 350 (issue 5). Aliased
  // from radialMorph.ts's own constant (not a second independent 600)
  // because the per-node morph and this domain tween must settle in the
  // same instant — see the $effect below and radialMorph.ts's own doc
  // comment for why (v18 #11a fix round 1: IMPORTANT).
  const RADIAL_TWEEN_MS = RADIAL_MORPH_TOTAL_MS
  // svelte-ignore state_referenced_locally
  const domainTween = new Tween<[number, number]>(targetDomain, {
    duration: RADIAL_TWEEN_MS,
    easing: cubicOut,
  })
  $effect(() => {
    // motionMs-wrapped (v18 #11a fix round 1: CRITICAL), not the plain
    // `domainTween.target = targetDomain` setter this used to be — that
    // setter always animates over the constructor's fixed duration, with no
    // way to override it per call. Under reduced motion this MUST snap in
    // the same flush as morphTween's own instant landing (below): if this
    // tween kept animating over a real 600ms while morphTween (and the
    // landing $effect that watches it) snapped instantly, nodes would fall
    // back to radialScale(newAxisValue) against a domain still sliding from
    // the OLD axis's range the moment the morph state clears — the exact
    // rim-pinning mismatch this whole feature exists to fix, reproduced
    // specifically when the user asked for LESS motion. Same duration
    // either way (motionMs is a no-op unless reduced motion is on), so this
    // is not a behaviour change for same-axis filter-edit tweens beyond
    // also finally respecting reduced motion, which they never did before.
    void domainTween.set(targetDomain, { duration: motionMs(RADIAL_TWEEN_MS), easing: cubicOut })
  })

  // Clamped: mid-tween (and for filtered-out tracks that are placed but
  // never rendered) values outside the domain must not overshoot the band.
  const radialScale = $derived(
    scaleLinear().domain(domainTween.current).range([R_MIN, R_MAX]).clamp(true),
  )

  // Ratings and years are inherently whole — a ring at "4.6 stars" means
  // nothing, so fractional ticks are dropped for those axes (remark 14).
  // Tick values come from the settled target domain (labels don't churn
  // mid-animation); their positions ride the animated scale.
  const gridTicks = $derived.by(() => {
    if (radialValues.length === 0 && radialFilterRange === null) return []
    const ticks = scaleLinear().domain(targetDomain).ticks(4)
    return $radialAxis === 'bpm' ? ticks : ticks.filter(Number.isInteger)
  })

  /** Same scale as the wheel radius, mapped onto the vertical gutter strip. */
  function gutterY(value: number): number {
    return CY - (radialScale(value) - (R_MIN + R_MAX) / 2)
  }
  const gutterTop = $derived(CY - (R_MAX - R_MIN) / 2)
  const gutterBottom = $derived(CY + (R_MAX - R_MIN) / 2)

  // Same-key tracks repel each other along their slot's arc instead of the
  // old seeded fan (issue 17): each node keeps its exact radius, offsets stay
  // inside ±(7.5° × spread). Angles are computed against the SETTLED target
  // domain, so the relaxation runs once per real change while the radii ride
  // the tween. The drawn node radius is 5 world units at reference zoom.
  const NODE_WORLD_RADIUS = 5
  const slotAngleById = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const angles = new Map<string, number>()
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const bySlot = new Map<CamelotKey, Track[]>()
    for (const track of $library) {
      if (track.key === null) continue
      if (!bySlot.has(track.key)) bySlot.set(track.key, [])
      bySlot.get(track.key)!.push(track)
    }
    const targetScale = scaleLinear().domain(targetDomain).range([R_MIN, R_MAX]).clamp(true)
    // Fan-out half-window (v14 W4): factor 0→0°, 1→±4° (the historic look),
    // up to 2→ the ±7.5° wedge edge minus the node's angular radius. The
    // group's MINIMUM radius is the most constraining (largest angular
    // radius), so one deterministic half-window keeps relaxSlotAngles
    // single-valued per group.
    const factor = $effectiveSettings.slotSpreadFactor
    for (const [key, group] of bySlot) {
      const slotNodes = group.map((track) => {
        const value = track[$radialAxis]
        return { id: track.id, r: value === null ? R_FALLBACK : targetScale(value) }
      })
      const minRadius = Math.min(...slotNodes.map((n) => n.r))
      const half = spreadHalfDeg(factor, NODE_WORLD_RADIUS, minRadius)
      const offsets = relaxSlotAngles(slotNodes, half, NODE_WORLD_RADIUS)
      const base = wheelSlotAngleDeg(key)
      for (const [id, offset] of offsets) angles.set(id, base + offset)
    }
    return angles
  })

  // --- v18 #11a: per-node radial morph on an axis swap ---
  // An axis swap (BPM→Rating etc.) changes every track's radial VALUE
  // instantly, while the domain tween above is still sliding from the old
  // axis's numeric range to the new one — reading radialScale(newValue)
  // against that mid-flight, wrong-units domain is exactly what pinned
  // nodes to the rim until the tween caught up (the bug this task fixes).
  // Fix: while a swap is in flight, node placement never touches
  // radialScale/domainTween at all — each node glides its own settled
  // scalar (radius if keyed, gutter y if not) from where it stood to where
  // the new axis puts it, on its own eased 0..1 timeline
  // (radialMorphProgress), staggered clockwise from 12 o'clock
  // (radialMorphDelays). domainTween keeps animating the rings/ticks
  // exactly as before — same duration, so the two settle together — and
  // stays the whole mechanism for same-axis (filter) domain changes; this
  // block only ever affects node placement.

  /** A keyed track's settled radius under a given axis + (already-niced)
   * domain — the same maths as `radialScale`, parameterised so it can be
   * evaluated against an arbitrary domain instead of the live tween. */
  function settledRadiusOf(track: Track, axis: RadialAxis, domain: [number, number]): number {
    const value = track[axis]
    return value === null
      ? R_FALLBACK
      : scaleLinear().domain(domain).range([R_MIN, R_MAX]).clamp(true)(value)
  }
  /** Gutter analogue of settledRadiusOf, for unkeyed tracks. */
  function settledGutterYOf(track: Track, axis: RadialAxis, domain: [number, number]): number {
    const value = track[axis]
    if (value === null) return gutterBottom + GUTTER_MISSING_Y_GAP
    return CY - (settledRadiusOf(track, axis, domain) - (R_MIN + R_MAX) / 2)
  }

  /** Sort order for unkeyed (gutter) tracks: missing radial values fall back
   * to -1 (grouped together, low priority), ties break by id for
   * determinism. Shared between gutterTargetXById below (which settled band
   * + fan index a track gets) and the nodes derived's own gutter paint pass
   * — the two MUST stay identical, or a track's slot index here could
   * disagree with where it's actually drawn. */
  function compareGutterTracks(a: Track, b: Track): number {
    return (b[$radialAxis] ?? -1) - (a[$radialAxis] ?? -1) || a.id.localeCompare(b.id)
  }

  /** Gutter analogue of slotAngleById (v20 #3): settled x-slot per unkeyed
   * track, banded on each track's SETTLED gutter y — never the animated one
   * `nodes` renders each frame. The old per-frame version banded on
   * animated y, so band membership (and each member's fan index within it)
   * could flip mid-glide, snapping a settled neighbour sideways in 14px
   * steps for no reason visible in the data — see gutterSlotX's own doc
   * comment (src/core/layout.ts) for the full story. Settling the grouping
   * here and letting the DISPLAYED x glide toward it via displacedScalar
   * (below) is the fix; y itself is untouched. */
  const gutterTargetXById = $derived.by(() => {
    const unkeyed = $library.filter((t) => t.key === null).sort(compareGutterTracks)
    return gutterSlotX(
      unkeyed.map((t) => ({ id: t.id, y: settledGutterYOf(t, $radialAxis, targetDomain) })),
      GUTTER_X,
    )
  })

  const morphTween = new Tween(0, { duration: RADIAL_MORPH_TOTAL_MS, easing: linear })
  // Per-node from scalar and start delay, all keyed by track id; null
  // outside a swap's morph window, when `nodes` below takes the plain
  // radialScale/gutterY path exactly as before (byte-identical steady
  // state). Reassigned wholesale on every swap and on landing, never
  // mutated in place — Map identity is what `nodes`'s $derived reacts to.
  let morphFrom: Map<string, number> | null = $state(null)
  // The axis the active morph is heading TOWARD — morphedScalar (used for
  // rendering) recomputes each node's destination LIVE against this axis
  // and the CURRENT targetDomain every time it's called, rather than
  // reading a value frozen at swap-start (v18 #11a fix round 1: MINOR).
  // Otherwise a filter edit mid-morph would retarget domainTween (and the
  // rings) immediately while nodes kept gliding toward the stale
  // pre-edit target, then jumped to the correct spot the instant the morph
  // landed and handed off to the (already-current) plain path.
  let morphAxis: RadialAxis | null = $state(null)
  // A FROZEN snapshot of morphAxis's destination at swap-start — unlike the
  // live recomputation above, this one is deliberately NOT kept live: it
  // exists solely so a second swap interrupting this one (below) can ask
  // "where was this morph's own `to` when it started", which can't be
  // recovered any other way once $radialAxis has already moved on to the
  // new value. A live "to" needs domainTween.current or a moment-old
  // targetDomain either way (see the untrack block below); reusing the
  // frozen snapshot for that one purpose is simpler than also inventing a
  // second history-tracking mechanism just for it.
  let morphTo: Map<string, number> | null = $state(null)
  let morphDelays: Map<string, number> | null = $state(null)

  // --- v20 #2: the "displaced scalar" mechanism (src/core/displaced.ts) ---
  // The slot ANGLE above rode straight off slotAngleById every frame — fine
  // once settled, but a hard SNAP the instant that map changed: an axis
  // swap (angle changes too — see slotAngleById's own targetScale), a
  // radial range-filter edit, a playlist switch, easy-mode, the spread
  // slider. Unlike the radius above, it had no animation channel of its
  // own. Fix: angleFrom captures the angle each node was actually SHOWING a
  // moment before its target moved (captureDisplaced), and nodes glide from
  // there — displacedProgress/displacedScalar below. displacedChannel picks
  // which clock drives that glide: 'morph' rides the SAME per-node
  // radialMorphProgress the radius uses during a swap (angle and radius
  // arrive together, node by node); 'plain' is a new uniform 0..1 tween for
  // every other kind of change. null once settled — the byte-identical
  // steady-state path, same convention as morphFrom above. gutterXFrom (v20
  // #3) is the gutter x's own displaced channel, riding the SAME two
  // clocks as angleFrom — see gutterTargetXById above and the unkeyed loop
  // in `nodes` below.
  let angleFrom: Map<string, number> | null = $state(null)
  let gutterXFrom: Map<string, number> | null = $state(null)
  let displacedChannel: 'morph' | 'plain' = $state('plain')
  const displacedTween = new Tween(1, { duration: RADIAL_TWEEN_MS, easing: cubicOut })
  // Plain-variable mirrors of the PREVIOUS target maps (slotAngleById,
  // gutterTargetXById) — the same stale-intermediate guard as
  // previousRadialAxis below, needed because the merged capture effect
  // (below) must compare against what was on screen a moment ago, not the
  // live $derived value it just read.
  // svelte-ignore state_referenced_locally
  let prevSlotAngles: Map<string, number> = slotAngleById
  // svelte-ignore state_referenced_locally
  let prevGutterX: Map<string, number> = gutterTargetXById

  // The axis just before the current one. Plain (non-reactive) variable by
  // design, the same way `insertAnchor` above tracks "the selection before
  // this click": $radialAxis inside the effect below always reads the NEW
  // value, so the old one has to be remembered by hand between runs.
  let previousRadialAxis: RadialAxis = $radialAxis

  // Owns ALL capture for the displaced-scalar mechanism above (angle AND
  // gutter x): one effect, not more (separate effects would race writing
  // the shared prevSlotAngles/prevGutterX/angleFrom/gutterXFrom mirrors).
  // It tracks slotAngleById AND
  // gutterTargetXById on EVERY run, not just when the axis changes — the
  // old early-return here used to sit before those reads, so a same-axis
  // change (filter edit, spread slider, playlist switch) never reran this
  // effect at all.
  $effect(() => {
    const axis = $radialAxis
    const slots = slotAngleById
    const gutterX = gutterTargetXById
    const swap = axis !== previousRadialAxis
    const anglesChanged = !numericMapsEqual(slots, prevSlotAngles)
    const gutterChanged = !numericMapsEqual(gutterX, prevGutterX)
    if (!swap && !anglesChanged && !gutterChanged) {
      // Same axis, and either nothing about the angles/gutter x moved, or
      // the target maps merely rebuilt (fresh Map, e.g. from an unrelated
      // $effectiveSettings emission) with identical values —
      // numericMapsEqual is load-bearing here: without it, that no-op
      // rebuild would restart an in-flight glide's clock for nothing.
      prevSlotAngles = slots
      prevGutterX = gutterX
      return
    }
    const oldAxis = previousRadialAxis
    previousRadialAxis = axis

    // Untracked: a snapshot of whatever's on screen this instant, not a
    // dependency of THIS effect — reading any of these live (outside
    // untrack) would make the effect re-fire on every animation frame of
    // whichever tween is running, instead of once per swap/angle change
    // (the `nodes` $derived below is the intended per-frame reader of every
    // tween here).
    const old = untrack(() => ({
      from: morphFrom,
      to: morphTo,
      delays: morphDelays,
      t: morphTween.current,
      domain: domainTween.current,
      angleFrom,
      gutterXFrom,
      channel: displacedChannel,
      plainT: displacedTween.current,
    }))
    /** The displaced channel's OWN old progress for a node — the clock the
     * captured value (angle or gutter x) rode a moment ago, whichever one
     * that was. */
    const oldProgress = (id: string): number =>
      old.channel === 'morph' && old.delays !== null
        ? radialMorphProgress(old.t, old.delays.get(id) ?? 0)
        : old.plainT

    // Capture BEFORE any new state applies, against the OLD target mirrors
    // (prevSlotAngles/prevGutterX): by the time this effect body runs,
    // slotAngleById/gutterTargetXById themselves have already recomputed
    // for whatever just changed — these are the one place that still
    // remembers what was on screen a moment ago.
    const capturedAngles = captureDisplaced(prevSlotAngles, old.angleFrom, oldProgress)
    const capturedGutterX = captureDisplaced(prevGutterX, old.gutterXFrom, oldProgress)
    prevSlotAngles = slots
    prevGutterX = gutterX

    if (swap) {
      const domain = targetDomain // the NEW axis's settled (niced) target
      const trackList = $library

      /** Each node's own current on-screen RADIUS (or gutter-y) scalar, a
       * moment before this swap — the angle's own capture already
       * happened above; this one still only feeds morphFrom/morphTo. */
      const currentScalar = (track: Track, unkeyed: boolean): number => {
        const fromValue = old.from?.get(track.id)
        const toValue = old.to?.get(track.id)
        if (old.from && old.to && fromValue !== undefined && toValue !== undefined) {
          // Rapid mid-morph swap: restart FROM the interrupted morph's own
          // live lerp (the currently-rendered position), not its stale
          // settled value — otherwise the node would jump to where it would
          // have been at rest, not where it visually is right now.
          const delay = old.delays?.get(track.id) ?? 0
          return lerp(fromValue, toValue, radialMorphProgress(old.t, delay))
        }
        // Steady state (or a node the interrupted morph never covered, e.g.
        // added to the library mid-flight): old.domain is exactly the
        // domain nodes were rendered with a moment ago, settled or not.
        return unkeyed
          ? settledGutterYOf(track, oldAxis, old.domain)
          : settledRadiusOf(track, oldAxis, old.domain)
      }

      // Built fresh and assigned to morphFrom/morphTo wholesale below, never
      // mutated in place once stored — same "plain Map on purpose" reasoning
      // as gutterTargetXById/gutterSlotX above (derived-local temporaries,
      // rebuilt wholesale; reactivity lives in the $derived/$state alone).
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh, assigned wholesale below
      const from = new Map<string, number>()
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh, assigned wholesale below
      const to = new Map<string, number>()
      const angleNodes: { id: string; angleDeg: number | null }[] = []
      for (const track of trackList) {
        const unkeyed = track.key === null
        from.set(track.id, currentScalar(track, unkeyed))
        to.set(
          track.id,
          unkeyed ? settledGutterYOf(track, axis, domain) : settledRadiusOf(track, axis, domain),
        )
        angleNodes.push({ id: track.id, angleDeg: unkeyed ? null : (slots.get(track.id) ?? null) })
      }

      morphFrom = from
      morphTo = to
      morphAxis = axis
      morphDelays = radialMorphDelays(angleNodes)
      angleFrom = capturedAngles
      gutterXFrom = capturedGutterX
      displacedChannel = 'morph'
      void displacedTween.set(1, { duration: 0 }) // park the plain clock, settled
      void morphTween.set(0, { duration: 0 })
      void morphTween.set(1, { duration: motionMs(RADIAL_MORPH_TOTAL_MS), easing: linear })
    } else {
      // Same axis: only the angle and/or gutter x moved (a filter edit, the
      // spread slider, a playlist switch reshaping same-key groups or the
      // gutter order...). Glide them together, on the plain uniform clock —
      // the radius/gutter-y morph channel above is untouched.
      angleFrom = capturedAngles
      gutterXFrom = capturedGutterX
      displacedChannel = 'plain'
      void displacedTween.set(0, { duration: 0 })
      void displacedTween.set(1, { duration: motionMs(RADIAL_TWEEN_MS), easing: cubicOut })
    }
  })

  // Landed: hand placement back to the plain radialScale/gutterY path, so it
  // keeps tracking any LATER filter-driven domain change (a morph that never
  // cleared would freeze nodes at their swap-time target forever).
  $effect(() => {
    if (morphFrom !== null && morphAxis !== null && morphTween.current >= 1) {
      morphFrom = null
      morphTo = null
      morphAxis = null
      morphDelays = null
      // Only when the displaced channel is STILL 'morph': a filter edit
      // landing mid-morph moves angleFrom/gutterXFrom onto displacedTween
      // instead (the `else` branch of the merged capture effect above),
      // still flying — the plain twin landing effect below clears them in
      // that case.
      if (displacedChannel === 'morph') {
        angleFrom = null
        gutterXFrom = null
      }
    }
  })

  // Plain twin of the morph landing above, for the displaced-scalar
  // mechanism's OTHER clock: clears angleFrom/gutterXFrom once the plain
  // glide (displacedTween) reaches 1. Clearing here rather than trusting
  // the lerp to land exactly on target at t=1 keeps the settled state
  // byte-identical to before this feature existed — floating-point lerp at
  // t=1 can differ from the target by the last ulp, and the null-from path
  // is what guarantees an exact match (see displacedScalar below).
  $effect(() => {
    if (
      displacedChannel === 'plain' &&
      (angleFrom !== null || gutterXFrom !== null) &&
      displacedTween.current >= 1
    ) {
      angleFrom = null
      gutterXFrom = null
    }
  })

  /** Mid-morph: this node's current lerped scalar, its destination
   * recomputed LIVE against targetDomain every call (see morphAxis above).
   * Otherwise (including a node the active morph doesn't cover): `plain`,
   * unchanged. */
  function morphedScalar(track: Track, unkeyed: boolean, plain: number): number {
    if (morphFrom === null || morphAxis === null || morphDelays === null) return plain
    const from = morphFrom.get(track.id)
    if (from === undefined) return plain
    const to = unkeyed
      ? settledGutterYOf(track, morphAxis, targetDomain)
      : settledRadiusOf(track, morphAxis, targetDomain)
    const delay = morphDelays.get(track.id) ?? 0
    return lerp(from, to, radialMorphProgress(morphTween.current, delay))
  }

  /** This node's own progress along whichever displaced-scalar clock
   * (src/core/displaced.ts) is currently active: the SAME per-node morph
   * delay the radius rides during a swap, or the shared plain 0..1 tween
   * for every other kind of change. */
  function displacedProgress(id: string): number {
    if (displacedChannel === 'morph' && morphDelays !== null)
      return radialMorphProgress(morphTween.current, morphDelays.get(id) ?? 0)
    return displacedTween.current
  }

  /** A displaced scalar (the slot angle, or the gutter x — v20 #2/#3) —
   * captured `from` lerped toward the LIVE `target` by this node's own
   * `displacedProgress`, or `target` directly once settled (`from` null:
   * the byte-identical steady-state path, same convention as morphedScalar
   * above). */
  function displacedScalar(from: Map<string, number> | null, id: string, target: number): number {
    const captured = from?.get(id)
    return captured === undefined ? target : lerp(captured, target, displacedProgress(id))
  }

  // Placement runs over the FULL library so every track's angle (and gutter
  // slot) is independent of the filters: filtering only makes nodes appear
  // or disappear, leaving gaps in the fans — nothing moves (design-v6 §A).
  const nodes = $derived.by(() => {
    const placed: PlacedNode[] = []

    /** Settled gutter y for this track under the live axis/scale, or its
     * mid-morph lerped y while an axis swap is in flight (v18 #11a). */
    function unkeyedY(track: Track): number {
      const value = track[$radialAxis]
      const plain = value === null ? gutterBottom + GUTTER_MISSING_Y_GAP : gutterY(value)
      return morphedScalar(track, true, plain)
    }

    // Tracks without a key live in the gutter, still positioned by the radial
    // value (remark 3: a missing key must not hide a known BPM/year/rating).
    // Sort order is paint order only now — band membership and each
    // member's fan index are decided once, on settled y, by
    // gutterTargetXById above (v20 #3); this loop just draws x glided
    // toward that target (displacedScalar) and y unchanged.
    const unkeyed = $library.filter((t) => t.key === null).sort(compareGutterTracks)
    for (const track of unkeyed) {
      const value = track[$radialAxis]
      const y = unkeyedY(track) // unchanged: still rides morph/domain tween
      const x = displacedScalar(gutterXFrom, track.id, gutterTargetXById.get(track.id) ?? GUTTER_X)
      placed.push({ track, x, y, unkeyed: true, missingRadial: value === null })
    }

    // Keyed tracks: the relaxed slot angle (memoised below — issue 17),
    // glided rather than snapped onto a relayout (v20 #2 — see
    // displacedScalar above), plus the tween-animated radius, or — mid-swap
    // — the per-node morph (v18 #11a).
    for (const track of $library) {
      if (track.key === null) continue
      const value = track[$radialAxis]
      const angle = displacedScalar(angleFrom, track.id, slotAngleById.get(track.id) ?? 0)
      const plainR = value === null ? R_FALLBACK : radialScale(value)
      const r = morphedScalar(track, false, plainR)
      placed.push({ track, ...polar(angle, r), unkeyed: false, missingRadial: value === null })
    }
    return placed
  })

  const visibleIds = $derived(new Set($visibleLibrary.map((t) => t.id)))
  /** Only the visible placements are ever rendered or hit-tested. */
  const visibleNodes = $derived(nodes.filter((n) => visibleIds.has(n.track.id)))

  const nodeById = $derived(new Map(visibleNodes.map((n) => [n.track.id, n])))

  // Ghost stars (v18 #11): walk members the active filters hide still have a
  // placement (the full-library `nodes` pass above covers every track, not
  // just the visible ones, and the clamped radial scale rim-pins one that's
  // out of the domain for free) — they just aren't in visibleNodes. ids come
  // pre-deduped/ordered from ghostWalkIds; nodeById above stays visible-only
  // and untouched, so combo/manual edges keep their both-visible behaviour.
  const ghostIds = $derived(new Set(ghostWalkIds($tracklist, visibleIds)))
  const ghostNodes = $derived(nodes.filter((n) => ghostIds.has(n.track.id)))
  /** Walk edges alone may span a hidden endpoint, so they alone look this up
   * instead of the plain nodeById. Reduces to nodeById byte-for-byte when
   * nothing is filtered out (ghostNodes is then empty). */
  const walkNodeById = $derived(
    new Map([...visibleNodes, ...ghostNodes].map((n) => [n.track.id, n])),
  )

  const colorDomain = $derived.by((): [number, number] => {
    const values = $library
      .map((t) => t[$effectiveColorAxis])
      .filter((v): v is number => v !== null)
    if (values.length === 0) return [0, 1]
    return [Math.min(...values), Math.max(...values)]
  })

  /** Tracks per genre class among the *visible* nodes. */
  const visibleClassCounts = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const counts = new Map<number, number>()
    for (const track of $visibleLibrary) {
      const index = classIndexOf(track)
      if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1)
    }
    return counts
  })

  /**
   * Genre classes actually present among the visible nodes: the legend shows
   * only these, and disappears entirely when the symbols carry no distinction
   * (design-v6 §B). Symbol assignment still indexes the full-library classes,
   * so a genre keeps its shape while classes come and go.
   */
  const visibleClasses = $derived(
    ($iconClasses?.classes ?? [])
      .map((cls, index) => ({ cls, index, visible: visibleClassCounts.get(index) ?? 0 }))
      .filter((entry) => entry.visible > 0),
  )

  const nodeColor = $derived(
    makeNodeColor(
      $effectiveColorAxis,
      colorDomain,
      $effectiveSettings.colorScheme,
      $effectiveTheme,
    ),
  )
  const ramp = $derived(COLOR_SCHEMES[$effectiveTheme][$effectiveSettings.colorScheme])

  const walkPairs = $derived(
    $tracklist.slice(0, -1).map((id, i) => [id, $tracklist[i + 1]] as const),
  )

  // Walk-draw reveal (v12 WS1): while a fresh suggestion's window is open the
  // edges dash-draw in sequence and each reached node pulses once. Keying on
  // the tick restarts cleanly per ✨/⚡; after `seen` catches up a re-mounted
  // wheel renders the walk plainly.
  const revealing = $derived($walkRevealTick > $walkRevealSeen)
  const revealPlan = $derived(walkRevealPlan($tracklist, $walkRevealRange ?? undefined))

  const focusSet = $derived.by(() => {
    if ($selectedId === null) return null
    // Threshold 0 (v11 issue 2a): the graph is complete, everything focuses.
    if ($comboComplete) return new Set($visibleLibrary.map((t) => t.id))
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const set = new Set([$selectedId])
    for (const n of $neighbours.get($selectedId) ?? []) set.add(n)
    return set
  })

  function nodeOpacity(node: PlacedNode): number {
    const base = node.missingRadial ? 0.55 : 1
    // The audible track never dims (v29 #4). The focus dim multiplies with the
    // breathing keyframes below, so a playing star that was not also the
    // selected one used to pulse between 0.12 and 0.054 — invisible, which is
    // the opposite of what "you are hearing this one" needs to say.
    if (audibleIds.has(node.track.id)) return base
    if (focusSet !== null && !focusSet.has(node.track.id)) return 0.12
    return base
  }

  // Only focus edges are drawn at all (v9 issue 8): the selection's own star
  // brightens, the cluster's interconnections stay at the plain base.
  function edgeOpacity(sourceId: string, targetId: string): number {
    const isStar = sourceId === $selectedId || targetId === $selectedId
    return isStar
      ? focusEdgeOpacity($effectiveSettings.edgeOpacity)
      : $effectiveSettings.edgeOpacity
  }

  // The selection as it stood before the current click burst. A double-click
  // delivers click, click, dblclick: the first click moves the selection onto
  // the double-clicked node, so the node to insert AFTER is the one selected
  // before that (v17 #5).
  let insertAnchor: string | null = null

  function select(node: PlacedNode, event: MouseEvent) {
    // The second click of a double-click would toggle the just-made selection
    // straight back off — and a double-click means "add", never "deselect".
    if (event.detail > 1) return
    insertAnchor = $selectedId
    // Link mode (v12 WS9): an armed 🔗 turns the next click into a combo
    // mark/unmark; the selection stays on the source so marks can chain.
    // Shared with the tracks table via selectOrLink (v14 WS10).
    selectOrLink(node.track.id)
  }

  function addToTracklist(node: PlacedNode, anchorId: string | null) {
    addTrackToSet(node.track.id, anchorId)
  }

  function keyLabelPos(key: CamelotKey) {
    return polar(wheelSlotAngleDeg(key), R_MAX + 26)
  }

  // v14 W1: a key sector (and its label) fades when its ring is filtered out
  // (existing keyRing logic) OR its Camelot number falls outside an active
  // key-range filter — composed, not replaced. The 0.6s .excluded transition
  // animates either cause for free (sector: fill cross-fade, v18 #2a; label:
  // opacity fade).
  function keyExcluded(key: CamelotKey): boolean {
    const { minor, major } = $effectiveFilters.keyRings
    const ringExcluded = (key.endsWith('A') && !minor) || (key.endsWith('B') && !major)
    const range = $effectiveFilters.properties.key
    const outOfRange =
      Array.isArray(range) &&
      typeof range[0] === 'number' &&
      typeof range[1] === 'number' &&
      (camelotNumber(key) < range[0] || camelotNumber(key) > range[1])
    return ringExcluded || outOfRange
  }

  function trackSummary(t: Track): string {
    return [t.key ?? '—', t.bpm !== null ? `${t.bpm} BPM` : '—', t.genre ?? '—'].join(' · ')
  }

  const hasUnkeyed = $derived(visibleNodes.some((n) => n.unkeyed))
  const hasMissingRadial = $derived(visibleNodes.some((n) => !n.unkeyed && n.missingRadial))

  // --- zoom & pan (remark 10) ---
  // The zoom behaviour + attached selection live inside createViewZoom (plain
  // closure vars — d3 owns them, a $state proxy would swallow their writes).
  // The component keeps only these primitives in $state, written from onZoom.
  // Node disks keep a constant screen size while zooming (their radii are
  // divided by k): zooming exists to resolve detail, not to inflate markers.
  let svgEl: SVGSVGElement
  let zoomTransform = $state('translate(0,0) scale(1)')
  let zoomK = $state(1)
  const viewZoom = createViewZoom({
    scaleExtent: [0.5, 8],
    disableDblClick: true, // double-click appends to the set instead
    onZoom: (transform) => {
      zoomTransform = transform.toString()
      zoomK = transform.k
    },
  })

  $effect(() => viewZoom.attach(svgEl))

  function zoomBy(factor: number) {
    viewZoom.zoomBy(factor)
  }

  function zoomReset() {
    viewZoom.zoomReset()
  }

  // --- hub button: suggest the next track (remark 7) ---
  // Inserts after the selected track when it sits mid-set (fitting both
  // neighbours), otherwise appends after the last track. When the anchor's
  // neighbourhood is exhausted the hub turns into a warning-coloured
  // "force" button: clicking it knowingly breaks the criteria and picks the
  // closest non-matching track (design-v6 §C). v7 (issue 17): the empty-set
  // opener is random per press (random session seed base), the selection
  // jumps to every pick so repeated presses continue from the head, the hub
  // greys out once every visible track is used, and a retry ring swaps the
  // last pick for a different one while alternatives exist.
  let hubSeed = Math.floor(Math.random() * 2 ** 31)
  const hubExhausted = $derived(nextExhausted($neighbours, $tracklist, $selectedId, $comboComplete))
  const usedIds = $derived(new Set($tracklist))
  const hubAllUsed = $derived(
    $visibleLibrary.length > 0 && $visibleLibrary.every((t) => usedIds.has(t.id)),
  )

  let lastHubPick = $state<NextSuggestion | null>(null)
  // The FIRST pick made for the slot — what the ⟲ button restores. Survives
  // retries, dies with the retry window (v8 issue 3).
  let originalPickId = $state<string | null>(null)
  let triedIds = $state<string[]>([])
  // Any external edit to the set closes the retry window.
  $effect(() => {
    if (lastHubPick !== null && $tracklist[lastHubPick.insertIndex] !== lastHubPick.trackId) {
      lastHubPick = null
      originalPickId = null
      triedIds = []
    }
  })
  // The ring degrades instead of vanishing: retry → force retry (+ ⟲ reset)
  // → reset-only, per the pure state machine (v8 issues 2+3).
  const hubRetryState = $derived(
    retryState($neighbours, $tracklist, lastHubPick, triedIds, [...visibleIds], $comboComplete),
  )

  function hubSuggest() {
    if (hubAllUsed) return
    const suggestion = suggestNext($visibleLibrary, $effectiveCriteria, $tracklist, {
      selectedId: $selectedId,
      randomness: $effectiveSettings.suggestRandomness,
      seed: hubSeed++,
      progression: $effectiveSettings.bpmProgression,
      force: hubExhausted,
      manualEdges: $effectiveManualEdges,
      manualEdgeWeight: $effectiveSettings.manualEdgeWeight,
    })
    if (suggestion === null) return
    tracklist.update((ids) => ids.toSpliced(suggestion.insertIndex, 0, suggestion.trackId))
    selectedId.set(suggestion.trackId)
    lastHubPick = suggestion
    originalPickId = suggestion.trackId
    triedIds = []
  }

  /** Swap the last hub pick for a different one, keeping its slot. */
  function hubRetry() {
    const pick = lastHubPick
    const state = hubRetryState
    if (pick === null || $tracklist[pick.insertIndex] !== pick.trackId) return
    if (state !== 'retry' && state !== 'force-retry') return
    const withoutPick = $tracklist.toSpliced(pick.insertIndex, 1)
    // Re-anchor exactly where the original pick came from: the previous
    // track for a mid/end pick, nothing for an empty-set opener.
    const anchorId = pick.insertIndex > 0 ? withoutPick[pick.insertIndex - 1] : null
    const exclude = [...triedIds, pick.trackId]
    const suggestion = suggestNext($visibleLibrary, $effectiveCriteria, withoutPick, {
      selectedId: anchorId,
      randomness: $effectiveSettings.suggestRandomness,
      seed: hubSeed++,
      progression: $effectiveSettings.bpmProgression,
      force: state === 'force-retry',
      excludeIds: exclude,
      manualEdges: $effectiveManualEdges,
      manualEdgeWeight: $effectiveSettings.manualEdgeWeight,
    })
    if (suggestion === null || suggestion.insertIndex !== pick.insertIndex) {
      lastHubPick = null
      originalPickId = null
      triedIds = []
      return
    }
    tracklist.update((ids) => ids.toSpliced(pick.insertIndex, 1, suggestion.trackId))
    selectedId.set(suggestion.trackId)
    lastHubPick = suggestion
    triedIds = exclude
  }

  /** ⟲: put the slot's original pick back and reopen the cycle (issue 3). */
  function hubReset(event?: Event) {
    event?.stopPropagation()
    const pick = lastHubPick
    const original = originalPickId
    if (pick === null || original === null || $tracklist[pick.insertIndex] !== pick.trackId) return
    if (original !== pick.trackId) {
      tracklist.update((ids) => ids.toSpliced(pick.insertIndex, 1, original))
      selectedId.set(original)
      lastHubPick = { trackId: original, insertIndex: pick.insertIndex }
    }
    triedIds = []
  }

  // Tracks tagged in the Tracks view (essential / opener / closer) wear a
  // subtle ring on the wheel (issue 7).
  const taggedIds = $derived(
    new Set([...$mustInclude, $pinnedFirst, $pinnedLast].filter((id) => id !== null)),
  )

  // Tracks the player is actually sounding right now (v28.2). All-false when
  // the preview is off or disposed, so no settings gate is needed.
  const audibleIds = $derived(
    new Set(
      [$playerPlaying.a ? $playerDecks.a : null, $playerPlaying.b ? $playerDecks.b : null].filter(
        (id) => id !== null,
      ),
    ),
  )

  /**
   * Paint order within the node layer (v29 #4). SVG has no z-index, so the
   * last star drawn is the one on top — and the one that wins the click, since
   * hit-testing runs the same order. Nothing raised a star before this, so an
   * audible or selected one could sit under whichever neighbours happened to
   * come later in the library.
   *
   * A separate derived, used ONLY by the `{#each}` below: `visibleNodes` also
   * feeds nodeById, walkNodeById and the ghost split, none of which want their
   * order disturbed. Stable within each band, so nothing else shuffles.
   */
  const paintedNodes = $derived.by(() => {
    const rank = (node: PlacedNode) =>
      audibleIds.has(node.track.id)
        ? 3
        : node.track.id === $selectedId
          ? 2
          : node.track.id === $hoveredId
            ? 1
            : 0
    if (!visibleNodes.some((n) => rank(n) > 0)) return visibleNodes
    return [...visibleNodes].sort((a, b) => rank(a) - rank(b))
  })
</script>

<svelte:window
  onkeydown={(e) => {
    // With the advanced panel open, Escape belongs to closing the panel.
    if (e.key === 'Escape' && $rightPanel === 'set') selectedId.set(null)
  }}
/>

<div
  class="wheel-wrap"
  data-tour="wheel"
  role="presentation"
  onmousemove={(e) => (mouse = { x: e.clientX, y: e.clientY })}
  onclick={(e) => {
    if (e.target instanceof Element && e.target.tagName === 'svg') selectedId.set(null)
  }}
>
  <svg
    bind:this={svgEl}
    viewBox="0 0 {WIDTH} {SIZE}"
    role="application"
    aria-label="Harmonic key wheel of the track library"
  >
    <g class="zoom-layer" transform={zoomTransform}>
      <!-- SVG paint order is document order, so this group's child order is
           a deliberate layer stack (bugs 1+2, H2, H3). Full paint order for the
           zoom-layer group:
             1. sector fills
             2. spokes
             3. grid circles + dashed fallback circle
             4. rim + gutter axis/tick lines
             5. edges (combo → manual → defs → walk group)
             6. static labels, haloed (tick, zone ×3, key)
             7. retry group — deliberately UNDER the stars so a fallback-ring
                star (r=70) sitting inside the retry hit band (r 46-70)
                still wins hover/click
             8. ghost nodes
             9. real nodes
             10. gutter tick numbers (sole label above data — the axis stays
                 readable over a star stack; pointer-events: none in the
                 halo CSS keeps the stars interactive underneath)
             11. ⟲ reset disc, then hub (LAST — issue 17)
           Rule: labels sit above all static geometry and above edges; data
           (nodes) sits above labels, except the gutter tick numbers. -->

      <!-- Key sector backgrounds: subtle minor (A) vs major (B) tint per slot.
           The minor/major filter (v8 issue 10) fades the excluded ring's tint
           so the wheel visibly answers the toggle beyond nodes vanishing. -->
      {#each ALL_CAMELOT_KEYS as key (key)}
        {@const centre = wheelSlotAngleDeg(key)}
        <path
          d={annularSectorPath(CX, CY, centre - 7.5, centre + 7.5, R_MIN - 30, R_MAX + 12)}
          class="sector"
          class:major={key.endsWith('B')}
          class:excluded={keyExcluded(key)}
        />
      {/each}

      <!-- One radial line per key slot; number boundaries slightly stronger -->
      {#each Array.from({ length: 24 }, (_, i) => i * 15) as boundary (boundary)}
        {@const inner = polar(boundary, R_MIN - 30)}
        {@const outer = polar(boundary, R_MAX + 12)}
        <line
          x1={inner.x}
          y1={inner.y}
          x2={outer.x}
          y2={outer.y}
          class="spoke"
          class:sub={boundary % 30 !== 0}
          vector-effect="non-scaling-stroke"
        />
      {/each}

      <!-- Radial grid -->
      {#each gridTicks as tick (tick)}
        <circle
          cx={CX}
          cy={CY}
          r={radialScale(tick)}
          class="gridline"
          vector-effect="non-scaling-stroke"
        />
      {/each}
      {#if hasMissingRadial}
        <circle
          cx={CX}
          cy={CY}
          r={R_FALLBACK}
          class="gridline dashed"
          vector-effect="non-scaling-stroke"
        />
      {/if}

      <!-- Rim -->
      <circle cx={CX} cy={CY} r={R_MAX + 12} class="ring" vector-effect="non-scaling-stroke" />

      <!-- No-key gutter axis + tick marks: same scale as the wheel radius,
           vertically. The gutter-tick-label numbers live above the nodes
           (layer 10, see the ordering note above), not here. -->
      {#if hasUnkeyed}
        <line x1={GUTTER_X} y1={gutterTop - 10} x2={GUTTER_X} y2={gutterBottom + 10} class="ring" />
        {#each gridTicks as tick (tick)}
          <line
            x1={GUTTER_X - 4}
            y1={gutterY(tick)}
            x2={GUTTER_X + 4}
            y2={gutterY(tick)}
            class="spoke"
          />
        {/each}
      {/if}

      <!-- Suggestion edges: only around the selected track (v9 issue 8) -->
      {#each $focusEdges as edge (`${edge.sourceId}→${edge.targetId}`)}
        {@const a = nodeById.get(edge.sourceId)}
        {@const b = nodeById.get(edge.targetId)}
        {#if a && b}
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            class="combo-edge"
            opacity={edgeOpacity(edge.sourceId, edge.targetId)}
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}

      <!-- Manual combos (v12 WS9): user-marked roads, always visible —
           deliberate and few, they are exempt from the focus-only rule. -->
      {#each $effectiveManualEdges as edge (edge.a + '\n' + edge.b)}
        {@const ma = nodeById.get(edge.a)}
        {@const mb = nodeById.get(edge.b)}
        {#if ma && mb}
          <line
            x1={ma.x}
            y1={ma.y}
            x2={mb.x}
            y2={mb.y}
            class="manual-edge"
            class:dim={$selectedId !== null && edge.a !== $selectedId && edge.b !== $selectedId}
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}

      <!-- Walk (current tracklist): layer 5, after the suggestion edges —
           see the ordering note at the top of this group. -->
      <defs>
        <!-- Direction chevron (v21 #2): a mid-edge marker instead of an
             end-of-edge arrowhead — the old head sat where the target star
             (layer 9) painted over it. See core/walkArrow.ts for the shared
             geometry and the layer-order note. -->
        <marker
          id="walk-chevron"
          viewBox={WALK_CHEVRON_VIEW_BOX}
          refX={WALK_CHEVRON_REF}
          refY={WALK_CHEVRON_REF}
          markerWidth={WALK_CHEVRON_SIZE / zoomK}
          markerHeight={WALK_CHEVRON_SIZE / zoomK}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path
            d={WALK_CHEVRON_D}
            fill="none"
            stroke="var(--walk)"
            stroke-width={WALK_CHEVRON_STROKE}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </marker>
        <!-- Ghost edges (v18 #11) point at a marker of their own: a marker's
             content doesn't inherit the referencing line's stroke-opacity,
             so the dimming has to live here too. -->
        <marker
          id="walk-chevron-ghost"
          viewBox={WALK_CHEVRON_VIEW_BOX}
          refX={WALK_CHEVRON_REF}
          refY={WALK_CHEVRON_REF}
          markerWidth={WALK_CHEVRON_SIZE / zoomK}
          markerHeight={WALK_CHEVRON_SIZE / zoomK}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path
            d={WALK_CHEVRON_D}
            fill="none"
            stroke="var(--walk)"
            stroke-opacity="0.35"
            stroke-width={WALK_CHEVRON_STROKE}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </marker>
      </defs>
      <!-- Keyed by position: the same ordered pair can occur twice when a
           track appears in the set more than once (remark 15). The outer key
           restarts the reveal per suggestion (v12 WS1). -->
      {#key $walkRevealTick}
        <!-- The group carries the completion shimmer (v12 WS2): a revealed
             full-length walk swells bright once, right as it finishes. -->
        <g
          class="walk-group"
          class:celebrate={revealing && $tracklist.length >= $effectiveSettings.suggestLength}
          style:--reveal-total="{revealPlan.totalMs}ms"
        >
          {#each walkPairs as [fromId, toId], pairIndex (pairIndex)}
            {@const a = walkNodeById.get(fromId)}
            {@const b = walkNodeById.get(toId)}
            {@const ghost = ghostIds.has(fromId) || ghostIds.has(toId)}
            {#if a && b}
              {@const mid = walkChevronMid(a.x, a.y, b.x, b.y)}
              <polyline
                points={mid === null
                  ? `${a.x},${a.y} ${b.x},${b.y}`
                  : `${a.x},${a.y} ${mid.x},${mid.y} ${b.x},${b.y}`}
                class="walk-edge"
                class:ghost
                class:reveal={revealing && revealPlan.edgeDelays[pairIndex] !== null}
                pathLength={revealing && revealPlan.edgeDelays[pairIndex] !== null ? 1 : undefined}
                style:animation-delay={revealing && revealPlan.edgeDelays[pairIndex] !== null
                  ? `${revealPlan.edgeDelays[pairIndex]}ms`
                  : undefined}
                style:animation-duration={revealing && revealPlan.edgeDelays[pairIndex] !== null
                  ? `${revealPlan.stepMs}ms`
                  : undefined}
                marker-mid={ghost ? 'url(#walk-chevron-ghost)' : 'url(#walk-chevron)'}
                vector-effect="non-scaling-stroke"
              />
            {/if}
          {/each}
          {#if revealing}
            <!-- One pulse per unique walk node, fired as the walk reaches it.
                 nodeById (visible-only) is deliberate here, not walkNodeById:
                 a ghost has no star to pulse at (v18 #11). -->
            {#each [...revealPlan.nodeDelays] as [id, delay] (id)}
              {@const n = nodeById.get(id)}
              {#if n}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={10 / zoomK}
                  class="reveal-pulse"
                  style:animation-delay="{delay}ms"
                  vector-effect="non-scaling-stroke"
                />
              {/if}
            {/each}
          {/if}
        </g>
      {/key}

      <!-- Static labels, haloed (layer 6, see the ordering note at the top
           of this group): painted above all static geometry and edges so
           spokes and the rim never cut through them. The halo CSS
           (.tick-label, .key-label, .zone-label, .gutter-tick-label) keeps
           them legible where they now cross live strokes. -->
      {#each gridTicks as tick (tick)}
        <text x={CX + 6} y={CY - radialScale(tick) - 4} class="tick-label">{tick}</text>
      {/each}
      {#if hasMissingRadial}
        <text x={CX} y={CY - R_FALLBACK - 8} class="zone-label" text-anchor="middle">
          no {AXIS_LABEL[$radialAxis]} value
        </text>
      {/if}
      {#each ALL_CAMELOT_KEYS as key (key)}
        {@const pos = keyLabelPos(key)}
        <text
          x={pos.x}
          y={pos.y}
          class="key-label"
          class:major={key.endsWith('B')}
          class:excluded={keyExcluded(key)}
          dominant-baseline="middle"
          text-anchor="middle">{key}</text
        >
      {/each}
      {#if hasUnkeyed}
        <text x={GUTTER_X} y={gutterTop - 26} class="zone-label" text-anchor="middle">no key</text>
        <text
          x={GUTTER_X}
          y={gutterBottom + GUTTER_MISSING_Y_GAP + 20}
          class="zone-label"
          text-anchor="middle"
        >
          no value
        </text>
      {/if}

      <!-- Hub retry band: layer 7, see the ordering note above. Painted
           deliberately BEFORE the ghost/node blocks (under the stars) so a
           fallback-ring star (r=70) sitting inside the retry hit band
           (r 46-70) still wins hover/click there; the visible ring (r=52)
           and curved label barely graze stars at 6 o'clock. -->
      {#if $visibleLibrary.length > 0 && hubRetryState !== 'none'}
        <g
          class="hub-retry"
          class:force={hubRetryState === 'force-retry'}
          class:spent={hubRetryState === 'reset-only'}
          transition:scale={{ duration: motionMs(250), start: 0.85, easing: cubicOut }}
          role="button"
          tabindex={hubRetryState === 'reset-only' ? -1 : 0}
          aria-disabled={hubRetryState === 'reset-only'}
          aria-label={hubRetryState === 'force-retry'
            ? 'Force retry: swap the last pick for the closest rule-breaking one'
            : hubRetryState === 'reset-only'
              ? 'Every alternative has been tried'
              : 'Retry: replace the last suggested track with another pick'}
          onclick={hubRetry}
          onkeydown={(e) => {
            if (e.key === 'Enter') hubRetry()
          }}
        >
          <title
            >{hubRetryState === 'force-retry'
              ? 'No matching alternative left — retrying knowingly breaks the rules'
              : hubRetryState === 'reset-only'
                ? 'Every alternative has been tried — ⟲ restores the original pick'
                : 'Not feeling it? Swap the last suggestion for a different pick'}</title
          >
          <circle cx={CX} cy={CY} r="58" class="retry-hit" />
          <circle cx={CX} cy={CY} r="52" class="retry-ring" vector-effect="non-scaling-stroke" />
          <!-- First <textPath> in the repo: the label curves along the
               ring's lower arc instead of sitting on a straight baseline.
               fill on <text> inherits into <textPath> per the SVG spec,
               so the hover/force/spent rules below (which target
               .retry-label) keep working unchanged. -->
          <path id="retry-label-arc" d={lowerArcPath(CX, CY, 62)} fill="none" />
          <text class="retry-label" text-anchor="middle"
            ><textPath href="#retry-label-arc" startOffset="50%"
              >{hubRetryState === 'force-retry'
                ? 'force retry'
                : hubRetryState === 'reset-only'
                  ? 'all tried'
                  : 'retry'}</textPath
            ></text
          >
        </g>
      {/if}

      <!-- Ghost stars (v18 #11): walk members the filters currently hide.
           Layer 8 (see the ordering note above) — real nodes (layer 9)
           painting over this is what lets a track crossing the
           visible/hidden line always show its star on top mid cross-fade.
           Non-interactive (no hit target, no tooltip) — the same Task-10
           fade wrapper as the real nodes below makes this the star↔ghost
           cross-fade: one node's <g> outros from the block below while
           this one's intros here. -->
      {#each ghostNodes as node (node.track.id)}
        <g
          class="ghost-node"
          transition:fade={{ duration: motionMs(RADIAL_TWEEN_MS), easing: cubicOut }}
        >
          <circle
            cx={node.x}
            cy={node.y}
            r={3.5 / zoomK}
            class="ghost-dot"
            vector-effect="non-scaling-stroke"
          />
        </g>
      {/each}

      <!-- Nodes -->
      {#each paintedNodes as node (node.track.id)}
        <!-- Outer wrapper carries the enter/exit fade (v18 issue 11b): its
             transition sets inline style.opacity, which would otherwise
             clobber the inner opacity ATTRIBUTE if it were on the same
             element. Two nested elements composite (multiply) instead, so a
             node fading in mid-selection still lands at the dimmed value. -->
        <g transition:fade={{ duration: motionMs(RADIAL_TWEEN_MS), easing: cubicOut }}>
          <g
            class="node"
            opacity={nodeOpacity(node)}
            role="button"
            tabindex="0"
            aria-label="{node.track.title} — {trackSummary(node.track)}"
            onmouseenter={() => (hovered = node)}
            onmouseleave={() => (hovered = null)}
            onclick={(e) => select(node, e)}
            ondblclick={() => addToTracklist(node, insertAnchor)}
            onkeydown={(e) => {
              if (e.key === 'Enter') selectOrLink(node.track.id)
              if (e.key === '+') addTrackToSet(node.track.id)
            }}
          >
            <circle cx={node.x} cy={node.y} r={11 / zoomK} fill="transparent" />
            {#if node.track.id === $hoveredId}
              <!-- Subtle halo mirroring a hover in the set list (v9 issue 20). -->
              <circle
                cx={node.x}
                cy={node.y}
                r={12 / zoomK}
                class="hover-ring"
                vector-effect="non-scaling-stroke"
              />
            {/if}
            {#if audibleIds.has(node.track.id)}
              <!-- The breathing's bright half (v29 #4). A star at full opacity
                   has nowhere brighter to go, so the peak lives in a halo
                   behind it — the same idiom as .hover-ring and .tag-ring
                   above. Opacity only, like the dot: the dot's transform
                   attribute carries its position, and this circle's cx/cy do,
                   so a CSS transform would tear either off the wheel. -->
              <circle
                cx={node.x}
                cy={node.y}
                r={15 / zoomK}
                class="playing-halo"
                vector-effect="non-scaling-stroke"
              />
            {/if}
            {#if taggedIds.has(node.track.id)}
              <!-- Subtle marker for essential/opener/closer tags set in the
                   Tracks view (issue 7) — its own ring, so it coexists with
                   the selected and in-walk strokes on the dot itself. -->
              <circle
                cx={node.x}
                cy={node.y}
                r={9 / zoomK}
                class="tag-ring"
                vector-effect="non-scaling-stroke"
              />
            {/if}
            <path
              d={shapePath(classIndexOf(node.track), node.track.id === $selectedId ? 7 : 5)}
              transform="translate({node.x},{node.y}) scale({1 / zoomK})"
              fill={nodeColor(node.track[$effectiveColorAxis])}
              class="dot"
              class:selected={node.track.id === $selectedId}
              class:in-walk={$tracklist.includes(node.track.id)}
              class:playing={audibleIds.has(node.track.id)}
              vector-effect="non-scaling-stroke"
            />
          </g>
        </g>
      {/each}

      <!-- Gutter tick numbers: layer 10, the convention's rule-10 exception —
           the one label painted ABOVE the data instead of below it, so the
           axis stays readable over a stack of stars; pointer-events: none
           in the halo CSS keeps the stars interactive underneath. -->
      {#if hasUnkeyed}
        {#each gridTicks as tick (tick)}
          <text x={GUTTER_X + 9} y={gutterY(tick) + 3} class="gutter-tick-label">{tick}</text>
        {/each}
      {/if}

      <!-- Hub button: layer 11 (⟲ reset disc, then the hub itself, LAST) —
           see the ordering note at the top of this group. The retry band
           (layer 7) has moved above, before the ghost/node blocks, so
           fallback-ring stars win hover/click inside it; hub + ⟲ stay LAST
           here so edges and nodes never steal their clicks (issue 17),
           each with an oversized transparent hit circle. -->
      {#if $visibleLibrary.length > 0}
        {#if hubRetryState !== 'none' && hubRetryState !== 'retry' && triedIds.length > 0 && originalPickId !== lastHubPick?.trackId}
          <!-- ⟲ reset-to-original: part of the force-retry morph (issue 3),
               shown only while the slot actually diverges from the original -->
          <g
            class="hub-reset"
            transition:scale={{ duration: motionMs(250), start: 0.85, easing: cubicOut }}
            role="button"
            tabindex="0"
            aria-label="Restore the original pick"
            onclick={hubReset}
            onkeydown={(e) => {
              if (e.key === 'Enter') hubReset(e)
            }}
          >
            <title>Restore the original pick and start the cycle over</title>
            <circle cx={CX} cy={CY - 52} r="11" class="reset-disc" />
            <text x={CX} y={CY - 48} class="reset-glyph" text-anchor="middle">⟲</text>
          </g>
        {/if}
        <g
          class="hub"
          class:warning={hubExhausted && !hubAllUsed}
          class:disabled={hubAllUsed}
          role="button"
          tabindex={hubAllUsed ? -1 : 0}
          aria-disabled={hubAllUsed}
          aria-label={hubAllUsed
            ? 'Every track is already in the constellation'
            : hubExhausted
              ? 'No exact match left — force the closest track'
              : 'Suggest next track'}
          onclick={hubSuggest}
          onkeydown={(e) => {
            if (e.key === 'Enter') hubSuggest()
          }}
        >
          <title
            >{hubAllUsed
              ? 'Every visible track is already in the constellation'
              : hubExhausted
                ? 'No track matches your criteria from here — clicking forces the closest one anyway'
                : 'Suggest the next track'}</title
          >
          <circle cx={CX} cy={CY} r="46" class="hub-hit" />
          <circle cx={CX} cy={CY} r="34" class="hub-circle" vector-effect="non-scaling-stroke" />
          <text x={CX} y={CY - 2} class="hub-plus" text-anchor="middle">+</text>
          <text x={CX} y={CY + 16} class="hub-label" text-anchor="middle"
            >{hubExhausted && !hubAllUsed ? 'force' : 'next'}</text
          >
        </g>
      {/if}
    </g>

    <!-- Empty hint: anchored to the wheel's true centre (CX, CY) inside the
         viewBox, so it tracks the rendered scale and ignores the gutter.
         Outside the zoom layer: an empty-state shouldn't pan away. -->
    {#if $visibleLibrary.length === 0}
      <foreignObject x={CX - 190} y={CY - 70} width="380" height="140">
        <div class="no-visible">
          <strong>Nothing to show yet.</strong>
          <span>Select a playlist or loosen the filters on the left to populate the wheel.</span>
        </div>
      </foreignObject>
    {/if}
  </svg>

  <!-- Zoom controls -->
  <div class="zoom-controls">
    <button aria-label="Zoom in" title="Zoom in" onclick={() => zoomBy(1.4)}>+</button>
    <button aria-label="Zoom out" title="Zoom out" onclick={() => zoomBy(1 / 1.4)}>−</button>
    <button aria-label="Reset zoom" title="Reset zoom" onclick={zoomReset}>⌂</button>
  </div>

  <!-- Legend -->
  <div class="legend">
    <span class="legend-title">Colour: {AXIS_LABEL[$effectiveColorAxis]}</span>
    {#if $effectiveColorAxis === 'rating'}
      {#each [0, 1, 2, 3, 4, 5] as stars (stars)}
        <span class="chip"><i style="background: {ramp[stars]}"></i>{stars}</span>
      {/each}
    {:else}
      <span class="chip">{colorDomain[0]}</span>
      <span class="gradient" style="background: linear-gradient(to right, {ramp.join(', ')})"
      ></span>
      <span class="chip">{colorDomain[1]}</span>
    {/if}
    <span class="chip"><i style="background: {MISSING_COLORS[$effectiveTheme]}"></i>missing</span>
    <!-- Only the classes with visible tracks, and only when the symbols
         actually distinguish something (design-v6 §B). -->
    {#if visibleClasses.length > 1}
      {#each visibleClasses as { cls, index, visible } (cls.label)}
        <span class="chip shape-chip" title="{visible} of {cls.size} tracks visible">
          <svg width="12" height="12" viewBox="-6 -6 12 12"><path d={shapePath(index, 4)} /></svg>
          {cls.label}
        </span>
      {/each}
    {/if}
    <span class="chip walk-chip"><i class="walk-line"></i>your constellation</span>
    <span class="legend-hint">click: focus · double-click: add to constellation</span>
  </div>

  <!-- The selected-track card lives at the foot of the right aside since v9
       (issue 19) — see SelectedTrackCard.svelte. -->

  {#if hovered}
    <div class="tooltip" style="left: {mouse.x + 14}px; top: {mouse.y + 12}px">
      <strong>{hovered.track.title}</strong>
      <span class="artist">{hovered.track.artist ?? 'Unknown artist'}</span>
      <dl>
        <dt>Key</dt>
        <dd>{hovered.track.key ?? 'missing'}</dd>
        <dt>BPM</dt>
        <dd>{hovered.track.bpm ?? 'missing'}</dd>
        <dt>Genre</dt>
        <dd>{hovered.track.genre ?? 'missing'}</dd>
        <dt>Year</dt>
        <dd>{hovered.track.year ?? 'missing'}</dd>
        <dt>Rating</dt>
        <dd>
          {hovered.track.rating === null
            ? 'missing'
            : '★'.repeat(hovered.track.rating) + '☆'.repeat(5 - hovered.track.rating)}
        </dd>
      </dl>
    </div>
  {/if}
</div>

<style>
  .wheel-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    background: var(--surface);
  }

  .wheel-wrap > svg {
    width: 100%;
    height: 100%;
  }

  /* Lives inside a foreignObject: styles are explicit (no HTML-body
     inheritance) and the box fills the anchored rect around (CX, CY). */
  .no-visible {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--ink-secondary);
    font-family: inherit;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 20px;
    font-size: 13px;
  }

  .gridline {
    fill: none;
    stroke: var(--grid);
    stroke-width: 1;
  }

  .gridline.dashed {
    stroke-dasharray: 3 5;
  }

  .spoke {
    stroke: var(--grid);
    stroke-width: 1;
  }

  .spoke.sub {
    stroke-opacity: 0.45;
  }

  .sector {
    fill: var(--sector-minor);
    stroke: none;
    /* Match the 600ms radial tween (cubic-out) so the wedge settles WITH the
       nodes, not ~100ms early — that early settle read as a flash (v10 #7). */
    transition: fill 0.6s cubic-bezier(0.33, 1, 0.68, 1);
  }

  .sector.major {
    fill: var(--sector-major);
  }

  .sector.excluded {
    fill: var(--sector-minor-off);
  }

  .sector.major.excluded {
    fill: var(--sector-major-off);
  }

  .key-label {
    transition: opacity 0.6s cubic-bezier(0.33, 1, 0.68, 1);
  }

  .key-label.excluded {
    opacity: 0.25;
  }

  .ring {
    fill: none;
    stroke: var(--baseline);
    stroke-width: 1;
  }

  .tick-label,
  .key-label {
    fill: var(--ink-muted);
    font-size: 11px;
  }

  .gutter-tick-label {
    fill: var(--ink-muted);
    font-size: 9.5px;
    opacity: 0.8;
  }

  .zone-label {
    fill: var(--ink-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* Labels now paint above chrome and edges (bugs 1+2, H2, H3): a text
     halo keeps them legible where a spoke, gridline, or edge crosses
     underneath. SVG text is hit-testable by default, so pointer-events:
     none stops a haloed label from stealing hovers/clicks meant for the
     geometry below it. --surface flips per theme, matching the wheel
     background under the ≤6%-alpha sector tints. */
  .tick-label,
  .key-label,
  .zone-label,
  .gutter-tick-label {
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 3px;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .key-label.major {
    fill: var(--ink-secondary);
    font-weight: 600;
  }

  .combo-edge {
    stroke: var(--edge);
    stroke-width: 1;
  }

  .walk-edge {
    fill: none; /* polyline defaults to a black fill */
    stroke: var(--walk);
    stroke-width: 2;
  }

  /* Out-of-view edges (v18 #11, restyled v21 #1): a hidden endpoint thins and
     fades instead of dashing. Dashes on the wheel now mean one thing only —
     a manual combo (.manual-edge below). stroke-opacity, NOT opacity —
     .walk-edge.reveal animates `opacity` with animation-fill-mode: forwards,
     so the dimming has to live on a separate property to survive it. */
  .walk-edge.ghost {
    stroke-width: 1;
    stroke-opacity: 0.35;
  }

  .manual-edge {
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-dasharray: 6 5;
    opacity: 0.75;
    /* v14 W3: roads dim away from the focus like the combo edges do — the
       selection's own combos stay bright, the rest recede. */
    transition: opacity 0.6s cubic-bezier(0.33, 1, 0.68, 1);
  }

  .manual-edge.dim {
    opacity: 0.12;
  }

  /* Walk-draw reveal (v12 WS1): each edge dash-draws in turn. pathLength=1
     normalises every edge to the same dash space; the element stays hidden
     until its inline delay. Markers ignore the dash pattern, so the chevron
     shows the direction from the first frame while the stroke travels
     through it. */
  .walk-edge.reveal {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    opacity: 0;
    animation-name: walk-draw;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes walk-draw {
    from {
      opacity: 1;
      stroke-dashoffset: 1;
    }
    to {
      opacity: 1;
      stroke-dashoffset: 0;
    }
  }

  /* Completion shimmer (v12 WS2): fires once, timed to the reveal's end. */
  g.walk-group.celebrate {
    animation: walk-glow 700ms ease-in-out;
    animation-delay: var(--reveal-total);
  }

  @keyframes walk-glow {
    45% {
      filter: brightness(1.7) drop-shadow(0 0 5px var(--walk-bright));
    }
  }

  .reveal-pulse {
    fill: none;
    stroke: var(--walk-bright);
    stroke-width: 2;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: node-pulse 320ms ease-out;
  }

  @keyframes node-pulse {
    from {
      opacity: 0.9;
      transform: scale(0.4);
    }
    to {
      opacity: 0;
      transform: scale(1.7);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .walk-edge.reveal {
      animation: none;
      stroke-dasharray: none;
      stroke-dashoffset: 0;
      opacity: 1;
    }

    .reveal-pulse {
      display: none;
    }

    g.walk-group.celebrate {
      animation: none;
    }

    .sector {
      transition: none;
    }

    /* Still identifiable without motion: the halo simply stays lit, which is
       what the Tracks view's static row tint does too. */
    .dot.playing {
      animation: none;
      opacity: 1;
    }

    .playing-halo {
      animation: none;
      opacity: 0.4;
    }
  }

  /* Ghost stars (v18 #11): non-interactive placeholders for walk members the
     filters hide — no label, no tooltip, no hit target. The intro/exit fade
     itself is JS-driven (motionMs, already 0 under reduced motion), so
     nothing more is needed here for that preference. */
  .ghost-node {
    pointer-events: none;
  }

  .ghost-dot {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.2;
    opacity: 0.35;
  }

  .node {
    cursor: pointer;
    outline: none;
  }

  .hub {
    cursor: pointer;
    outline: none;
  }

  .hub.disabled {
    cursor: default;
    pointer-events: none;
    opacity: 0.35;
  }

  /* Oversized invisible disk: edges and dense fans must not steal clicks. */
  .hub-hit {
    fill: transparent;
    stroke: none;
  }

  .hub-circle {
    fill: var(--surface-raised);
    stroke: var(--baseline);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  /* Retry ring: a second, outer target that redraws the last hub pick.
     fill-box + center: the enter/exit scale (v18 #11c) grows from each
     group's own centre rather than the SVG viewport's origin. */
  .hub-retry {
    cursor: pointer;
    outline: none;
    transform-box: fill-box;
    transform-origin: center;
  }

  /* Widened to the full donut (v18 #7): band ≈46→70, so clicks land
     anywhere between the ＋ hub's disc and past the visible ring —
     including on the curved label text. */
  .retry-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 24;
    pointer-events: stroke;
  }

  .retry-ring {
    fill: none;
    stroke: var(--baseline);
    stroke-width: 1;
    stroke-dasharray: 2 5;
    pointer-events: none;
    transition:
      stroke 0.4s ease,
      opacity 0.4s ease;
  }

  .hub-retry:hover .retry-ring,
  .hub-retry:focus-visible .retry-ring {
    stroke: var(--accent);
    stroke-dasharray: 2 3;
  }

  /* The morph to "force retry" (v8 issue 3): the ring adopts the force
     palette with a short dash-spin announcing the state change. */
  .hub-retry.force .retry-ring {
    stroke: var(--walk-bright);
    animation: retry-morph 0.9s ease-out 1;
  }

  .hub-retry.force:hover .retry-ring,
  .hub-retry.force:focus-visible .retry-ring {
    stroke: var(--walk-bright);
    stroke-dasharray: 2 3;
  }

  /* Everything tried: the ring stays as a dimmed trace; only ⟲ acts. */
  .hub-retry.spent {
    pointer-events: none;
    cursor: default;
  }

  .hub-retry.spent .retry-ring {
    opacity: 0.35;
    animation: retry-morph 0.9s ease-out 1;
  }

  @keyframes retry-morph {
    from {
      stroke-dashoffset: 21;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  .retry-label {
    fill: var(--ink-muted);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    pointer-events: none;
    transition: fill 0.4s ease;
  }

  .hub-retry:hover .retry-label {
    fill: var(--accent);
  }

  .hub-retry.force .retry-label,
  .hub-retry.force:hover .retry-label {
    fill: var(--walk-bright);
  }

  .hub-retry.spent .retry-label {
    opacity: 0.5;
  }

  .hub-reset .reset-disc {
    fill: var(--surface-raised);
    stroke: var(--baseline);
    stroke-width: 1;
  }

  .hub-reset {
    cursor: pointer;
    transform-box: fill-box;
    transform-origin: center;
  }

  .hub-reset .reset-glyph {
    fill: var(--ink-secondary);
    font-size: 12px;
    pointer-events: none;
  }

  .hub-reset:hover .reset-disc,
  .hub-reset:focus-visible .reset-disc {
    stroke: var(--accent);
  }

  .hub-reset:hover .reset-glyph {
    fill: var(--accent);
  }

  .hub:hover .hub-circle,
  .hub:focus-visible .hub-circle {
    stroke: var(--accent);
    stroke-dasharray: none;
  }

  /* Exhausted neighbourhood: the hub offers a rule-breaking "force" pick. */
  .hub.warning .hub-circle {
    stroke: var(--walk-bright);
    stroke-dasharray: none;
    animation: hub-pulse 0.6s ease-out 2;
  }

  .hub.warning .hub-plus,
  .hub.warning .hub-label {
    fill: var(--walk-bright);
  }

  @keyframes hub-pulse {
    0% {
      stroke-width: 1;
    }
    50% {
      stroke-width: 5;
    }
    100% {
      stroke-width: 1;
    }
  }

  /* Two pre-existing (pre-v18) keyframes had no escape (v18 #15 rider):
     the retry-ring's force/spent dash-spin and the exhausted-hub pulse.
     This block must come AFTER both rules above, not in the file's earlier
     shared reduced-motion block: same specificity, so an earlier override
     loses the cascade tiebreak to these later, unconditional declarations
     (caught live by Task 15's own review — verified via a running
     .hub.warning/.hub-retry.force session that the earlier position was a
     no-op under page.emulateMedia({ reducedMotion: 'reduce' })). */
  @media (prefers-reduced-motion: reduce) {
    .hub-retry.force .retry-ring,
    .hub-retry.spent .retry-ring {
      animation: none;
    }

    .hub.warning .hub-circle {
      animation: none;
    }
  }

  .hub-plus {
    fill: var(--ink-secondary);
    font-size: 22px;
    dominant-baseline: middle;
  }

  .hub-label {
    fill: var(--ink-muted);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .tag-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    opacity: 0.55;
  }

  .hover-ring {
    fill: var(--accent);
    fill-opacity: 0.15;
    stroke: var(--accent);
    stroke-width: 1.5;
    opacity: 0.8;
    pointer-events: none;
  }

  .dot {
    stroke: var(--node-ring);
    stroke-width: 1;
  }

  .dot.selected {
    stroke: var(--ink);
    stroke-width: 2;
  }

  .dot.in-walk {
    stroke: var(--walk-bright);
    stroke-width: 2;
  }

  .node:focus-visible .dot {
    stroke: var(--accent);
    stroke-width: 3;
  }

  /* The audible track breathes (v28.2, louder in v29 #4). Opacity only: the
     path's transform attribute carries its translate+scale, so a CSS transform
     animation would tear the dot off its wheel position.

     The dot's own dip is shallow now — it never recedes — and the swell that
     makes the peak brighter than resting is carried by the halo below. */
  .dot.playing {
    animation: dot-breathe 1.6s ease-in-out infinite;
  }

  @keyframes dot-breathe {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.65;
    }
  }

  /* In phase with the dot, so the peak is unambiguous: the star is fullest and
     the glow widest at the same instant. */
  .playing-halo {
    fill: var(--accent);
    stroke: var(--accent);
    stroke-width: 1;
    pointer-events: none;
    animation: halo-breathe 1.6s ease-in-out infinite;
  }

  @keyframes halo-breathe {
    0%,
    100% {
      opacity: 0.45;
    }

    50% {
      opacity: 0;
    }
  }

  .zoom-controls {
    position: absolute;
    right: 12px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .zoom-controls button {
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 15px;
    line-height: 1;
  }

  .legend {
    position: absolute;
    left: 12px;
    bottom: 10px;
    /* Bounded on the right (zoom controls live there). Single line now that the
       pane has a width floor (ISSUES.md #13): it scrolls within its own bar on
       an unusually chip-heavy library rather than piling into rows. */
    right: 72px;
    transition: right 0.3s ease;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-secondary);
    font-size: 12px;
  }

  .legend > * {
    flex-shrink: 0;
  }

  .legend-title {
    color: var(--ink-muted);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .chip i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  .gradient {
    width: 90px;
    height: 8px;
    border-radius: 4px;
    display: inline-block;
  }

  .shape-chip {
    white-space: nowrap;
  }

  .shape-chip svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }

  .shape-chip svg path {
    fill: var(--ink-secondary);
  }

  .walk-line {
    width: 16px;
    height: 2px;
    border-radius: 0;
    background: var(--walk);
  }

  /* Right-aligned via auto margin (v11 issue 8): when the chips overflow
     onto a second line, the hint becomes its own deliberate right-aligned
     item instead of a ragged left-aligned tail. */
  .legend-hint {
    margin-left: auto;
    white-space: nowrap;
    color: var(--ink-muted);
  }

  .tooltip {
    position: fixed;
    z-index: 10;
    max-width: 260px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    pointer-events: none;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }

  .tooltip strong {
    display: block;
  }

  .tooltip .artist {
    color: var(--ink-secondary);
    display: block;
    margin-bottom: 4px;
  }

  .tooltip dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0;
    font-size: 12px;
  }

  .tooltip dt {
    color: var(--ink-muted);
  }

  .tooltip dd {
    margin: 0;
    color: var(--ink-secondary);
  }
</style>
