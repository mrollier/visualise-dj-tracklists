# Design v13 — Genre-map polish: drag, calm, focus

A short round scoped to a single view. Michiel reviewed the Genres view (2026-07-18)
and dictated three issues; four design choices were settled by questions before
implementation (every recommended option accepted). The importer wave previously
pencilled in as v13 moves to **v14**.

## The issues

1. **Drag grabs the world, not the node.** Grabbing a genre moved the whole graph —
   clumping together, lagging behind the hand — instead of the one node. Wanted:
   classic force-graph dragging — the grabbed node stays exactly under the cursor,
   everything else reacts only through its own links.
2. **Overwhelming at ~36 genres.** The resting map drew every scoring pair; with
   *show nearby genres* on it became "rather messy", and the motion felt rough at
   that size.
3. **Focus should work like the wheel.** All links showed at rest (hover merely
   dimmed the rest). Wanted: click a genre → only its direct connections stay
   visible; click a second → the pair's link is highlighted with the compare card,
   exactly the wheel's focus idiom.

## Decisions taken with Michiel

| Topic | Decision |
| --- | --- |
| Resting state | **Faint skeleton**: each genre draws only its single strongest link, thin and dim, opacity easing down as the map grows |
| Compare state | **Only the A–B link** highlighted over the resting skeleton; the card carries the scores |
| Nearby ghosts | **Anchor links only**: a ghost draws — and is pulled by — just its link(s) to the library genre(s) that summoned it |
| Physics | **Calmer when bigger**: damping grows and reheat/drag energy shrinks with node count |
| Drag | Tow removed outright (background drag already pans); the pin stays and becomes real |

Key invariant: the *layout* keeps using the full similarity structure — only the
*drawn* set shrinks, so clusters keep their shape while the map stops shouting.

## What shipped

### The drag was never a pin — a Svelte 5 proxy bug (issue 1)

The v11 drag "pinned" the node with `fx`/`fy` and towed the gravity targets. Debugging
v13 revealed the pin had **silently never worked**: the simulation nodes were deep
`$state` proxies, so `dragging.fx = …` wrote into proxy state that d3 never reads.
Only the tow (a d3 API call) had any effect — which is precisely the "whole graph
follows, node lags" feel Michiel reported.

The bridge is now explicit ([GenreMapView.svelte](../../src/lib/GenreMapView.svelte)):
the tick publishes **plain snapshots** of the simulation nodes into `$state.raw`
(fresh object identities every tick — identical identities make the keyed `{#each}`
skip row updates, which froze the render in an intermediate attempt), while pointer
handlers reach the **live d3 nodes** through a non-reactive `simById` map. Pointer
moves write `fx/fy` *and* `x/y` and republish immediately, so the node tracks the
cursor with zero lag (verified: 0.00 px pin error while moving and holding; distant
nodes' median motion 1.6 px — no towing, only link-neighbours respond). The tow, its
strengthened gravity and `dragOrigin` are gone.

### Skeleton + wheel-style focus (issues 2 + 3)

New pure module [src/core/genreMap.ts](../../src/core/genreMap.ts):

- `skeletonKeys` — union over nodes of each node's strongest incident edge
  (deterministic ties). The resting map draws only these, at `skeletonOpacity(n)`
  (0.42 easing to a 0.16 floor, the same √(n/22) family as the containment gravity).
- `edgeTier` — the focus state machine: `pair` (compare link) > `star` (hovered or
  selected genre's full connections) > `skeleton` > not drawn. Hover previews from
  any state; the old 0.06 hover-dim of the full hairball is gone entirely.
- On the 50-genre sample collection the resting map fell from every scoring pair to
  **29 edges**; hovering/selecting lights the genre's star; comparing shows the one
  pair link over the skeleton.

### Ghost anchors (issue 2)

`ghostAnchors` records which library genre(s) summoned each unowned neighbour.
A ghost's only edges — drawn *and* physical — are its anchor tethers (unconditional,
no score floor: the tether is why the ghost exists); ghost↔ghost and stray
ghost↔library pairs are gone from rendering and layout, so ghosts hug their
summoners. Tethers rest visible at skeleton tier. Live: +53 ghosts now add 80 tether
edges instead of every scoring ghost pair.

### Physics calm

`mapMotion(n)`: velocityDecay 0.6 → 0.8 and drag reheat 0.15 → 0.06 as the map grows
past 22 nodes (√-scaled, clamped). The drag reheat's base is deliberately **half of
d3's classic 0.3** — with this map's slow cooling (alphaDecay 0.002), 0.3 kept the
whole field boiling for as long as the mouse was held. Data-change reheats start at
alpha 0.3 when most nodes carry previous positions (a toggle glides; a cold start
keeps full energy to spread from the centre spawn).

## Verification

- `tests/genreMap.test.ts` (22 unit tests: skeleton, tiers, opacity/motion scaling,
  ghost anchors); full suite green.
- Live Playwright probes per workstream: drag pin 0.00 px / no tow; resting 29 edges
  on 50 nodes; hover/select/compare/clear cycle; ghost tether bounds; toggling
  *show nearby genres* off restores the exact resting count.
- [scripts/screenshot.mjs](../../scripts/screenshot.mjs) extended: resting-skeleton
  density bound, anchor-based 1:1 drag-pin assertion (the old bbox-centre grab could
  miss the hit circle and "passed" via settle drift), ≤1 bold edge while comparing,
  ghost-tether growth bounds.

## Non-goals

- No changes to any other view, the schema, or persistence.
- The compare card's scores still show for unlinked pairs — an honest "no line to
  draw" rather than a synthetic edge.
- Shift-drag towing (or any tow revival) is out: Michiel called it "not very
  useful", and background panning already moves the view.
