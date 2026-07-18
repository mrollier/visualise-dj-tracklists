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
  import { matchedGenrePairs } from '../core/combos'
  import {
    genreComponents,
    GENRE_METHODS,
    labelSimilarity,
    packNeighbours,
    type GenreMethod,
  } from '../core/genre'
  import { mapMotion } from '../core/genreMap'
  import { genreFamilyClasses } from '../core/iconClasses'
  import { criteria, playlistScopedLibrary, settings, visibleLibrary } from '../stores'

  const WIDTH = 900
  const HEIGHT = 820
  /** Gentle centre gravity: contains disconnected components (issue 12). */
  const CONTAIN_STRENGTH = 0.05
  /** Gravity per node count: 0.05 at ≤22 nodes, √-scaled above (v12) — the
   * genre-atlas-sized map needs the stronger pull to stay framed. */
  function containStrength(count: number): number {
    return CONTAIN_STRENGTH * Math.max(1, Math.sqrt(count / 22))
  }

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
  // The map's methods: everything but 'exact' — one node per normalized
  // label means identical labels are literally the same node, so the exact
  // overlay can never draw an edge (v8 issue 12).
  const MAP_METHODS: readonly GenreMethod[] = GENRE_METHODS.filter((m) => m !== 'exact')
  // A single overlay method (v10 issue 16): the map draws one method's links
  // at a time. It tracks the criterion method (a writable $derived), so
  // changing the criterion replaces the overlay rather than stacking it (the
  // v9 bug); a chip click overrides until the criterion next changes, and
  // clicking the active chip clears the overlay.
  let overlayMethod = $derived<GenreMethod | null>(
    $criteria.genre.method === 'exact' ? null : $criteria.genre.method,
  )

  function selectMethod(method: GenreMethod): void {
    overlayMethod = overlayMethod === method ? null : method
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

  // The criterion's own method draws exactly the pairs the combo criterion
  // links — mode, k and threshold included, live (issue 12). Ghost labels
  // sit outside the library vocabulary, so their edges (and every other
  // overlay method) keep the plain similarity view with the score floor.
  const criterionPairs = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const keys = new Set<string>()
    for (const [a, b] of matchedGenrePairs(
      $visibleLibrary.map((t) => t.genre),
      $criteria,
    )) {
      keys.add(`${a}\u001f${b}`)
    }
    return keys
  })

  const edges = $derived.by(() => {
    const list: GenreEdge[] = []
    for (const method of MAP_METHODS) {
      if (overlayMethod !== method) continue
      const isCriterion = method === $criteria.genre.method
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i]
          const b = labels[j]
          const score = labelSimilarity(a, b, method)
          const bothInLibrary = !ghostLabels.has(a) && !ghostLabels.has(b)
          const linked =
            isCriterion && bothInLibrary
              ? criterionPairs.has(`${a}\u001f${b}`)
              : score >= SCORE_FLOOR
          if (linked) list.push({ a, b, method, score })
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

  // --- genre classes: ALWAYS the curated genre families here (v9 issue 4).
  // The icon-mode setting only steers the Wheel view — genre nodes have a
  // family by construction, so playlists/clusters make no sense on the map.
  const familyClasses = $derived(
    genreFamilyClasses(
      $playlistScopedLibrary.map((t) => t.genre),
      $settings.maxGenreClasses,
    ),
  )
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
  // `positioned` holds per-tick SNAPSHOTS of the simulation nodes, never the
  // live objects (v13 issue 1). The live objects must stay unproxied so
  // fx/fy writes reach d3 (deep $state swallowed them — the v11 drag-pin
  // silently did nothing), and the snapshots must be fresh objects so the
  // keyed each re-renders (identical identities skip row updates). Handlers
  // reach the live nodes through `simById`.
  let positioned = $state.raw<GenreNode[]>([])
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive bridge
  let simById = new Map<string, GenreNode>()
  let simulation: Simulation<GenreNode, undefined> | null = null
  const nodeById = $derived(new Map(positioned.map((n) => [n.id, n])))
  // Plain Map on purpose: non-reactive position memory. The layout effect
  // must not subscribe to it, or every simulation tick would restart the
  // simulation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const lastPosition = new Map<string, { x: number; y: number }>()

  $effect(() => {
    const nodes: GenreNode[] = labels.map((id, i) => {
      const previous = lastPosition.get(id)
      return {
        id,
        count: genreCounts.get(id) ?? 0,
        ghost: ghostLabels.has(id),
        // keep previous positions so toggles reheat instead of restart;
        // brand-new nodes spawn at the centre and organise outward under
        // the physics (issue 3 — undefined coords would get d3's spiral
        // near the origin, drifting in from the top left). The tiny
        // deterministic offset keeps coincident nodes separable without
        // relying on d3's random jiggle.
        x: previous?.x ?? WIDTH / 2 + ((i % 7) - 3) * 2,
        y: previous?.y ?? HEIGHT / 2 + ((i % 5) - 2) * 2,
      }
    })
    const links: GenreLink[] = [...pairStrength.entries()].map(([key, score]) => {
      const [a, b] = key.split('\u001f')
      return { source: a, target: b, score }
    })
    simulation?.stop()
    simById = new Map(nodes.map((n) => [n.id, n]))
    simulation = forceSimulation(nodes)
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
      // the charge with nothing pulling them back (ISSUES.md #12). The
      // pull must stay gentle or connected layouts visibly compress — but
      // it must also GROW with the node count (v12): summed charge scales
      // with n, so a genre-atlas-sized vocabulary would push the fringe out
      // of frame under a fixed 0.05.
      .force('x', forceX<GenreNode>(WIDTH / 2).strength(containStrength(nodes.length)))
      .force('y', forceY<GenreNode>(HEIGHT / 2).strength(containStrength(nodes.length)))
      // Slow cooling and strong damping: nodes drift into place organically
      // instead of springing (issue 5, pairs with the centre spawn of issue
      // 3). alphaDecay lowered again (v10 issue 9, v11 issue 10) so a
      // method change eases into its new layout instead of snapping.
      .alphaDecay(0.002)
      .velocityDecay(0.6)
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
  let svgEl: SVGSVGElement
  let zoomTransform = $state('translate(0,0) scale(1)')
  const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 6])
    // Why a filter (v9 issue 5): d3-zoom binds a NATIVE mousedown listener on
    // the <svg>, while Svelte 5 delegates the nodes' handlers to the app
    // root — their stopPropagation runs long after d3 already started a pan,
    // so node drags always lost. Rejecting drag-starts that originate on a
    // node hands the gesture to the pointer-capture drag below; wheel events
    // stay accepted so zooming works with the cursor over a node.
    .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
      if (event.type !== 'wheel') {
        const target = event.target
        if (target instanceof Element && target.closest('.genre-node') !== null) return false
      }
      if ('ctrlKey' in event && event.ctrlKey && event.type !== 'wheel') return false
      if ('button' in event && event.button !== 0) return false
      return true
    })
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

  // --- node dragging (v8 issue 11, reworked v13 issue 1): grab ONE node --------
  // The grabbed node pins exactly under the pointer (fx/fy for the physics,
  // x/y written immediately so the render never waits for a tick); the rest
  // of the graph reacts only through its own links. v11's whole-graph towing
  // is gone — moving the view is the background drag's job (d3-zoom pan).
  // Nothing is remembered on release.
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

  // --- pair inspector (v8 issue 14): click A, click B, read the scores ---------
  // Hovering edges is hopeless in a dense map; selecting two NODES locks a
  // docked card with every method's score for the pair.
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

  function pairKey(a: string, b: string): string {
    return a < b ? `${a}\u001f${b}` : `${b}\u001f${a}`
  }

  /** Every map method's score for a pair, plus whether it currently links it. */
  function scoresFor(
    a: string,
    b: string,
  ): { method: GenreMethod; score: number; linked: boolean }[] {
    const bothInLibrary = !ghostLabels.has(a) && !ghostLabels.has(b)
    return MAP_METHODS.map((method) => {
      const score = labelSimilarity(a, b, method)
      const linked =
        method === $criteria.genre.method && bothInLibrary
          ? criterionPairs.has(pairKey(a, b))
          : score >= SCORE_FLOOR
      return { method, score, linked: linked && overlayMethod === method }
    })
  }

  const inspectedScores = $derived(
    inspectPair === null ? [] : scoresFor(inspectPair[0], inspectPair[1]),
  )

  function edgeInspected(edge: GenreEdge): boolean {
    return (
      inspectPair !== null && pairKey(edge.a, edge.b) === pairKey(inspectPair[0], inspectPair[1])
    )
  }

  // --- hover: a pair's scores under every method -------------------------------
  let hoveredPair = $state<{ a: string; b: string } | null>(null)
  let hoveredGenre = $state<string | null>(null)
  let mouse = $state({ x: 0, y: 0 })

  const hoveredScores = $derived.by(() => {
    const pair = hoveredPair
    if (pair === null) return []
    return MAP_METHODS.map((method) => ({
      method,
      score: labelSimilarity(pair.a, pair.b, method),
    }))
  })

  /** Per-method perpendicular offset so parallel overlays stay visible. */
  function edgeOffset(method: GenreMethod, a: GenreNode, b: GenreNode): string {
    // A single overlay method never runs parallel with another (v10 #16).
    const active = overlayMethod === null ? [] : [overlayMethod]
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
              stroke-width={(0.75 + 2 * edge.score) * (edgeInspected(edge) ? 2 : 1)}
              stroke-dasharray={METHOD_DASH[edge.method] ?? 'none'}
              opacity={edgeInspected(edge) ? 1 : 0.25 + 0.55 * edge.score}
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
          <!-- Transparent hit-shape (v10 issue 8): the symbol path only
               fills its own outline, so a press in a concavity fell through
               to d3-zoom and panned the canvas. This circle is the node's
               one grab handle (the label is a caption — v11 issue 9b). -->
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

  <!-- Method overlay chips: one line, no 'exact' (identical labels are one
       node — it has nothing to draw; v8 issues 12+13) -->
  <div class="overlays">
    <span class="overlays-title">Link methods</span>
    {#each MAP_METHODS as method (method)}
      <button
        class="method-chip"
        class:on={overlayMethod === method}
        style="--chip: {METHOD_COLOR[method]}"
        onclick={() => selectMethod(method)}
      >
        <i class:dashed={METHOD_DASH[method] !== undefined}></i>
        {method}
      </button>
    {/each}
    <label class="ghost-toggle">
      <input type="checkbox" bind:checked={showNeighbours} />
      show nearby genres
    </label>
    {#if $criteria.genre.method === 'exact'}
      <span class="exact-note">exact matches are single nodes — no lines to draw</span>
    {/if}
  </div>

  <!-- Zoom controls -->
  <div class="zoom-controls">
    <button aria-label="Zoom in" title="Zoom in" onclick={() => zoomBy(1.4)}>+</button>
    <button aria-label="Zoom out" title="Zoom out" onclick={() => zoomBy(1 / 1.4)}>−</button>
    <button aria-label="Reset zoom" title="Reset zoom" onclick={zoomReset}>⌂</button>
  </div>

  <div class="legend">
    <!-- Shape legend (v9 issue 4): the curated families behind the node
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
      node size: tracks with that genre · distance ≈ similarity under the enabled methods · click
      two genres to compare them
    </span>
  </div>

  <!-- Pair inspector (v8 issue 14): click two nodes, read every score -->
  {#if inspectPair !== null}
    <div class="inspector" role="status">
      <div class="inspector-head">
        <strong>{inspectPair[0]} ↔ {inspectPair[1]}</strong>
        <button class="close" aria-label="Close comparison" onclick={clearInspection}>✕</button>
      </div>
      <dl>
        {#each inspectedScores as { method, score, linked } (method)}
          <dt><i style="background: {METHOD_COLOR[method]}"></i>{method}</dt>
          <dd>
            {score.toFixed(2)}
            {#if linked}<span class="linked" title="currently drawn on the map">●</span>{/if}
          </dd>
        {/each}
      </dl>
      <p class="inspector-hint">● = drawn on the map at the current settings</p>
    </div>
  {:else if inspectA !== null}
    <div class="inspector slim" role="status">
      <strong>{inspectA}</strong> — click a second genre to compare
    </div>
  {/if}

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
    /* A caption, not a grab handle (v11 issue 9b): SVG text hit-tests only
       the glyph strokes, so "grab the label" mostly missed and started a
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
    /* One line, always (v8 issue 13): five chips after dropping 'exact'. */
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

  .exact-note {
    color: var(--ink-muted);
    font-size: 11px;
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
    flex-wrap: wrap;
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

  .inspector dt i {
    width: 10px;
    height: 2px;
    display: inline-block;
  }

  .inspector dd {
    margin: 0;
    color: var(--ink-secondary);
  }

  .inspector .linked {
    color: var(--accent);
    margin-left: 4px;
    font-size: 9px;
    vertical-align: 1px;
  }

  .inspector-hint {
    margin: 6px 0 0;
    color: var(--ink-muted);
    font-size: 11px;
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
