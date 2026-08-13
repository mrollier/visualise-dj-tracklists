<script lang="ts">
  // The Tracks central view (issue 7): the selected playlists as a classic
  // sortable table, like the browser in DJ software. Rows share the global
  // selection with the wheel; tracks connected to the selection in the combo
  // graph highlight; the leading ＋ cell appends to the set and turns into
  // the track's position number(s) once included (v8 issue 15); per-row
  // toggles mark a track as essential (must-include) or as the opener/closer
  // of generated sets — the same pins as everywhere else.
  import { COLUMN_LABELS, visibleColumns } from '../core/columns'
  import type { Track } from '../core/model'
  import { nextStarState, type StarState } from '../core/pins'
  import { formatPropertyValue, PROPERTY_BY_KEY, REKORDBOX_COLOURS } from '../core/properties'
  import { removeAllOccurrences } from '../core/sets'
  import { sortTracks, type TrackSortField } from '../core/trackSort'
  import {
    addTrackToSet,
    comboComplete,
    effectiveManualEdges,
    filters,
    hoveredId,
    linkArmed,
    mustInclude,
    neighbours,
    pinnedFirst,
    pinnedLast,
    selectedId,
    selectOrLink,
    settings,
    toggleManualEdge,
    trackById,
    tracklist,
    trackSort,
    visibleLibrary,
  } from '../stores'

  const COLUMN_LABEL = COLUMN_LABELS

  // Columns = the full settings order minus the hidden set (v9 issue 12).
  const columns = $derived(visibleColumns($settings.trackColumns, $settings.hiddenColumns))
  // Kind and formatting come from the property registry (v11 issue 1).
  function isTextColumn(field: TrackSortField): boolean {
    const kind = PROPERTY_BY_KEY.get(field)?.kind
    return kind === 'alpha' || kind === 'contains' || kind === 'colour' || kind === 'quality'
  }

  // Rekordbox stores colour as a raw `0xRRGGBB` string; turn it into a CSS hex
  // for the swatch, or null if it isn't a recognisable 6-digit hex (#8).
  function colourHex(raw: string): string | null {
    return /^0x[0-9a-fA-F]{6}$/.test(raw) ? '#' + raw.slice(2) : null
  }

  function toggleSort(field: TrackSortField) {
    trackSort.update((sort) =>
      sort.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    )
  }

  // Sorting always runs over the whole selection, but only the top window is
  // mounted: thousands of rows with per-row controls take seconds to build,
  // and the top of the sorted order is what gets scanned anyway. Narrowing
  // the playlist selection (or flipping the sort) reaches the rest.
  const MAX_ROWS = 500
  // The table shows what the wheel shows (v9 issue 16): the FULL filter set
  // (ranges, genres, key ring), not just the playlist scope.
  const sorted = $derived(sortTracks($visibleLibrary, $trackSort))

  // In-set-only view (v10 issue 15): show only the active set's tracks, in
  // set order (deduped by first occurrence), with all metadata columns —
  // the right panel's set, fleshed out. Column sorting is suspended here.
  let inSetOnly = $state(false)
  // If the set empties while set-only mode is on (clear, deletions), exit
  // the mode — otherwise the table dead-ends on the empty hint with the
  // toggle disabled (v11 issue 12a).
  $effect(() => {
    if ($tracklist.length === 0 && inSetOnly) inSetOnly = false
  })
  const inSetRows = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const seen = new Set<string>()
    const out: Track[] = []
    for (const id of $tracklist) {
      if (seen.has(id)) continue
      seen.add(id)
      const found = $trackById.get(id)
      if (found !== undefined) out.push(found)
    }
    return out
  })
  const rows = $derived(inSetOnly ? inSetRows : sorted.slice(0, MAX_ROWS))
  const connectedIds = $derived.by(() => {
    if ($selectedId === null) return null
    // Threshold 0 (v11 issue 2a): complete graph, every other row connects.
    if ($comboComplete) {
      return new Set($visibleLibrary.filter((t) => t.id !== $selectedId).map((t) => t.id))
    }
    return $neighbours.get($selectedId)
  })
  const mustSet = $derived(new Set($mustInclude))

  // Manual-combo column: hidden in easy mode, like the rest of the 🔗
  // machinery (E1 — link mode is out of sight and inert there).
  const easy = $derived($settings.uiMode === 'easy')

  // No selection: each row shows how many manual combos it's part of at all.
  const manualCountById = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const map = new Map<string, number>()
    for (const e of $effectiveManualEdges) {
      map.set(e.a, (map.get(e.a) ?? 0) + 1)
      map.set(e.b, (map.get(e.b) ?? 0) + 1)
    }
    return map
  })

  // With a selection: which other rows actually share a manual combo with it
  // — the list-view analogue of the wheel's dashed lines.
  const manualPartnerIds = $derived.by(() => {
    if ($selectedId === null) return null
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const set = new Set<string>()
    for (const e of $effectiveManualEdges) {
      if (e.a === $selectedId) set.add(e.b)
      else if (e.b === $selectedId) set.add(e.a)
    }
    return set
  })

  function selectRow(id: string) {
    // v14 T1 / v14 WS10: an armed 🔗 makes the next row click mark/unmark a
    // combo, just like a wheel click; the selection stays on the source so
    // marks chain. Shared with the wheel via selectOrLink.
    selectOrLink(id)
  }

  // One click-cycle star per row (v10 issue 13): none → must → first → last →
  // none, skipping a pin stage another track already holds.
  function starStateOf(id: string): StarState {
    if ($pinnedFirst === id) return 'first'
    if ($pinnedLast === id) return 'last'
    if (mustSet.has(id)) return 'must'
    return 'none'
  }
  const STAR_GLYPH: Record<StarState, string> = { none: '☆', must: '★', first: '⏮', last: '⏭' }
  const STAR_TITLE: Record<StarState, string> = {
    none: 'Click to mark essential (must-include)',
    must: 'Essential — click to make the opener',
    first: 'Opens generated constellations — click to make the closer',
    last: 'Closes generated constellations — click to clear',
  }
  function cycleStar(id: string) {
    const next = nextStarState(
      starStateOf(id),
      $pinnedFirst !== null && $pinnedFirst !== id,
      $pinnedLast !== null && $pinnedLast !== id,
    )
    mustInclude.update((ids) => ids.filter((x) => x !== id))
    if ($pinnedFirst === id) pinnedFirst.set(null)
    if ($pinnedLast === id) pinnedLast.set(null)
    if (next === 'must') mustInclude.update((ids) => [...ids, id])
    else if (next === 'first') pinnedFirst.set(id)
    else if (next === 'last') pinnedLast.set(id)
  }

  // --- ＋/position column (v8 issue 15): 1-based slots in the ACTIVE set ---
  const positionsById = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const map = new Map<string, number[]>()
    $tracklist.forEach((id, index) => {
      const list = map.get(id)
      if (list === undefined) map.set(id, [index + 1])
      else list.push(index + 1)
    })
    return map
  })

  // --- header drag: reorder the columns list in settings (v8 issue 15) ---
  let dragField = $state<TrackSortField | null>(null)
  let dropField = $state<TrackSortField | null>(null)

  function headerDrop(target: TrackSortField) {
    const from = dragField
    dragField = null
    dropField = null
    if (from === null || from === target) return
    settings.update((s) => {
      const cols = s.trackColumns.filter((f) => f !== from)
      cols.splice(cols.indexOf(target), 0, from)
      return { ...s, trackColumns: cols }
    })
  }
