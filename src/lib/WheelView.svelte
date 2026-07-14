<script lang="ts">
  import { scaleLinear } from 'd3-scale'
  import { ALL_CAMELOT_KEYS, wheelSlotAngleDeg, type CamelotKey } from '../core/keys'
  import { slotAngleOffsets } from '../core/layout'
  import type { Track } from '../core/model'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { edges, library, neighbours, radialAxis, selectedId, tracklist } from '../stores'

  const SIZE = 820
  const CENTER = SIZE / 2
  const R_MAX = 330
  const R_MIN = 110
  const R_FALLBACK = 70 // dashed inner circle for tracks missing the radial value
  const R_UNKEYED = 32 // small hub for tracks with no key

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
    return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) }
  }

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

  const gridTicks = $derived(radialValues.length > 0 ? radialScale.ticks(4) : [])

  const nodes = $derived.by(() => {
    const placed: PlacedNode[] = []
    const unkeyed = $library.filter((t) => t.key === null)
    unkeyed.forEach((track, i) => {
      const angle = (360 / unkeyed.length) * i
      placed.push({ track, ...polar(angle, R_UNKEYED), unkeyed: true, missingRadial: true })
    })
    // Group keyed tracks per slot and fan each group out so that tracks with
    // the same key and a similar radius stay individually hoverable.
    const bySlot = new SvelteMap<string, Track[]>()
    for (const track of $library) {
      if (track.key === null) continue
      if (!bySlot.has(track.key)) bySlot.set(track.key, [])
      bySlot.get(track.key)!.push(track)
    }
    for (const [key, group] of bySlot) {
      group.sort(
        (a, b) => (a[$radialAxis] ?? 0) - (b[$radialAxis] ?? 0) || a.id.localeCompare(b.id),
      )
      const offsets = slotAngleOffsets(group.length)
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

  function ratingColor(track: Track): string {
    if (track.rating === null) return 'var(--missing)'
    return `var(--rating-${Math.max(0, Math.min(5, Math.round(track.rating)))})`
  }

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
    const base = node.unkeyed || node.missingRadial ? 0.55 : 1
    if (focusSet !== null && !focusSet.has(node.track.id)) return 0.12
    return base
  }

  function edgeOpacity(sourceId: string, targetId: string): number {
    if (focusSet === null) return 0.35
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
    viewBox="0 0 {SIZE} {SIZE}"
    role="application"
    aria-label="Camelot wheel of the track library"
  >
    <!-- Radial grid + tick labels -->
    {#each gridTicks as tick (tick)}
      <circle cx={CENTER} cy={CENTER} r={radialScale(tick)} class="gridline" />
      <text x={CENTER + 6} y={CENTER - radialScale(tick) - 4} class="tick-label">{tick}</text>
    {/each}
    <circle cx={CENTER} cy={CENTER} r={R_FALLBACK} class="gridline dashed" />

    <!-- Sector boundaries between Camelot numbers -->
    {#each Array.from({ length: 12 }, (_, i) => i * 30) as boundary (boundary)}
      {@const inner = polar(boundary, R_MIN - 30)}
      {@const outer = polar(boundary, R_MAX + 12)}
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} class="spoke" />
    {/each}

    <!-- Key slot labels; minor (A) inside the ring line, major (B) outside -->
    <circle cx={CENTER} cy={CENTER} r={R_MAX + 12} class="ring" />
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
    {#each walkPairs as [fromId, toId] (fromId + '→' + toId)}
      {@const a = nodeById.get(fromId)}
      {@const b = nodeById.get(toId)}
      {#if a && b}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="walk-edge" marker-end="url(#walk-arrow)" />
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
        <circle cx={node.x} cy={node.y} r="11" fill="transparent" />
        <circle
          cx={node.x}
          cy={node.y}
          r={node.track.id === $selectedId ? 7 : 5}
          fill={ratingColor(node.track)}
          class="dot"
          class:selected={node.track.id === $selectedId}
          class:in-walk={$tracklist.includes(node.track.id)}
        />
      </g>
    {/each}
  </svg>

  <!-- Legend -->
  <div class="legend">
    <span class="legend-title">Rating</span>
    {#each [0, 1, 2, 3, 4, 5] as stars (stars)}
      <span class="chip"><i style="background: var(--rating-{stars})"></i>{stars}</span>
    {/each}
    <span class="chip"><i style="background: var(--missing)"></i>none</span>
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
        <dd>{hovered.track.rating ?? 'missing'}</dd>
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

  svg {
    width: 100%;
    height: 100%;
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
