<script lang="ts">
  import {
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
    type Simulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
  } from 'd3-force'
  import { matchedGenrePairs } from '../core/combos'
  import { genreComponents, labelSimilarity, sharedGenreAncestor } from '../core/genre'
  import {
    edgeTier,
    ghostAnchors,
    mapMotion,
    pairKey,
    skeletonKeys,
    skeletonOpacity,
  } from '../core/genreMap'
  import { genreFamilyClasses } from '../core/iconClasses'
  import { criteria, genreMatcher, playlistScopedLibrary, visibleLibrary } from '../stores'
  import { createShapePathCache } from './shapeSymbols'
  import { createViewZoom } from './viewZoom'

  const WIDTH = 900
  const HEIGHT = 820
  /** Gentle centre gravity: contains disconnected components. */
  const CONTAIN_STRENGTH = 0.05
  /** Gravity per node count: 0.05 at ≤22 nodes, √-scaled above — the
   * genre-atlas-sized map needs the stronger pull to stay framed. */
  function containStrength(count: number): number {
    return CONTAIN_STRENGTH * Math.max(1, Math.sqrt(count / 22))
  }

  const GHOSTS_PER_GENRE = 3

  let showNeighbours = $state(false)

  interface GenreNode extends SimulationNodeDatum {
    id: string
    count: number
    ghost: boolean
  }

  interface GenreEdge {
    a: string
    b: string
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

  // Ghosts remember who summoned them: a nearby genre only ever links
  // to the library genre(s) whose neighbour lists brought it in.
  const ghostAnchorMap = $derived.by(() => {
    if (!showNeighbours) return new Map<string, Set<string>>()
    return ghostAnchors(genreCounts.keys(), GHOSTS_PER_GENRE)
  })
  const ghostLabels = $derived(new Set(ghostAnchorMap.keys()))

  const labels = $derived([...genreCounts.keys(), ...ghostLabels].sort())

  // The map draws exactly the pairs the genre criterion links (k included,
  // live). Ghost labels sit outside the library vocabulary: each links only
  // to the library genre(s) that summoned it.
  const criterionPairs = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const keys = new Set<string>()
    for (const [a, b] of matchedGenrePairs(genreCounts.keys(), $genreMatcher))
      keys.add(pairKey(a, b))
    return keys
  })

  const edges = $derived.by(() => {
    const list: GenreEdge[] = []
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]
        const b = labels[j]
        const aGhost = ghostLabels.has(a)
        const bGhost = ghostLabels.has(b)
        if (aGhost || bGhost) {
          // A ghost tethers to its summoner(s) only — ghost↔ghost and stray
          // ghost↔library pairs neither draw nor pull.
          if (aGhost === bGhost) continue
          const [ghost, summoner] = aGhost ? [a, b] : [b, a]
          if (ghostAnchorMap.get(ghost)?.has(summoner) === true) {
            list.push({ a, b, score: labelSimilarity(a, b) })
          }
          continue
        }
        if (criterionPairs.has(pairKey(a, b))) list.push({ a, b, score: labelSimilarity(a, b) })
      }
    }
    return list
  })

  // Node shapes are the curated genre families, as on the wheel.
  const familyClasses = $derived(genreFamilyClasses($playlistScopedLibrary.map((t) => t.genre)))
  function classIndexOf(label: string): number | null {
    return familyClasses?.classOf.get(label) ?? null
  }

  /** Families present among the map's real (non-ghost) nodes, for the legend. */
  const legendClasses = $derived.by(() => {
    if (familyClasses === null) return []
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const present = new Set<number>()
    for (const node of positioned) {
      if (node.ghost) continue
      const index = familyClasses.classOf.get(node.id)
      if (index !== undefined) present.add(index)
    }
    return familyClasses.classes
      .map((cls, index) => ({ label: cls.label, index }))
      .filter((cls) => present.has(cls.index))
  })

  // Symbol list + path cache shared with the wheel (src/lib/shapeSymbols): a
  // render-time memo of static path strings closing over a plain (non-reactive)
  // Map.
  const shapePath = createShapePathCache()

  function nodeRadius(node: GenreNode): number {
    return node.ghost ? 5 : 6 + 3.5 * Math.sqrt(node.count)
  }

  // --- force layout ------------------------------------------------------------
  // `positioned` holds per-tick SNAPSHOTS of the simulation nodes, never the
  // live objects. The live objects must stay unproxied so
  // fx/fy writes reach d3 — a deep $state proxy would swallow those writes,
  // silently breaking the drag-pin — and the snapshots must be fresh objects so the
  // keyed each re-renders (identical identities skip row updates). Handlers
  // reach the live nodes through `simById`.
  let positioned = $state.raw<GenreNode[]>([])
  let simById = new Map<string, GenreNode>()
  let simulation: Simulation<GenreNode, undefined> | null = null
  const nodeById = $derived(new Map(positioned.map((n) => [n.id, n])))
  // Plain Map on purpose: non-reactive position memory. The layout effect
  // must not subscribe to it, or every simulation tick would restart the
  // simulation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const lastPosition = new Map<string, { x: number; y: number }>()

  $effect(() => {
    let carried = 0
    const nodes: GenreNode[] = labels.map((id, i) => {
      const previous = lastPosition.get(id)
      if (previous !== undefined) carried++
      return {
        id,
        count: genreCounts.get(id) ?? 0,
        ghost: ghostLabels.has(id),
        // keep previous positions so toggles reheat instead of restart;
        // brand-new nodes spawn at the centre and organise outward under
        // the physics (undefined coords would get d3's spiral
        // near the origin, drifting in from the top left). The tiny
        // deterministic offset keeps coincident nodes separable without
        // relying on d3's random jiggle.
        x: previous?.x ?? WIDTH / 2 + ((i % 7) - 3) * 2,
        y: previous?.y ?? HEIGHT / 2 + ((i % 5) - 2) * 2,
      }
    })
    const links: GenreLink[] = edges.map(({ a, b, score }) => ({ source: a, target: b, score }))
    simulation?.stop()
    simById = new Map(nodes.map((n) => [n.id, n]))
    simulation = forceSimulation(nodes)
      // Reheats glide, cold starts stay hot: when most nodes carry a
      // previous position this is a toggle, not a fresh layout — no need to
      // churn the whole field at full energy again.
      .alpha(carried > nodes.length / 2 ? 0.3 : 1)
      .force(
        'link',
        forceLink<GenreNode, GenreLink>(links)
          .id((d) => d.id)
          .distance((l) => 40 + 220 * (1 - l.score))
          .strength((l) => 0.3 + 0.5 * l.score),
      )
      .force(
        'charge',
        // Ghosts repel less: neighbourhood context shouldn't blow the map up.
        forceManyBody<GenreNode>().strength((d) => (d.ghost ? -160 : -260)),
      )
      .force(
        'collide',
        forceCollide<GenreNode>().radius((d) => nodeRadius(d) + 16),
      )
      // Weak positional gravity instead of forceCenter: forceCenter only
      // recentres the mean, so disconnected components drift apart under
      // the charge with nothing pulling them back. The
      // pull must stay gentle or connected layouts visibly compress — but
      // it must also GROW with the node count: summed charge scales
      // with n, so a genre-atlas-sized vocabulary would push the fringe out
      // of frame under a fixed 0.05.
      .force('x', forceX<GenreNode>(WIDTH / 2).strength(containStrength(nodes.length)))
      .force('y', forceY<GenreNode>(HEIGHT / 2).strength(containStrength(nodes.length)))
      // Slow cooling and strong damping (genreMap.ts): nodes drift into
      // place, and a k change eases into its new layout; damping grows with
      // the map, so big vocabularies drift, not churn.
      .alphaDecay(mapMotion(nodes.length).alphaDecay)
      .alphaMin(mapMotion(nodes.length).alphaMin)
      .velocityDecay(mapMotion(nodes.length).velocityDecay)
      .on('tick', publishPositions)
    return () => simulation?.stop()
  })

  function publishPositions(): void {
    const current = (simulation?.nodes() ?? []) as GenreNode[]
    for (const n of current) {
      if (n.x !== undefined && n.y !== undefined) lastPosition.set(n.id, { x: n.x, y: n.y })
    }
    positioned = current.map((n) => ({ ...n }))
  }

  // --- zoom (same pattern as the wheel) ---------------------------------------
  // The zoom behaviour + attached selection live inside createViewZoom (plain
  // closure vars — d3 owns them, a $state proxy would swallow their writes).
  // The component keeps only the transform string in $state, written from onZoom.
  let svgEl: SVGSVGElement
  let zoomTransform = $state('translate(0,0) scale(1)')
  const viewZoom = createViewZoom({
    scaleExtent: [0.4, 6],
    onZoom: (transform) => {
      zoomTransform = transform.toString()
    },
    // Why a filter: d3-zoom binds a NATIVE mousedown listener on
    // the <svg>, while Svelte 5 delegates the nodes' handlers to the app
    // root — their stopPropagation runs long after d3 already started a pan,
    // so node drags always lost. Rejecting drag-starts that originate on a
    // node hands the gesture to the pointer-capture drag below; wheel events
    // stay accepted so zooming works with the cursor over a node.
    filter: (event) => {
      if (event.type !== 'wheel') {
        const target = event.target
        if (target instanceof Element && target.closest('.genre-node') !== null) return false
      }
      if ('ctrlKey' in event && event.ctrlKey && event.type !== 'wheel') return false
      if ('button' in event && event.button !== 0) return false
      return true
    },
  })

  $effect(() => viewZoom.attach(svgEl))

  function zoomBy(factor: number) {
    viewZoom.zoomBy(factor)
  }
  function zoomReset() {
    viewZoom.zoomReset()
  }

  // --- node dragging: grab ONE node --------
  // The grabbed node pins exactly under the pointer (fx/fy for the physics,
  // x/y written immediately so the render never waits for a tick); the rest
  // of the graph reacts only through its own links. Moving the view is the
  // background drag's job (d3-zoom pan). Nothing is remembered on release.
  let layerEl: SVGGElement
  let draggingId = $state<string | null>(null)

  function layerPoint(e: PointerEvent): { x: number; y: number } {
    const ctm = layerEl.getScreenCTM()
    if (ctm === null) return { x: e.clientX, y: e.clientY }
    const inv = ctm.inverse()
    return {
      x: inv.a * e.clientX + inv.c * e.clientY + inv.e,
      y: inv.b * e.clientX + inv.d * e.clientY + inv.f,
    }
  }

  let dragDistance = 0
  let dragStart = { x: 0, y: 0 }
  // A drag's trailing click must not count as a select, but whether that
  // click even fires is browser-dependent — so suppress by time window
  // instead of a consumable flag that could swallow the NEXT real click.
  let suppressClicksUntil = 0

  function nodePointerDown(node: GenreNode, e: PointerEvent) {
    const live = simById.get(node.id)
    if (live === undefined) return
    if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId)
    draggingId = node.id
    dragDistance = 0
    dragStart = { x: e.clientX, y: e.clientY }
    live.fx = live.x
    live.fy = live.y
    // Bigger maps get a gentler reheat, or one drag churns the whole field.
    simulation?.alphaTarget(mapMotion(labels.length).dragAlphaTarget).restart()
  }

  function nodePointerMove(e: PointerEvent) {
    const live = draggingId === null ? undefined : simById.get(draggingId)
    if (live === undefined) return
    const p = layerPoint(e)
    // Pin for the physics AND republish right away — waiting for the next
    // simulation tick reads as the node lagging behind the hand.
    live.fx = p.x
    live.fy = p.y
    live.x = p.x
    live.y = p.y
    publishPositions()
    dragDistance = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y)
  }

  function nodePointerUp() {
    if (draggingId === null) return
    const live = simById.get(draggingId)
    if (live !== undefined) {
      live.fx = null
      live.fy = null
    }
    draggingId = null
    simulation?.alphaTarget(0)
    if (dragDistance > 4) suppressClicksUntil = performance.now() + 150
    dragDistance = 0
  }

  // --- pair inspector: click A, click B, read why they sit together ------------
  // Hovering edges is hopeless in a dense map; selecting two NODES locks a
  // docked card with the pair's score, link and shared ancestor.
  let inspectA = $state<string | null>(null)
  let inspectPair = $state<[string, string] | null>(null)

  function nodeClick(node: GenreNode) {
    if (performance.now() < suppressClicksUntil) return // a drag, not a select
    if (inspectPair !== null) {
      inspectPair = null
      inspectA = node.id
    } else if (inspectA === null) {
      inspectA = node.id
    } else if (inspectA === node.id) {
      inspectA = null
    } else {
      inspectPair = [inspectA, node.id]
      inspectA = null
    }
  }

  function clearInspection() {
    inspectA = null
    inspectPair = null
  }

  /** The inspected pair: its score, whether the criterion links it, and why. */
  const inspected = $derived.by(() => {
    if (inspectPair === null) return null
    const [a, b] = inspectPair
    return {
      score: labelSimilarity(a, b),
      linked: criterionPairs.has(pairKey(a, b)),
      ancestor: sharedGenreAncestor(a, b),
    }
  })

  // --- hover: a pair's score ------------------------------------------------------
  let hoveredPair = $state<{ a: string; b: string } | null>(null)
  let hoveredGenre = $state<string | null>(null)
  let mouse = $state({ x: 0, y: 0 })

  // --- wheel-style focus — the map rests on a faint skeleton
  // (each genre's strongest link), a hovered or selected genre lights its
  // full star, and the compare pair pops its one link. Layout still uses
  // EVERY edge; only the drawn set shrinks.
  const restingKeys = $derived.by(() => {
    const keys = skeletonKeys(edges.filter((e) => !ghostLabels.has(e.a) && !ghostLabels.has(e.b)))
    // Ghost tethers rest visible — they are the point of "show nearby
    // genres" (every ghost edge is an anchor tether).
    for (const e of edges) {
      if (ghostLabels.has(e.a) || ghostLabels.has(e.b)) keys.add(pairKey(e.a, e.b))
    }
    return keys
  })
  const restingEdgeOpacity = $derived(skeletonOpacity(labels.length))
  const drawnEdges = $derived.by(() => {
    const state = { hover: hoveredGenre, selected: inspectA, pair: inspectPair }
    const list: { edge: GenreEdge; tier: 'pair' | 'star' | 'skeleton' }[] = []
    for (const edge of edges) {
      const tier = edgeTier(edge, state, restingKeys)
      if (tier !== null) list.push({ edge, tier })
    }
    return list
  })