</script>

<section class="tracks-view">
  {#if rows.length === 0}
    <div class="empty-hint">
      <strong>Nothing to list yet.</strong>
      <span>Select a playlist or loosen the filters on the left to fill the table.</span>
    </div>
  {:else}
    <table class:has-selection={$selectedId !== null}>
      <thead>
        <tr>
          <!-- Tags + position lead the row (v9 issue 13); the header ★ is a
               quick filter now (v18 #3/#8 — the old mark-all-★ action
               retired), hidden in easy mode like the 🔗 column below. -->
          <th class="tags-col">
            {#if !easy}
              <button
                class="tag header-toggle"
                class:on={$filters.marks.starredOnly}
                title={$filters.marks.starredOnly
                  ? 'Showing only ★ tracks — click to show all'
                  : 'Show only ★ tracks'}
                aria-label="Toggle showing only starred tracks"
                aria-pressed={$filters.marks.starredOnly}
                onclick={() =>
                  filters.update((f) => ({
                    ...f,
                    marks: { ...f.marks, starredOnly: !f.marks.starredOnly },
                  }))}>★</button
              >
            {/if}
          </th>
          <th class="pos-col">
            <!-- Toggle a metadata-rich, set-only, position-ordered view (v10
                 issue 15). Disabled while the set is empty — an empty
                 set-only table is a dead end (v11 issue 12a). -->
            <button
              class="pos-toggle"
              class:on={inSetOnly}
              disabled={$tracklist.length === 0}
              title={$tracklist.length === 0
                ? 'Add tracks to the constellation first'
                : inSetOnly
                  ? 'Show all tracks'
                  : 'Show only this constellation, in order'}
              aria-label="Toggle the constellation-only view"
              aria-pressed={inSetOnly}
              onclick={() => (inSetOnly = !inSetOnly)}>☰</button
            >
          </th>
          {#if !easy}
            <!-- Manual (🔗) combos, list-view analogue of the wheel's dashed
                 links: unselected shows a per-row count, a selection swaps
                 that for a lit/clickable icon on the actual partners. The
                 header 🔗 is a quick filter (v18 #3/#8), same idiom as the
                 header ★ — the old clear-all-combos action retired. -->
            <th class="manual-col">
              <button
                class="tag header-toggle"
                class:on={$filters.marks.comboOnly}
                title={$filters.marks.comboOnly
                  ? 'Showing only manual-combo tracks — click to show all'
                  : 'Show only tracks with a manual combo'}
                aria-label="Toggle showing only tracks with a manual combo"
                aria-pressed={$filters.marks.comboOnly}
                onclick={() =>
                  filters.update((f) => ({
                    ...f,
                    marks: { ...f.marks, comboOnly: !f.marks.comboOnly },
                  }))}>🔗</button
              >
            </th>
          {/if}
          {#each columns as field (field)}
            <th
              class:drop-target={dropField === field}
              draggable="true"
              ondragstart={(e) => {
                dragField = field
                e.dataTransfer?.setData('text/plain', field)
              }}
              ondragover={(e) => {
                e.preventDefault()
                dropField = field
              }}
              ondragleave={() => {
                if (dropField === field) dropField = null
              }}
              ondrop={(e) => {
                e.preventDefault()
                headerDrop(field)
              }}
              ondragend={() => {
                dragField = null
                dropField = null
              }}
              aria-sort={!inSetOnly && $trackSort.field === field
                ? $trackSort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined}
            >
              <button class="sort" onclick={() => toggleSort(field)}>
                {COLUMN_LABEL[field]}
                <!-- Set order supersedes column sorting in set-only mode, so
                     the triangle hides there (v11 issue 12b); the stored
                     sort is untouched and returns on toggle-back. -->
                {#if !inSetOnly && $trackSort.field === field}<span class="dir"
                    >{$trackSort.dir === 'asc' ? '▲' : '▼'}</span
                  >{/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as track (track.id)}
          {@const positions = positionsById.get(track.id)}
          {@const starState = starStateOf(track.id)}
          <tr
            class:selected={track.id === $selectedId}
            class:connected={connectedIds?.has(track.id) === true}
            class:set-hovered={track.id === $hoveredId}
            class:link-armed={$linkArmed}
            onclick={() => selectRow(track.id)}
          >
            <td class="tags">
              <!-- One star per row cycles must-include → opener → closer (v10
                   issue 13); the four-icon cluster is retired. -->
              <button
                class="tag star"
                class:on={starState !== 'none'}
                title={STAR_TITLE[starState]}
                aria-label="Cycle essential / opener / closer"
                aria-pressed={starState !== 'none'}
                onclick={(e) => {
                  e.stopPropagation()
                  cycleStar(track.id)
                }}>{STAR_GLYPH[starState]}</button
              >
            </td>
            <td class="pos">
              <!-- ＋ appends; once in the set the cell reads as the track's
                   slot number(s), and clicking removes the track from the
                   set — every occurrence, with a ✕ appearing on hover
                   (v9 issue 14). -->
              <button
                class="pos-btn"
                class:in-set={positions !== undefined}
                title={positions === undefined
                  ? 'Add to constellation'
                  : 'In the constellation — click to remove'}
                aria-label={positions === undefined
                  ? `Add ${track.title} to the constellation`
                  : `Remove ${track.title} from the constellation`}
                onclick={(e) => {
                  e.stopPropagation()
                  if (positions === undefined) addTrackToSet(track.id)
                  else tracklist.update((ids) => removeAllOccurrences(ids, track.id))
                }}
              >
                {#if positions === undefined}＋{:else}
                  <span class="num">{positions.join(',')}</span><span class="x">✕</span>
                {/if}
              </button>
            </td>
            {#if !easy}
              {@const sel = $selectedId}
              <td class="manual">
                {#if sel === null}
                  {@const count = manualCountById.get(track.id) ?? 0}
                  {#if count > 0}
                    <span class="manual-count" title="{count} manual combo{count === 1 ? '' : 's'}"
                      >{count}</span
                    >
                  {/if}
                {:else if track.id === sel}
                  <span
                    class="tag on"
                    title="Selected — its manual combos light up on the other rows">🔗</span
                  >
                {:else if manualPartnerIds?.has(track.id)}
                  <button
                    class="tag on"
                    title="Manually combo'd — click to remove"
                    aria-label="Remove the manual combo with {track.title}"
                    onclick={(e) => {
                      e.stopPropagation()
                      toggleManualEdge(sel, track.id)
                    }}>🔗</button
                  >
                {:else}
                  <button
                    class="tag"
                    title="Click to mark a manual combo with the selected track"
                    aria-label="Add a manual combo with {track.title}"
                    onclick={(e) => {
                      e.stopPropagation()
                      toggleManualEdge(sel, track.id)
                    }}>🔗</button
                  >
                {/if}
              </td>
            {/if}
            {#each columns as field (field)}
              {#if field === 'rating'}
                <td
                  class="tabular rating"
                  aria-label={track.rating === null ? undefined : `${track.rating} of 5`}
                >
                  {#if track.rating === null}—{:else}<span class="stars"
                      >{'★'.repeat(track.rating)}</span
                    ><span class="stars off">{'☆'.repeat(5 - track.rating)}</span>{/if}
                </td>
              {:else if field === 'colour'}
                <!-- Rekordbox colour as a real swatch, not the raw 0xRRGGBB
                     (ISSUES.md #8). Named tags get an accessible title. -->
                <td class="colour">
                  {#if track.colour === null}
                    —
                  {:else}
                    {@const hex = colourHex(track.colour)}
                    {#if hex !== null}
                      <span
                        class="swatch"
                        style="background: {hex}"
                        title={REKORDBOX_COLOURS[track.colour] ?? track.colour}
                      ></span>
                    {:else}
                      {track.colour}
                    {/if}
                  {/if}
                </td>
              {:else}
                <td
                  class:ellipsis={isTextColumn(field)}
                  class:tabular={!isTextColumn(field)}
                  class:title={field === 'title'}
                  title={field === 'location' && track.location !== null
                    ? track.location
                    : undefined}>{formatPropertyValue(track, field)}</td
                >
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !inSetOnly && sorted.length > MAX_ROWS}
      <p class="capped">
        Showing the first {MAX_ROWS} of {sorted.length} tracks — flip the sort or narrow the playlist
        selection to reach the rest.
      </p>
    {/if}
  {/if}
</section>

<style>
  .tracks-view {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--surface);
  }

  .empty-hint {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--ink-secondary);
    font-size: 13px;
  }

  .empty-hint span {
    color: var(--ink-muted);
    font-size: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    border-bottom: 1px solid var(--baseline);
    text-align: left;
    padding: 0;
  }

  .sort {
    width: 100%;
    background: none;
    border: none;
    border-radius: 0;
    padding: 8px 10px;
    text-align: left;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-muted);
    white-space: nowrap;
  }

  .sort:hover {
    color: var(--ink);
  }

  .dir {
    color: var(--accent);
    margin-left: 3px;
  }

  tbody tr {
    cursor: pointer;
    /* click selects, ＋ appends — text selection would fight both */
    user-select: none;
  }

  /* v14 T1: while 🔗 is armed the whole row is a link target, so it reads as
     a crosshair — the same intent the wheel shows. */
  tbody tr.link-armed {
    cursor: crosshair;
  }

  th.drop-target {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .pos-col {
    width: 34px;
  }

  .pos {
    text-align: center;
  }

  .manual-col {
    width: 26px;
    text-align: center;
  }

  /* Pin the cell width to the header's so the column never resizes when a
     selection swaps the count text for the 🔗 icon (ISSUES.md #3). */
  .manual {
    width: 26px;
    text-align: center;
  }

  /* The leading icon columns (★ / ☰ / 🔗) don't need the 10px text padding —
     trim it so they stop eating horizontal space (ISSUES.md #3). */
  .tags,
  .pos,
  .manual {
    padding-left: 2px;
    padding-right: 2px;
  }

  .manual-count {
    font-size: 11px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }

  .pos-btn {
    min-width: 26px;
    padding: 1px 5px;
    font-size: 11px;
    background: none;
    border: 1px solid transparent;
    border-radius: 999px;
    color: var(--ink-muted);
    opacity: 0;
    transition: var(--bounce-transition);
  }

  .pos-btn:active {
    transform: scale(0.8);
  }

  tbody tr:hover .pos-btn,
  tbody tr:focus-within .pos-btn {
    opacity: 1;
    border-color: var(--border);
  }

  .pos-btn.in-set {
    opacity: 1;
    color: var(--accent);
    font-weight: 600;
  }

  /* Hovering an in-set position swaps the number for a ✕ (v9 issue 14). */
  .pos-btn .x {
    display: none;
  }

  .pos-btn.in-set:hover .num,
  .pos-btn.in-set:focus-visible .num {
    display: none;
  }

  .pos-btn.in-set:hover .x,
  .pos-btn.in-set:focus-visible .x {
    display: inline;
  }

  tbody tr:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  tbody tr.connected {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* Mirrors a hover in the set list (v9 issue 20). */
  tbody tr.set-hovered {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  tbody tr.selected {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--grid);
    color: var(--ink-secondary);
    white-space: nowrap;
  }

  td.title {
    color: var(--ink);
  }

  .ellipsis {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Rekordbox colour swatch (#8): a small chip of the tag's colour. */
  .colour {
    text-align: center;
  }

  .swatch {
    display: inline-block;
    width: 13px;
    height: 13px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
    vertical-align: middle;
  }

  /* Header and body icons share a centred column (v11 issue 11): the ★ in
     the header sits exactly over the row stars, the ☰ over the ＋/numbers. */
  .tags-col {
    width: 26px;
    text-align: center;
  }

  .tags {
    text-align: center;
  }

  .pos-col {
    text-align: center;
  }

  /* The header ★/🔗 quick filters appear on header hover, like the row tags
     on row hover (v10 issue 14); each stays lit while its marks filter is
     active (v18 #3/#8 — shared idiom, one class for both glyphs). */
  .header-toggle {
    opacity: 0;
  }

  thead:hover .header-toggle,
  thead:focus-within .header-toggle,
  .header-toggle.on {
    opacity: 1;
  }

  .header-toggle.on {
    color: var(--accent);
  }

  .pos-toggle {
    background: none;
    border: none;
    padding: 8px 6px;
    font-size: 12px;
    color: var(--ink-muted);
  }

  .pos-toggle:hover,
  .pos-toggle.on {
    color: var(--accent);
  }

  .pos-toggle:disabled {
    color: var(--ink-muted);
    opacity: 0.4;
    cursor: default;
  }

  .tag {
    background: none;
    border: none;
    padding: 0 3px;
    font-size: 12px;
    color: var(--ink-muted);
    opacity: 0;
    /* Springy press (v12 WS2): squash on :active, overshoot on release. */
    transition: var(--bounce-transition);
  }

  .tag:active {
    transform: scale(0.75);
  }

  tbody tr:hover .tag,
  tbody tr:focus-within .tag,
  .tag.on {
    opacity: 0.65;
  }

  .tag.on {
    color: var(--accent);
    opacity: 1;
  }

  /* v18 #4: with a selection every row's 🔗 is a live target — steady, faint.
     Hover changes only the cursor. Partners/selected (.on) stay full accent. */
  table.has-selection td.manual .tag:not(.on) {
    opacity: 0.35;
  }
  table.has-selection td.manual .tag:focus-visible {
    opacity: 1;
  }

  .stars {
    color: var(--accent);
    letter-spacing: 1px;
  }

  .stars.off {
    color: var(--ink-muted);
    opacity: 0.45;
  }

  .capped {
    margin: 8px 12px 12px;
    color: var(--ink-muted);
    font-size: 12px;
  }
</style>
