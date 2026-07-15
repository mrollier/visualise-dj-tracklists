<script lang="ts">
  import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    type Simulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
  } from 'd3-force'
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
  import { get } from 'svelte/store'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    genreComponents,
    GENRE_METHODS,
    labelSimilarity,
    packNeighbours,
    type GenreMethod,
  } from '../core/genre'
  import { criteria, genreClasses, visibleLibrary } from '../stores'

  const WIDTH = 900
  const HEIGHT = 820

  // Method overlay colours: first six dark categorical slots of the palette,
  // validated against both surfaces (dark #1a1a19, light #f7f6f2; see
  // docs/designs/design-v4.md §F and design-v5.md §E). Taxonomy is dashed as
  // secondary encoding for the graph↔taxonomy CVD floor pair.
  const METHOD_COLOR: Record<GenreMethod, string> = {
    exact: '#3987e5',
    lexical: '#199e70',
    graph: '#c98500',
    taxonomy: '#008300',
    embedding: '#9085e9',
    hybrid: '#e66767',
  }
  const METHOD_DASH: Partial<Record<GenreMethod, string>> = { taxonomy: '6 4' }

  /** Edges thinner than this score are noise, not links. */
  const SCORE_FLOOR = 0.15
  const GHOSTS_PER_GENRE = 3

  const CLASS_SYMBOLS: SymbolType[] = [
    symbolCircle,
    symbolSquare,
    symbolTriangle,
    symbolDiamond,
    symbolStar,
    symbolWye,
  ]

  let showNeighbours = $state(false)
  // Default overlay = the criterion's active method, seeded once at mount —
  // the user's chip toggles must stick afterwards. SvelteSet mutations are
  // reactive on their own.
  const enabledMethods = new SvelteSet<GenreMethod>([get(criteria).genre.method])

  function toggleMethod(method: GenreMethod) {
    if (enabledMethods.has(method)) enabledMethods.delete(method)
    else enabledMethods.add(method)
  }

  interface GenreNode extends SimulationNodeDatum {
    id: string
    count: number
    ghost: boolean
  }

  interface GenreEdge {
    a: string
    b: string
    method: GenreMethod
    score: number
  }

  interface GenreLink extends SimulationLinkDatum<GenreNode> {
    score: number
  }

  // --- data: library genres (+ optional pack ghosts) --------------------------
  const genreCounts = $derived.by(() => {
    // Plain Map/Set on purpose here and below: derived-local collections,
    // rebuilt wholesale — reactivity lives in the $derived itself.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const counts = new Map<string, number>()
    for (const track of $visibleLibrary) {
      if (track.genre === null) continue
      for (const label of genreComponents(track.genre)) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    return counts
  })

  const ghostLabels = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const ghosts = new Set<string>()
    if (!showNeighbours) return ghosts
    for (const label of genreCounts.keys()) {
      for (const [neighbour] of packNeighbours(label, GHOSTS_PER_GENRE)) {
        if (!genreCounts.has(neighbour)) ghosts.add(neighbour)
      }
    }
    return ghosts
  })

  const labels = $derived([...genreCounts.keys(), ...ghostLabels].sort())

  const edges = $derived.by(() => {
    const list: GenreEdge[] = []
    for (const method of GENRE_METHODS) {
      if (!enabledMethods.has(method)) continue
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const score = labelSimilarity(labels[i], labels[j], method)
          if (score >= SCORE_FLOOR) {
            list.push({ a: labels[i], b: labels[j], method, score })
          }
        }
      }
    }
    return list
  })

  /** Strongest score per pair across enabled overlays — drives the layout. */
  const pairStrength = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const best = new Map<string, number>()
    for (const { a, b, score } of edges) {
      const key = `${a}\u001f${b}`
      best.set(key, Math.max(best.get(key) ?? 0, score))
    }
    return best
  })

  // --- genre classes: same clustering as the wheel ----------------------------
  function classIndexOf(label: string): number | null {
    return $genreClasses?.classOf.get(label) ?? null
  }

  // Plain Map on purpose: a render-time memo of static path strings, never
  // a reactive source (writing a SvelteMap during render would be a bug).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const shapeCache = new Map<string, string>()
  function shapePath(classIndex: number | null, r: number): string {
    const idx = classIndex === null ? -1 : classIndex % CLASS_SYMBOLS.length
    const key = `${idx}:${r}`
    let path = shapeCache.get(key)
    if (path === undefined) {
      const type = idx === -1 ? symbolCircle : CLASS_SYMBOLS[idx]
      path =
        symbol()
          .type(type)
          .size(Math.PI * r * r)() ?? ''
      shapeCache.set(key, path)
    }
    return path
  }

  function nodeRadius(node: GenreNode): number {
    return node.ghost ? 5 : 6 + 3.5 * Math.sqrt(node.count)
  }

  // --- force layout ------------------------------------------------------------
  let positioned = $state<GenreNode[]>([])
  let simulation: Simulation<GenreNode, undefined> | null = null
  const nodeById = $derived(new Map(positioned.map((n) => [n.id, n])))
  // Plain Map on purpose: non-reactive position memory. The layout effect
  // must not subscribe to it, or every simulation tick would restart the
  // simulation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const lastPosition = new Map<string, { x: number; y: number }>()

  $effect(() => {
    const nodes: GenreNode[] = labels.map((id) => {
      const previous = lastPosition.get(id)
      return {
        id,
        count: genreCounts.get(id) ?? 0,
        ghost: ghostLabels.has(id),
        // keep previous positions so toggles reheat instead of restart
        x: previous?.x,
        y: previous?.y,
      }
    })
    const links: GenreLink[] = [...pairStrength.entries()].map(([key, score]) => {
      const [a, b] = key.split('\u001f')
      return { source: a, target: b, score }
    })
    simulation?.stop()
    simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<GenreNode, GenreLink>(links)
          .id((d) => d.id)
          .distance((l) => 40 + 220 * (1 - l.score))
          .strength((l) => 0.3 + 0.5 * l.score),
      )
      .force('charge', forceManyBody().strength(-260))
      .force(
        'collide',
        forceCollide<GenreNode>().radius((d) => nodeRadius(d) + 16),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .on('tick', () => {
        const current = simulation!.nodes() as GenreNode[]
        for (const n of current) {
          if (n.x !== undefined && n.y !== undefined) lastPosition.set(n.id, { x: n.x, y: n.y })
        }
        positioned = [...current]
      })
    return () => simulation?.stop()
  })

  // --- zoom (same pattern as the wheel) ---------------------------------------
  let svgEl: SVGSVGElement
  let zoomTransform = $state('translate(0,0) scale(1)')
  const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 6])
    .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
      zoomTransform = e.transform.toString()
    })

  $effect(() => {
    const selection = d3select(svgEl)
    selection.call(zoomBehavior)
    return () => selection.on('.zoom', null)
  })

  function zoomBy(factor: number) {
    zoomBehavior.scaleBy(d3select(svgEl), factor)
  }
  function zoomReset() {
    zoomBehavior.transform(d3select(svgEl), zoomIdentity)
  }

  // --- hover: a pair's scores under every method -------------------------------
  let hoveredPair = $state<{ a: string; b: string } | null>(null)
  let hoveredGenre = $state<string | null>(null)
  let mouse = $state({ x: 0, y: 0 })

  const hoveredScores = $derived.by(() => {
    const pair = hoveredPair
    if (pair === null) return []
    return GENRE_METHODS.map((method) => ({
      method,
      score: labelSimilarity(pair.a, pair.b, method),
    }))
  })

  /** Per-method perpendicular offset so parallel overlays stay visible. */
  function edgeOffset(method: GenreMethod, a: GenreNode, b: GenreNode): string {
    const active = GENRE_METHODS.filter((m) => enabledMethods.has(m))
    if (active.length < 2) return ''
    const idx = active.indexOf(method)
    const dx = (b.x ?? 0) - (a.x ?? 0)
    const dy = (b.y ?? 0) - (a.y ?? 0)
    const len = Math.hypot(dx, dy) || 1
    const shift = (idx - (active.length - 1) / 2) * 2.5
    return `translate(${(-dy / len) * shift},${(dx / len) * shift})`
  }

  function edgeVisible(edge: GenreEdge): boolean {
    if (hoveredGenre === null) return true
    return edge.a === hoveredGenre || edge.b === hoveredGenre
  }