</script>

<div
  class="map-wrap"
  role="presentation"
  onmousemove={(e) => (mouse = { x: e.clientX, y: e.clientY })}
  onclick={(e) => {
    // background click (the svg itself, not a node) clears the inspection
    if (e.target instanceof Element && e.target.tagName === 'svg') clearInspection()
  }}
>
  <svg
    bind:this={svgEl}
    viewBox="0 0 {WIDTH} {HEIGHT}"
    role="application"
    aria-label="Genre map of the library"
  >
    <g class="zoom-layer" transform={zoomTransform} bind:this={layerEl}>
      {#each drawnEdges as { edge, tier } (`${edge.a}→${edge.b}`)}
        {@const a = nodeById.get(edge.a)}
        {@const b = nodeById.get(edge.b)}
        {#if a && b}
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke-width={tier === 'pair'
              ? (0.75 + 2 * edge.score) * 2
              : tier === 'star'
                ? 0.75 + 2 * edge.score
                : 0.75}
            opacity={tier === 'pair'
              ? 1
              : tier === 'star'
                ? 0.25 + 0.55 * edge.score
                : restingEdgeOpacity}
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
        {/if}
      {/each}

      {#each positioned as node (node.id)}
        <g
          class="genre-node"
          class:ghost={node.ghost}
          class:dragging={draggingId === node.id}
          transform="translate({node.x ?? WIDTH / 2},{node.y ?? HEIGHT / 2})"
          role="button"
          tabindex="-1"
          aria-label="{node.id}{node.ghost
            ? ' (nearby, not in library)'
            : ` — ${node.count} tracks`}"
          class:inspected={inspectA === node.id || inspectPair?.includes(node.id) === true}
          onmouseenter={() => (hoveredGenre = node.id)}
          onmouseleave={() => (hoveredGenre = null)}
          onmousedown={(e) => e.stopPropagation()}
          onpointerdown={(e) => nodePointerDown(node, e)}
          onpointermove={nodePointerMove}
          onpointerup={nodePointerUp}
          onpointercancel={nodePointerUp}
          onclick={(e) => {
            e.stopPropagation()
            nodeClick(node)
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') nodeClick(node)
          }}
        >
          <!-- Transparent hit-shape: the symbol path only fills its own
               outline, so without it a press in a concavity would fall
               through to d3-zoom and pan the canvas. This circle is the
               node's one grab handle (the label is a caption, not a handle). -->
          <circle class="node-hit" r={nodeRadius(node) + 5} />
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

  <div class="overlays">
    <span class="overlays-title">Links: each genre's {$criteria.genre.k} nearest</span>
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
    <!-- Shape legend: the curated families behind the node
         icons — only when the symbols actually distinguish something. -->
    {#if legendClasses.length > 1}
      <span class="legend-shapes">
        {#each legendClasses as cls (cls.index)}
          <span class="shape-chip">
            <svg width="12" height="12" viewBox="-6 -6 12 12"
              ><path d={shapePath(cls.index, 4)} /></svg
            >
            {cls.label}
          </span>
        {/each}
      </span>
    {/if}
    <span class="legend-hint">
      node size: tracks with that genre · faint lines: each genre's strongest link · hover or click
      a genre for its full connections · click two to compare
    </span>
  </div>

  <!-- Pair inspector: click two nodes, read why they sit where they sit -->
  {#if inspectPair !== null && inspected !== null}
    <div class="inspector" role="status">
      <div class="inspector-head">
        <strong>{inspectPair[0]} ↔ {inspectPair[1]}</strong>
        <button class="close" aria-label="Close comparison" onclick={clearInspection}>✕</button>
      </div>
      <dl>
        <dt>similarity</dt>
        <dd>{inspected.score.toFixed(2)}</dd>
        <dt>combo match</dt>
        <dd>
          {#if inspected.linked}<span class="linked">● yes</span>{:else}no — not in each other's
            {$criteria.genre.k} nearest{/if}
        </dd>
        <dt>shared family</dt>
        <dd>{inspected.ancestor ?? 'none in the genre tree'}</dd>
      </dl>
    </div>
  {:else if inspectA !== null}
    <div class="inspector slim" role="status">
      <strong>{inspectA}</strong> — click a second genre to compare
    </div>
  {/if}

  {#if hoveredPair}
    <div class="tooltip" style="left: {mouse.x + 14}px; top: {mouse.y + 12}px">
      <strong>{hoveredPair.a} ↔ {hoveredPair.b}</strong>
      <span>similarity {labelSimilarity(hoveredPair.a, hoveredPair.b).toFixed(2)}</span>
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

  .edge {
    stroke: var(--accent);
  }

  .edge-hit {
    stroke: transparent;
    stroke-width: 10;
    cursor: help;
  }

  .genre-node {
    cursor: grab;
  }

  .genre-node.dragging {
    cursor: grabbing;
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

  .genre-node.inspected .mark {
    stroke: var(--accent);
    stroke-width: 2.5;
  }

  .genre-node.ghost .genre-label {
    fill: var(--ink-muted);
    font-style: italic;
  }

  .node-hit {
    fill: transparent;
  }

  .genre-label {
    fill: var(--ink-secondary);
    font-size: 11px;
    /* A caption, not a grab handle: SVG text hit-tests only
       the glyph strokes, so "grab the label" would mostly miss and start a
       pan instead — the node's hit-circle is the one honest handle. */
    pointer-events: none;
  }

  .overlays {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: nowrap;
    white-space: nowrap;
  }

  .overlays-title {
    color: var(--ink-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-right: 4px;
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
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .legend-shapes {
    display: flex;
    /* Single scrolling row rather than piling into stacks now the pane floors. */
    flex-wrap: nowrap;
    overflow-x: auto;
    max-width: 640px;
    gap: 4px 12px;
  }

  .shape-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink-secondary);
  }

  .shape-chip svg path {
    fill: var(--ink-secondary);
  }

  .legend-hint {
    color: var(--ink-muted);
  }

  .inspector {
    position: absolute;
    top: 44px;
    right: 12px;
    max-width: 280px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
  }

  .inspector.slim {
    color: var(--ink-secondary);
  }

  .inspector-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .inspector .close {
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--ink-muted);
    font-size: 12px;
  }

  .inspector .close:hover {
    color: var(--ink);
  }

  .inspector dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 6px 0 0;
  }

  .inspector dt {
    color: var(--ink-muted);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .inspector dd {
    margin: 0;
    color: var(--ink-secondary);
  }

  .inspector .linked {
    color: var(--accent);
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
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
</style>
