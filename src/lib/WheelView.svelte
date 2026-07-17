<script lang="ts">
  import { scaleLinear } from 'd3-scale'
  import { select as d3select } from 'd3-selection'
  import { cubicOut } from 'svelte/easing'
  import { Tween } from 'svelte/motion'
  import {
    symbol,
    symbolCircle,
    symbolDiamond,
    symbolSquare,
    symbolStar,
    symbolTriangle,
    symbolWye,
    type SymbolType,
  } from 'd3-shape'
  import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
  import { classIndexOfTrack } from '../core/iconClasses'
  import { ALL_CAMELOT_KEYS, wheelSlotAngleDeg, type CamelotKey } from '../core/keys'
  import { annularSectorPath, relaxSlotAngles } from '../core/layout'
  import type { Track } from '../core/model'
  import {
    COLOR_SCHEMES,
    focusEdgeOpacity,
    makeNodeColor,
    MISSING_COLORS,
    radialDomain,
  } from '../core/scales'
  import { effectiveTheme } from './theme'
  import { nextExhausted, retryState, suggestNext, type NextSuggestion } from '../core/suggest'
  import {
    appendToSet,
    criteria,
    effectiveColorAxis,
    focusEdges,
    filters,
    iconClasses,
    library,
    mustInclude,
    neighbours,
    pinnedFirst,
    pinnedLast,
    playlistScopedLibrary,
    radialAxis,
    rightPanel,
    selectedId,
    settings,
    trackById,
    tracklist,
    visibleLibrary,
  } from '../stores'

  const SIZE = 820
  const WIDTH = SIZE + 80 // extra room for the no-key gutter on the right
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R_MAX = 330
  const R_MIN = 110
  const R_FALLBACK = 70 // dashed inner circle: keyed tracks missing the radial value
  const GUTTER_X = SIZE + 26 // vertical strip for tracks with no key
  const GUTTER_MISSING_Y_GAP = 42

  const AXIS_LABEL = { bpm: 'BPM', rating: 'rating', year: 'year' } as const

  // Genre-class node shapes (docs/designs/design-v4.md §E): class 0 (largest) keeps
  // the circle; further classes get increasingly angular symbols.
  const CLASS_SYMBOLS: SymbolType[] = [
    symbolCircle,
    symbolSquare,
    symbolTriangle,
    symbolDiamond,
    symbolStar,
    symbolWye,
  ]
  // Plain Map on purpose: a render-time memo of static path strings, never
  // a reactive source (writing a SvelteMap during render would be a bug).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const shapeCache = new Map<string, string>()
  function shapePath(classIndex: number | null, r: number): string {
    const type =
      classIndex === null ? symbolCircle : CLASS_SYMBOLS[classIndex % CLASS_SYMBOLS.length]
    const key = `${classIndex === null ? -1 : classIndex % CLASS_SYMBOLS.length}:${r}`
    let path = shapeCache.get(key)
    if (path === undefined) {
      path =
        symbol()
          .type(type)
          .size(Math.PI * r * r)() ?? ''
      shapeCache.set(key, path)
    }
    return path
  }
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

  // The radial axis is the one part of the frame that rescales: its domain
  // follows the active filter for the radial metric, falling back to the
  // playlist selection's extent (design-v6 §A). Everything else — angles,
  // symbols, colour domain — stays put. The domain is niced up front and its
  // endpoints tweened, so rings, ticks and nodes glide instead of jumping.
  const radialValues = $derived(
    $playlistScopedLibrary.map((t) => t[$radialAxis]).filter((v): v is number => v !== null),
  )

  const targetDomain = $derived.by((): [number, number] => {
    const extent: [number, number] | null =
      radialValues.length === 0 ? null : [Math.min(...radialValues), Math.max(...radialValues)]
    const domain = radialDomain($filters[$radialAxis], extent)
    // Nice once here (not per animation frame — nicing interpolated
    // endpoints would make the tween judder in rounded steps).
    return scaleLinear().domain(domain).nice().domain() as [number, number]
  })

  // Deliberately seeds the tween with the initial domain (no mount
  // animation); the $effect below keeps it tracking changes.
  // 600ms reads noticeably calmer than the original 350 (issue 5).
  const RADIAL_TWEEN_MS = 600
  // svelte-ignore state_referenced_locally
  const domainTween = new Tween<[number, number]>(targetDomain, {
    duration: RADIAL_TWEEN_MS,
    easing: cubicOut,
  })
  $effect(() => {
    domainTween.target = targetDomain
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
    if (radialValues.length === 0 && $filters[$radialAxis] === null) return []
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
    const bySlot = new Map<string, Track[]>()
    for (const track of $library) {
      if (track.key === null) continue
      if (!bySlot.has(track.key)) bySlot.set(track.key, [])
      bySlot.get(track.key)!.push(track)
    }
    const targetScale = scaleLinear().domain(targetDomain).range([R_MIN, R_MAX]).clamp(true)
    const half = 7.5 * $settings.slotSpreadFactor
    for (const [key, group] of bySlot) {
      const offsets = relaxSlotAngles(
        group.map((track) => {
          const value = track[$radialAxis]
          return { id: track.id, r: value === null ? R_FALLBACK : targetScale(value) }
        }),
        half,
        NODE_WORLD_RADIUS,
      )
      const base = wheelSlotAngleDeg(key as CamelotKey)
      for (const [id, offset] of offsets) angles.set(id, base + offset)
    }
    return angles
  })

  // Placement runs over the FULL library so every track's angle (and gutter
  // slot) is independent of the filters: filtering only makes nodes appear
  // or disappear, leaving gaps in the fans — nothing moves (design-v6 §A).
  const nodes = $derived.by(() => {
    const placed: PlacedNode[] = []

    // Tracks without a key live in the gutter, still positioned by the radial
    // value (remark 3: a missing key must not hide a known BPM/year/rating).
    const unkeyed = $library
      .filter((t) => t.key === null)
      .sort((a, b) => (b[$radialAxis] ?? -1) - (a[$radialAxis] ?? -1) || a.id.localeCompare(b.id))
    // Plain Maps on purpose throughout this computation: derived-local
    // temporaries, rebuilt wholesale — reactivity lives in the $derived.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byBand = new Map<number, Track[]>()
    for (const track of unkeyed) {
      const value = track[$radialAxis]
      const y = value === null ? gutterBottom + GUTTER_MISSING_Y_GAP : gutterY(value)
      const band = Math.round(y / 16)
      if (!byBand.has(band)) byBand.set(band, [])
      byBand.get(band)!.push(track)
    }
    for (const [, group] of byBand) {
      group.forEach((track, i) => {
        const value = track[$radialAxis]
        const y = value === null ? gutterBottom + GUTTER_MISSING_Y_GAP : gutterY(value)
        const x = GUTTER_X + (i - (group.length - 1) / 2) * 14
        placed.push({ track, x, y, unkeyed: true, missingRadial: value === null })
      })
    }

    // Keyed tracks: the relaxed slot angle (memoised below — issue 17) plus
    // the tween-animated radius.
    for (const track of $library) {
      if (track.key === null) continue
      const value = track[$radialAxis]
      const angle = slotAngleById.get(track.id) ?? 0
      const r = value === null ? R_FALLBACK : radialScale(value)
      placed.push({ track, ...polar(angle, r), unkeyed: false, missingRadial: value === null })
    }
    return placed
  })

  const visibleIds = $derived(new Set($visibleLibrary.map((t) => t.id)))
  /** Only the visible placements are ever rendered or hit-tested. */
  const visibleNodes = $derived(nodes.filter((n) => visibleIds.has(n.track.id)))

  const nodeById = $derived(new Map(visibleNodes.map((n) => [n.track.id, n])))

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
    makeNodeColor($effectiveColorAxis, colorDomain, $settings.colorScheme, $effectiveTheme),
  )
  const ramp = $derived(COLOR_SCHEMES[$effectiveTheme][$settings.colorScheme])

  const walkPairs = $derived(
    $tracklist.slice(0, -1).map((id, i) => [id, $tracklist[i + 1]] as const),
  )

  const focusSet = $derived.by(() => {
    if ($selectedId === null) return null
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const set = new Set([$selectedId])
    for (const n of $neighbours.get($selectedId) ?? []) set.add(n)
    return set
  })

  function nodeOpacity(node: PlacedNode): number {
    const base = node.missingRadial ? 0.55 : 1
    if (focusSet !== null && !focusSet.has(node.track.id)) return 0.12
    return base
  }

  // Only focus edges are drawn at all (v9 issue 8): the selection's own star
  // brightens, the cluster's interconnections stay at the plain base.
  function edgeOpacity(sourceId: string, targetId: string): number {
    const isStar = sourceId === $selectedId || targetId === $selectedId
    return isStar ? focusEdgeOpacity($settings.edgeOpacity) : $settings.edgeOpacity
  }

  function select(node: PlacedNode) {
    selectedId.update((current) => (current === node.track.id ? null : node.track.id))
  }

  function appendToTracklist(node: PlacedNode) {
    appendToSet(node.track.id)
  }

  function keyLabelPos(key: CamelotKey) {
    return polar(wheelSlotAngleDeg(key), R_MAX + 26)
  }

  function trackSummary(t: Track): string {
    return [t.key ?? '—', t.bpm !== null ? `${t.bpm} BPM` : '—', t.genre ?? '—'].join(' · ')
  }

  const hasUnkeyed = $derived(visibleNodes.some((n) => n.unkeyed))
  const hasMissingRadial = $derived(visibleNodes.some((n) => !n.unkeyed && n.missingRadial))

  // --- zoom & pan (remark 10) ---
  let svgEl: SVGSVGElement
  let zoomTransform = $state('translate(0,0) scale(1)')
  // Node disks keep a constant screen size while zooming (their radii are
  // divided by k): zooming exists to resolve detail, not to inflate markers.
  let zoomK = $state(1)
  const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 8])
    .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
      zoomTransform = e.transform.toString()
      zoomK = e.transform.k
    })

  $effect(() => {
    const selection = d3select(svgEl)
    selection.call(zoomBehavior)
    selection.on('dblclick.zoom', null) // double-click appends to the set instead
    return () => selection.on('.zoom', null)
  })

  function zoomBy(factor: number) {
    zoomBehavior.scaleBy(d3select(svgEl), factor)
  }

  function zoomReset() {
    zoomBehavior.transform(d3select(svgEl), zoomIdentity)
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
  const hubExhausted = $derived(nextExhausted($neighbours, $tracklist, $selectedId))
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
    retryState($neighbours, $tracklist, lastHubPick, triedIds, [...visibleIds]),
  )

  function hubSuggest() {
    if (hubAllUsed) return
    const suggestion = suggestNext($visibleLibrary, $criteria, $tracklist, {
      selectedId: $selectedId,
      randomness: $settings.suggestRandomness,
      seed: hubSeed++,
      progression: $settings.bpmProgression,
      force: hubExhausted,
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
    const suggestion = suggestNext($visibleLibrary, $criteria, withoutPick, {
      selectedId: anchorId,
      randomness: $settings.suggestRandomness,
      seed: hubSeed++,
      progression: $settings.bpmProgression,
      force: state === 'force-retry',
      excludeIds: exclude,
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

  // --- selected-track card: details + the "must include" mark (design-v6 §C) ---
  const selectedTrack = $derived(
    $selectedId === null ? null : ($trackById.get($selectedId) ?? null),
  )
  const isMustIncluded = $derived($selectedId !== null && $mustInclude.includes($selectedId))
  function toggleMustInclude() {
    const id = $selectedId
    if (id === null) return
    mustInclude.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }
</script>

<svelte:window
  onkeydown={(e) => {
    // With the advanced panel open, Escape belongs to closing the panel.
    if (e.key === 'Escape' && $rightPanel === 'set') selectedId.set(null)
  }}
/>

<div
  class="wheel-wrap"
  role="presentation"
  onmousemove={(e) => (mouse = { x: e.clientX, y: e.clientY })}
  onclick={(e) => {
    if ((e.target as Element).tagName === 'svg') selectedId.set(null)
  }}
>
  <svg
    bind:this={svgEl}
    viewBox="0 0 {WIDTH} {SIZE}"
    role="application"
    aria-label="Camelot wheel of the track library"
  >
    <g class="zoom-layer" transform={zoomTransform}>
      <!-- Radial grid + tick labels -->
      {#each gridTicks as tick (tick)}
        <circle
          cx={CX}
          cy={CY}
          r={radialScale(tick)}
          class="gridline"
          vector-effect="non-scaling-stroke"
        />
        <text x={CX + 6} y={CY - radialScale(tick) - 4} class="tick-label">{tick}</text>
      {/each}
      {#if hasMissingRadial}
        <circle
          cx={CX}
          cy={CY}
          r={R_FALLBACK}
          class="gridline dashed"
          vector-effect="non-scaling-stroke"
        />
        <text x={CX} y={CY - R_FALLBACK - 8} class="zone-label" text-anchor="middle">
          no {AXIS_LABEL[$radialAxis]} value
        </text>
      {/if}

      <!-- Key sector backgrounds: subtle minor (A) vs major (B) tint per slot.
           The minor/major filter (v8 issue 10) fades the excluded ring's tint
           so the wheel visibly answers the toggle beyond nodes vanishing. -->
      {#each ALL_CAMELOT_KEYS as key (key)}
        {@const centre = wheelSlotAngleDeg(key)}
        <path
          d={annularSectorPath(CX, CY, centre - 7.5, centre + 7.5, R_MIN - 30, R_MAX + 12)}
          class="sector"
          class:major={key.endsWith('B')}
          class:excluded={($filters.keyRing === 'minor' && key.endsWith('B')) ||
            ($filters.keyRing === 'major' && key.endsWith('A'))}
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

      <!-- Key slot labels -->
      <circle cx={CX} cy={CY} r={R_MAX + 12} class="ring" vector-effect="non-scaling-stroke" />
      {#each ALL_CAMELOT_KEYS as key (key)}
        {@const pos = keyLabelPos(key)}
        <text
          x={pos.x}
          y={pos.y}
          class="key-label"
          class:major={key.endsWith('B')}
          class:excluded={($filters.keyRing === 'minor' && key.endsWith('B')) ||
            ($filters.keyRing === 'major' && key.endsWith('A'))}
          dominant-baseline="middle"
          text-anchor="middle">{key}</text
        >
      {/each}

      <!-- No-key gutter: same scale as the wheel radius, vertically -->
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
          <text x={GUTTER_X + 9} y={gutterY(tick) + 3} class="gutter-tick-label">{tick}</text>
        {/each}
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

      <!-- Hub button: suggest the next track for the set -->
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

      <!-- Walk (current tracklist) drawn above suggestions -->
      <defs>
        <marker
          id="walk-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--walk)" />
        </marker>
      </defs>
      <!-- Keyed by position: the same ordered pair can occur twice when a
           track appears in the set more than once (remark 15). -->
      {#each walkPairs as [fromId, toId], pairIndex (pairIndex)}
        {@const a = nodeById.get(fromId)}
        {@const b = nodeById.get(toId)}
        {#if a && b}
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            class="walk-edge"
            marker-end="url(#walk-arrow)"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}

      <!-- Nodes -->
      {#each visibleNodes as node (node.track.id)}
        <g
          class="node"
          opacity={nodeOpacity(node)}
          role="button"
          tabindex="0"
          aria-label="{node.track.title} — {trackSummary(node.track)}"
          onmouseenter={() => (hovered = node)}
          onmouseleave={() => (hovered = null)}
          onclick={() => select(node)}
          ondblclick={() => appendToTracklist(node)}
          onkeydown={(e) => {
            if (e.key === 'Enter') select(node)
            if (e.key === '+') appendToTracklist(node)
          }}
        >
          <circle cx={node.x} cy={node.y} r={11 / zoomK} fill="transparent" />
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
            vector-effect="non-scaling-stroke"
          />
        </g>
      {/each}

      <!-- Hub button, painted LAST so edges and nodes never steal its
           clicks (issue 17), with an oversized transparent hit circle. -->
      {#if $visibleLibrary.length > 0}
        {#if hubRetryState !== 'none'}
          <g
            class="hub-retry"
            class:force={hubRetryState === 'force-retry'}
            class:spent={hubRetryState === 'reset-only'}
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
            <circle cx={CX} cy={CY} r="52" class="retry-hit" />
            <circle cx={CX} cy={CY} r="52" class="retry-ring" vector-effect="non-scaling-stroke" />
            <text x={CX} y={CY + 70} class="retry-label" text-anchor="middle"
              >{hubRetryState === 'force-retry'
                ? 'force retry'
                : hubRetryState === 'reset-only'
                  ? 'all tried'
                  : 'retry'}</text
            >
          </g>
          {#if hubRetryState !== 'retry' && triedIds.length > 0 && originalPickId !== lastHubPick?.trackId}
            <!-- ⟲ reset-to-original: part of the force-retry morph (issue 3),
                 shown only while the slot actually diverges from the original -->
            <g
              class="hub-reset"
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
        {/if}
        <g
          class="hub"
          class:warning={hubExhausted && !hubAllUsed}
          class:disabled={hubAllUsed}
          role="button"
          tabindex={hubAllUsed ? -1 : 0}
          aria-disabled={hubAllUsed}
          aria-label={hubAllUsed
            ? 'Every track is already in the set'
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
              ? 'Every visible track is already in the set'
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
  <div class="legend" class:with-card={selectedTrack !== null}>
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
    <span class="chip walk-chip"><i class="walk-line"></i>your set</span>
    <span class="legend-hint">click: focus · double-click: add to set</span>
  </div>

  <!-- Selected-track card: the persistent home of a selection's details,
       and where a track is marked "must include" (design-v6 §C). Anchored
       bottom-RIGHT beside the set panel (v8 issue 9) so it never sits on
       the legend; the legend's right bound clears it while it shows. -->
  {#if selectedTrack}
    <div class="selected-card">
      <strong>{selectedTrack.title}</strong>
      <span class="artist">{selectedTrack.artist ?? 'Unknown artist'}</span>
      <dl>
        <dt>Key</dt>
        <dd>{selectedTrack.key ?? 'missing'}</dd>
        <dt>BPM</dt>
        <dd>{selectedTrack.bpm ?? 'missing'}</dd>
        <dt>Genre</dt>
        <dd>{selectedTrack.genre ?? 'missing'}</dd>
      </dl>
      <button
        class="must-toggle"
        class:on={isMustIncluded}
        aria-pressed={isMustIncluded}
        title="Suggested sets will strongly favour including this track"
        onclick={toggleMustInclude}
      >
        {isMustIncluded ? '★ in suggested sets' : '☆ must include in suggested sets'}
      </button>
    </div>
  {/if}

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
    transition: opacity 0.5s ease;
  }

  .sector.major {
    fill: var(--sector-major);
  }

  .sector.excluded {
    opacity: 0.15;
  }

  .key-label {
    transition: opacity 0.5s ease;
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

  .key-label.major {
    fill: var(--ink-secondary);
    font-weight: 600;
  }

  .combo-edge {
    stroke: var(--edge);
    stroke-width: 1;
  }

  .walk-edge {
    stroke: var(--walk);
    stroke-width: 2;
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

  /* Retry ring: a second, outer target that redraws the last hub pick. */
  .hub-retry {
    cursor: pointer;
    outline: none;
  }

  .retry-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 18;
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
    /* Bounded on the right (zoom controls live there) and wrapping: on
       narrow windows the legend must never spill over the side panels
       and swallow their clicks (ISSUES.md #13). */
    right: 72px;
    transition: right 0.3s ease;
    flex-wrap: wrap;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-secondary);
    font-size: 12px;
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

  .legend-hint {
    margin-left: 12px;
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

  .selected-card {
    position: absolute;
    right: 52px; /* clear of the zoom-controls column */
    bottom: 10px;
    max-width: 240px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
  }

  .legend.with-card {
    right: 306px; /* 52px offset + 240px card + breathing room */
  }

  .selected-card strong {
    display: block;
  }

  .selected-card .artist {
    color: var(--ink-secondary);
    display: block;
    margin-bottom: 4px;
  }

  .selected-card dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0 0 6px;
    font-size: 12px;
  }

  .selected-card dt {
    color: var(--ink-muted);
  }

  .selected-card dd {
    margin: 0;
    color: var(--ink-secondary);
  }

  .must-toggle {
    width: 100%;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .must-toggle.on {
    color: var(--accent);
    border-color: var(--accent);
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