</script>

<div
  class="map-wrap"
  role="presentation"
  onmousemove={(e) => (mouse = { x: e.clientX, y: e.clientY })}
>
  <svg
    bind:this={svgEl}
    viewBox="0 0 {WIDTH} {HEIGHT}"
    role="application"
    aria-label="Genre map of the library"
  >
    <g class="zoom-layer" transform={zoomTransform}>
      {#each edges as edge (`${edge.method}→${edge.a}→${edge.b}`)}
        {@const a = nodeById.get(edge.a)}
        {@const b = nodeById.get(edge.b)}
        {#if a && b}
          <g transform={edgeOffset(edge.method, a, b)} opacity={edgeVisible(edge) ? 1 : 0.06}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={METHOD_COLOR[edge.method]}
              stroke-width={0.75 + 2 * edge.score}
              stroke-dasharray={METHOD_DASH[edge.method] ?? 'none'}
              opacity={0.25 + 0.55 * edge.score}
              class="edge"
            />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              class="edge-hit"
              role="presentation"
              onmouseenter={() => (hoveredPair = { a: edge.a, b: edge.b })}
              onmouseleave={() => (hoveredPair = null)}
            />
          </g>
        {/if}
      {/each}

      {#each positioned as node (node.id)}
        <g
          class="genre-node"
          class:ghost={node.ghost}
          transform="translate({node.x ?? WIDTH / 2},{node.y ?? HEIGHT / 2})"
          role="img"
          aria-label="{node.id}{node.ghost
            ? ' (nearby, not in library)'
            : ` — ${node.count} tracks`}"
          onmouseenter={() => (hoveredGenre = node.id)}
          onmouseleave={() => (hoveredGenre = null)}
        >
          <path
            d={shapePath(node.ghost ? null : classIndexOf(node.id), nodeRadius(node))}
            class="mark"
          />
          <text y={nodeRadius(node) + 12} text-anchor="middle" class="genre-label">
            {node.id}
          </text>
        </g>
      {/each}
    </g>
  </svg>

  <!-- Method overlay chips -->
  <div class="overlays">
    <span class="overlays-title">Link methods</span>
    {#each GENRE_METHODS as method (method)}
      <button
        class="method-chip"
        class:on={enabledMethods.has(method)}
        style="--chip: {METHOD_COLOR[method]}"
        onclick={() => toggleMethod(method)}
      >
        <i class:dashed={METHOD_DASH[method] !== undefined}></i>
        {method}
      </button>
    {/each}
    <label class="ghost-toggle">
      <input type="checkbox" bind:checked={showNeighbours} />
      show nearby genres
    </label>
  </div>

  <!-- Zoom controls -->
  <div class="zoom-controls">
    <button aria-label="Zoom in" title="Zoom in" onclick={() => zoomBy(1.4)}>+</button>
    <button aria-label="Zoom out" title="Zoom out" onclick={() => zoomBy(1 / 1.4)}>−</button>
    <button aria-label="Reset zoom" title="Reset zoom" onclick={zoomReset}>⌂</button>
  </div>

  <div class="legend">
    <span class="legend-hint">
      node size: tracks with that genre · distance ≈ similarity under the enabled methods · hover a
      line for every method's score
    </span>
  </div>

  {#if hoveredPair}
    <div class="tooltip" style="left: {mouse.x + 14}px; top: {mouse.y + 12}px">
      <strong>{hoveredPair.a} ↔ {hoveredPair.b}</strong>
      <dl>
        {#each hoveredScores as { method, score } (method)}
          <dt><i style="background: {METHOD_COLOR[method]}"></i>{method}</dt>
          <dd>{score.toFixed(2)}</dd>
        {/each}
      </dl>
    </div>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    background: var(--surface);
  }

  .map-wrap > svg {
    width: 100%;
    height: 100%;
  }

  .edge-hit {
    stroke: transparent;
    stroke-width: 10;
    cursor: help;
  }

  .genre-node {
    cursor: default;
  }

  .genre-node .mark {
    fill: var(--accent);
    fill-opacity: 0.85;
    stroke: var(--node-ring);
    stroke-width: 1;
  }

  .genre-node.ghost .mark {
    fill: none;
    stroke: var(--ink-muted);
    stroke-dasharray: 3 3;
  }

  .genre-node.ghost .genre-label {
    fill: var(--ink-muted);
    font-style: italic;
  }

  .genre-label {
    fill: var(--ink-secondary);
    font-size: 11px;
    pointer-events: none;
  }

  .overlays {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    max-width: 70%;
  }

  .overlays-title {
    color: var(--ink-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-right: 4px;
  }

  .method-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface-raised);
    color: var(--ink-muted);
  }

  .method-chip i {
    width: 14px;
    height: 0;
    border-top: 2px solid var(--chip);
    opacity: 0.35;
  }

  .method-chip i.dashed {
    border-top-style: dashed;
  }

  .method-chip.on {
    color: var(--ink);
    border-color: var(--chip);
  }

  .method-chip.on i {
    opacity: 1;
  }

  .ghost-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--ink-secondary);
    margin-left: 8px;
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
    font-size: 12px;
  }

  .legend-hint {
    color: var(--ink-muted);
  }

  .tooltip {
    position: fixed;
    z-index: 10;
    max-width: 280px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    pointer-events: none;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }

  .tooltip dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 4px 0 0;
    font-size: 12px;
  }

  .tooltip dt {
    color: var(--ink-muted);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .tooltip dt i {
    width: 10px;
    height: 2px;
    display: inline-block;
  }

  .tooltip dd {
    margin: 0;
    color: var(--ink-secondary);
  }
</style>
