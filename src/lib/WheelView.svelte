<script lang="ts">
  import { scaleLinear } from 'd3-scale'
  import { select as d3select } from 'd3-selection'
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
  import { genreComponents } from '../core/genre'
  import { ALL_CAMELOT_KEYS, wheelSlotAngleDeg, type CamelotKey } from '../core/keys'
  import { annularSectorPath, slotAngleOffsets } from '../core/layout'
  import type { Track } from '../core/model'
  import { COLOR_SCHEMES, makeNodeColor, MISSING_COLORS } from '../core/scales'
  import { effectiveTheme } from './theme'
  import { suggestNext } from '../core/suggest'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import {
    criteria,
    edges,
    effectiveColorAxis,
    genreClasses,
    library,
    neighbours,
    radialAxis,
    selectedId,
    settings,
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
    if ($genreClasses === null || track.genre === null) return null
    return $genreClasses.classOf.get(genreComponents(track.genre)[0]) ?? null
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

  // The wheel's frame (radial scale, ticks, colour domain) derives from the
  // FULL library: filtering adds/removes nodes on a static background and must
  // never rescale the axes (design-v5 §A).
  const radialValues = $derived(
    $library.map((t) => t[$radialAxis]).filter((v): v is number => v !== null),
  )

  const radialScale = $derived.by(() => {
    const lo = Math.min(...radialValues)
    const hi = Math.max(...radialValues)
    return scaleLinear()
      .domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
      .range([R_MIN, R_MAX])
      .nice()
  })

  // Ratings and years are inherently whole — a ring at "4.6 stars" means
  // nothing, so fractional ticks are dropped for those axes (remark 14).
  const gridTicks = $derived.by(() => {
    if (radialValues.length === 0) return []
    const ticks = radialScale.ticks(4)
    return $radialAxis === 'bpm' ? ticks : ticks.filter(Number.isInteger)
  })

  /** Same scale as the wheel radius, mapped onto the vertical gutter strip. */
  function gutterY(value: number): number {
    return CY - (radialScale(value) - (R_MIN + R_MAX) / 2)
  }
  const gutterTop = $derived(CY - (R_MAX - R_MIN) / 2)
  const gutterBottom = $derived(CY + (R_MAX - R_MIN) / 2)

  const nodes = $derived.by(() => {
    const placed: PlacedNode[] = []

    // Tracks without a key live in the gutter, still positioned by the radial
    // value (remark 3: a missing key must not hide a known BPM/year/rating).
    const unkeyed = $visibleLibrary
      .filter((t) => t.key === null)
      .sort((a, b) => (b[$radialAxis] ?? -1) - (a[$radialAxis] ?? -1) || a.id.localeCompare(b.id))
    const byBand = new SvelteMap<number, Track[]>()
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

    // Keyed tracks: group per slot and fan out so same-key tracks with a
    // similar radius stay individually hoverable.
    const bySlot = new SvelteMap<string, Track[]>()
    for (const track of $visibleLibrary) {
      if (track.key === null) continue
      if (!bySlot.has(track.key)) bySlot.set(track.key, [])
      bySlot.get(track.key)!.push(track)
    }
    for (const [key, group] of bySlot) {
      group.sort(
        (a, b) => (a[$radialAxis] ?? 0) - (b[$radialAxis] ?? 0) || a.id.localeCompare(b.id),
      )
      const offsets = slotAngleOffsets(group.length, $settings.slotSpreadDeg)
      group.forEach((track, i) => {
        const value = track[$radialAxis]
        const angle = wheelSlotAngleDeg(key as CamelotKey) + offsets[i]
        const r = value === null ? R_FALLBACK : radialScale(value)
        placed.push({ track, ...polar(angle, r), unkeyed: false, missingRadial: value === null })
      })
    }
    return placed
  })

  const nodeById = $derived(new Map(nodes.map((n) => [n.track.id, n])))

  const colorDomain = $derived.by((): [number, number] => {
    const values = $library
      .map((t) => t[$effectiveColorAxis])
      .filter((v): v is number => v !== null)
    if (values.length === 0) return [0, 1]
    return [Math.min(...values), Math.max(...values)]
  })

  /** Tracks per genre class among the *visible* nodes — greys out legend chips. */
  const visibleClassCounts = $derived.by(() => {
    const counts = new SvelteMap<number, number>()
    for (const track of $visibleLibrary) {
      const index = classIndexOf(track)
      if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1)
    }
    return counts
  })

  const nodeColor = $derived(
    makeNodeColor($effectiveColorAxis, colorDomain, $settings.colorScheme, $effectiveTheme),
  )
  const ramp = $derived(COLOR_SCHEMES[$effectiveTheme][$settings.colorScheme])

  const walkPairs = $derived(
    $tracklist.slice(0, -1).map((id, i) => [id, $tracklist[i + 1]] as const),
  )

  const focusSet = $derived.by(() => {
    if ($selectedId === null) return null
    const set = new SvelteSet([$selectedId])
    for (const n of $neighbours.get($selectedId) ?? []) set.add(n)
    return set
  })

  function nodeOpacity(node: PlacedNode): number {
    const base = node.missingRadial ? 0.55 : 1
    if (focusSet !== null && !focusSet.has(node.track.id)) return 0.12
    return base
  }

  function edgeOpacity(sourceId: string, targetId: string): number {
    if (focusSet === null) return $settings.edgeOpacity
    return focusSet.has(sourceId) && focusSet.has(targetId) ? 0.6 : 0.05
  }

  function select(node: PlacedNode) {
    selectedId.update((current) => (current === node.track.id ? null : node.track.id))
  }

  function appendToTracklist(node: PlacedNode) {
    tracklist.update((ids) =>
      ids[ids.length - 1] === node.track.id ? ids : [...ids, node.track.id],
    )
  }

  function keyLabelPos(key: CamelotKey) {
    return polar(wheelSlotAngleDeg(key), R_MAX + 26)
  }

  function trackSummary(t: Track): string {
    return [t.key ?? '—', t.bpm !== null ? `${t.bpm} BPM` : '—', t.genre ?? '—'].join(' · ')
  }

  const hasUnkeyed = $derived(nodes.some((n) => n.unkeyed))
  const hasMissingRadial = $derived(nodes.some((n) => !n.unkeyed && n.missingRadial))

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
  // neighbours), otherwise appends after the last track.
  let hubSeed = 0
  function hubSuggest() {
    const suggestion = suggestNext($visibleLibrary, $criteria, $tracklist, {
      selectedId: $selectedId,
      randomness: $settings.suggestRandomness,
      seed: hubSeed++,
    })
    if (suggestion === null) return
    tracklist.update((ids) => ids.toSpliced(suggestion.insertIndex, 0, suggestion.trackId))
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') selectedId.set(null)
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

      <!-- Key sector backgrounds: subtle minor (A) vs major (B) tint per slot -->
      {#each ALL_CAMELOT_KEYS as key (key)}
        {@const centre = wheelSlotAngleDeg(key)}
        <path
          d={annularSectorPath(CX, CY, centre - 7.5, centre + 7.5, R_MIN - 30, R_MAX + 12)}
          class="sector"
          class:major={key.endsWith('B')}
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
      {#if $visibleLibrary.length > 0}
        <g
          class="hub"
          role="button"
          tabindex="0"
          aria-label="Suggest next track"
          onclick={hubSuggest}
          onkeydown={(e) => {
            if (e.key === 'Enter') hubSuggest()
          }}
        >
          <circle cx={CX} cy={CY} r="34" class="hub-circle" vector-effect="non-scaling-stroke" />
          <text x={CX} y={CY - 2} class="hub-plus" text-anchor="middle">+</text>
          <text x={CX} y={CY + 16} class="hub-label" text-anchor="middle">next</text>
        </g>
      {/if}

      <!-- Suggestion edges -->
      {#each $edges as edge (edge.sourceId + edge.targetId)}
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
      {#each nodes as node (node.track.id)}
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
    </g>
  </svg>

  {#if $visibleLibrary.length === 0}
    <div class="no-visible">
      <strong>Nothing to show yet.</strong>
      <span>Select a playlist or loosen the filters on the left to populate the wheel.</span>
    </div>
  {/if}

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
    {#if $genreClasses !== null}
      {#each $genreClasses.classes as cls, i (cls.label)}
        {@const visible = visibleClassCounts.get(i) ?? 0}
        <span
          class="chip shape-chip"
          class:dimmed={visible === 0}
          title="{visible} of {cls.size} tracks visible"
        >
          <svg width="12" height="12" viewBox="-6 -6 12 12"><path d={shapePath(i, 4)} /></svg>
          {cls.label}
        </span>
      {/each}
    {/if}
    <span class="chip walk-chip"><i class="walk-line"></i>your set</span>
    <span class="legend-hint">click: focus · double-click: add to set</span>
  </div>

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

  .no-visible {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    text-align: center;
    color: var(--ink-secondary);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 20px;
    font-size: 13px;
    max-width: 320px;
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
  }

  .sector.major {
    fill: var(--sector-major);
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

  .hub-circle {
    fill: var(--surface-raised);
    stroke: var(--baseline);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  .hub:hover .hub-circle,
  .hub:focus-visible .hub-circle {
    stroke: var(--accent);
    stroke-dasharray: none;
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

  .dot {
    stroke: rgba(255, 255, 255, 0.25);
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

  /* Class fully filtered out: the chip stays (stable legend), just greyed. */
  .shape-chip.dimmed {
    opacity: 0.35;
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
