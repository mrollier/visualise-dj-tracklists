<script lang="ts">
  // The Tracks central view (issue 7): the selected playlists as a classic
  // sortable table, like the browser in DJ software. Rows share the global
  // selection with the wheel; tracks connected to the selection in the combo
  // graph highlight; the leading ＋ cell appends to the set and turns into
  // the track's position number(s) once included (v8 issue 15); per-row
  // toggles mark a track as essential (must-include) or as the opener/closer
  // of generated sets — the same pins as everywhere else.
  import { COLUMN_LABELS, visibleColumns } from '../core/columns'
  import { MARK_FILTERS } from '../core/marks'
  import type { Track } from '../core/model'
  import { nextStarState, PIN_FIRST_GLYPH, PIN_LAST_GLYPH, type StarState } from '../core/pins'
  import { formatPropertyValue, PROPERTY_BY_KEY, REKORDBOX_COLOURS } from '../core/properties'
  import { removeAllOccurrences } from '../core/sets'
  import { sortTracks, type TrackSortField } from '../core/trackSort'
  import { decks as playerDecks, playing as playerPlaying } from './audio/playerStore'
  import {
    addTrackToSet,
    comboComplete,
    effectiveManualEdges,
    filters,
    analysedFieldsById,
    augmentedLibrary,
    hoveredId,
    linkArmed,
    manualEdges,
    mustInclude,
    neighbours,
    pinnedFirst,
    pinnedLast,
    selectedId,
    selectOrLink,
    settings,
    toggleManualEdge,
    toggleMarkFilter,
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

  // Column widths (v24): computed once from the FULL library, not the
  // filtered/sorted view, then locked in via a <colgroup> below
  // (table-layout: fixed) — so toggling a filter or mark (♪ ring, ★, 🔗,
  // playlists…) never reflows a column, only the visible row set changes.
  // Must mirror the real fonts/padding in the style block below or the
  // locked width will be wrong.
  const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif"
  const HEADER_FONT = `600 10.5px ${FONT_STACK}` // .sort
  const BODY_FONT = `12.5px ${FONT_STACK}` // td
  const HEADER_PAD = 20 // .sort's padding: 8px 10px
  const BODY_PAD = 20 // td's padding: 5px 10px
  const ELLIPSIS_CAP = 220 // matches .ellipsis { max-width: 220px }
  const KEY_RING_RESERVE = 20 // .key-ring's 18px + .th-inner's 2px gap
  const RATING_REFERENCE = '★'.repeat(5) // rating renders 5 star glyphs, not formatPropertyValue's text
  // Canvas text measurement can be a hair narrower than the DOM's own text
  // layout (font hinting/kerning differences); a fixed column has no
  // overflow: hidden safety net outside .ellipsis, so pad every width
  // slightly rather than risk a sub-pixel clip.
  const SAFETY_MARGIN = 2

  let measureCtx: CanvasRenderingContext2D | null = null
  function measureWidth(text: string, font: string, letterSpacing = '0'): number {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (measureCtx === null) return 0
    measureCtx.font = font
    measureCtx.letterSpacing = letterSpacing
    return measureCtx.measureText(text).width
  }

  // Every column reserves ▲/▼ space unconditionally (v25 review revert),
  // even though it isn't currently sorted — so clicking a different column
  // header to sort by it never reflows anything either, the same guarantee
  // filter/mark toggles already get. columnWidths' only dependencies are
  // $augmentedLibrary/columns, deliberately excluding $trackSort.
  //
  // v33: measured over the AUGMENTED library, not the raw one. The table is
  // `table-layout: fixed` and cells are nowrap without overflow:hidden, so an
  // under-measured column spills rather than ellipsising — and a filled BPM
  // renders as "128.02" where the raw value rendered as "—". Loading an
  // analysis sidecar therefore DOES reflow columns; that is a library-level
  // change like an import, not the filter/mark toggle the guarantee above is
  // about.
  const columnWidths = $derived.by(() => {
    const widths: Partial<Record<TrackSortField, number>> = {}
    const arrowWidth = measureWidth('▲', HEADER_FONT) + 3 // .dir's margin-left
    for (const field of columns) {
      const label = COLUMN_LABEL[field].toUpperCase()
      let header = measureWidth(label, HEADER_FONT, '0.09em') + HEADER_PAD + arrowWidth
      if (field === 'key') header += KEY_RING_RESERVE

      let body: number
      if (field === 'rating') {
        body = measureWidth(RATING_REFERENCE, BODY_FONT) + BODY_PAD
      } else {
        let maxText = 0
        for (const track of $augmentedLibrary) {
          const w = measureWidth(formatPropertyValue(track, field), BODY_FONT)
          if (w > maxText) maxText = w
        }
        body = maxText + BODY_PAD
        if (isTextColumn(field)) body = Math.min(body, ELLIPSIS_CAP)
      }

      widths[field] = Math.ceil(Math.max(header, body)) + SAFETY_MARGIN
    }
    return widths
  })

  // Provenance (v33): a value the analysis sidecar supplied is marked, so a
  // filled BPM or key is never mistaken for something Rekordbox measured. A
  // dotted underline rather than a glyph: the colgroup above measures cell
  // TEXT, so a "≈" prefix would cost width the widths do not know about.
  const ANALYSED_TITLE = 'Analysed locally — not from Rekordbox'

  function isAnalysed(trackId: string, field: TrackSortField): boolean {
    const fields = $analysedFieldsById.get(trackId)
    return fields !== undefined && (fields as ReadonlySet<string>).has(field)
  }

  function cellTitle(track: Track, field: TrackSortField): string | undefined {
    if (field === 'location' && track.location !== null) return track.location
    return isAnalysed(track.id, field) ? ANALYSED_TITLE : undefined
  }

  // Tracks the player is actually sounding right now (v28.2). All-false when
  // the preview is off or disposed, so no settings gate is needed.
  const audibleIds = $derived(
    new Set(
      [$playerPlaying.a ? $playerDecks.a : null, $playerPlaying.b ? $playerDecks.b : null].filter(
        (id) => id !== null,
      ),
    ),
  )

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

  // In-set-only view (v10 issue 15, unified with the ☰ Constellation panel
  // filter v25): show only the active set's tracks, in set order (deduped
  // by first occurrence), with all metadata columns — the right panel's
  // set, fleshed out. Column sorting is suspended here. Backed by
  // `filters.marks.constellationOnly` (not local state) so it's persisted,
  // reachable from the Filters panel/Advanced Settings, and also narrows
  // the Wheel/Genres via `visibleLibrary` — kept under this name since it
  // still reads everywhere below as a display-mode flag, unrelated to the
  // unification.
  const inSetOnly = $derived($filters.marks.constellationOnly)
  // Constellation members that also pass every OTHER active filter (v25):
  // a track can be in the constellation but excluded here by e.g. a BPM
  // range, exactly like it would be dropped from visibleLibrary itself —
  // the walk-ordered view and the rest of the app agree on membership.
  const visibleIdSet = $derived(new Set($visibleLibrary.map((t) => t.id)))
  const inSetRows = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived-local
    const seen = new Set<string>()
    const out: Track[] = []
    for (const id of $tracklist) {
      if (seen.has(id) || !visibleIdSet.has(id)) continue
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

  // Whether the ★/🔗 columns and the Key column's ♪ ring filter render at
  // all (v23): the same `settings.visibleFilters` list the left panel's ★
  // Starred/🔗 Combos/♪ Keys rows and the advanced "Track properties"
  // checkboxes drive. Read the raw setting, not `effectiveFilters` — easy
  // mode neutralising the underlying filter shouldn't also hide the column
  // gate, which is a separate, user-controlled visibility choice.
  const showStarCol = $derived($settings.visibleFilters.includes('starred'))
  const showComboCol = $derived($settings.visibleFilters.includes('combos'))
  const showKeyRings = $derived($settings.visibleFilters.includes('keys'))
  // Same gate for the ☰ pos-toggle button (v25) — unlike the other three,
  // this one stays mounted regardless (no !easy here): the ＋/position-
  // number cells in .pos-col are a separate, always-on affordance, and the
  // button keeps local value (the walk-ordered table) even when easy mode
  // neutralises its library-wide effect.
  const showConstellationCol = $derived($settings.visibleFilters.includes('constellation'))

  // Total header/body columns, incl. the pos lead which always renders (v18
  // #3/#8 review fix, A1; formula widened v23 for the ★/🔗 columns' new
  // visibility gate): the empty-state row spans all of them via colspan, so
  // <thead> — and its ★/🔗/♪ filter toggles — stays mounted even when the
  // filtered view is empty. The old version replaced the whole <table> with
  // a plain hint div, unmounting the only control that could turn an active
  // header filter back off.
  const colCount = $derived(
    (showStarCol ? 1 : 0) + 1 + (!easy && showComboCol ? 1 : 0) + columns.length,
  )

  // Whether the header ★/🔗 toggles have anything to show if turned on
  // (v18 #3/#8 review fix, A2) — disabled otherwise, since clicking would
  // either change nothing (nothing starred: "only" already equals "all") or
  // silently empty the table with no visible cause. Never disabled while
  // its flag is ON, so it can always be turned back off. anyStarred mirrors
  // marks.ts's starredIdSet definition (must-include ∪ both pins) without a
  // second Set alloc — mustSet already covers the must-include half.
  const anyStarred = $derived(mustSet.size > 0 || $pinnedFirst !== null || $pinnedLast !== null)
  const starToggleDisabled = $derived(!$filters.marks.starredOnly && !anyStarred)
  const comboToggleDisabled = $derived(!$filters.marks.comboOnly && $manualEdges.length === 0)
  const constellationToggleDisabled = $derived(!inSetOnly && $tracklist.length === 0)

  // The two flags the header buttons drive, read from the shared registry
  // (v18 #3/#8 review fix, B2) rather than bare string literals — the two
  // buttons still keep their own bespoke title copy below (different glyph,
  // different disabled reason, too dissimilar to loop like FiltersSection/
  // AdvancedMenu do), but not a second hardcoded copy of which pseudo-key
  // maps to which filters.marks flag.
  const starredFlag = MARK_FILTERS.find((m) => m.key === 'starred')?.flag ?? 'starredOnly'
  const comboFlag = MARK_FILTERS.find((m) => m.key === 'combos')?.flag ?? 'comboOnly'

  // The Key column's ♪ ring quick filter (Design §6, v23): same easy-mode
  // gate as the ★/🔗 header toggles above (easy mode neutralises keyRings
  // through effectiveFilters, so the button would be inert there) plus the
  // visibility flag. No longer gated on constellation-only mode (v25): that
  // mode is just another AND-ed condition inside visibleLibrary now, not a
  // bypass of it, so this filter stays meaningful while it's active.
  const keyRingButtonVisible = $derived(showKeyRings && !easy)
  // Three named stops plus a defensive fourth (both rings off, reachable
  // only from the left panel's independent minor/major toggles): .on is
  // true whenever a ring is actually excluded, i.e. whenever the state
  // isn't "both on".
  const keyRingOn = $derived(!($filters.keyRings.minor && $filters.keyRings.major))
  const keyRingGlyph = $derived.by(() => {
    const { minor, major } = $filters.keyRings
    if (minor && !major) return '♪A'
    if (major && !minor) return '♪B'
    return '♪'
  })
  const keyRingTitle = $derived.by(() => {
    const { minor, major } = $filters.keyRings
    if (minor && major) return 'Show minor keys only'
    if (minor && !major) return 'Showing minor keys only — click for major only'
    if (major && !minor) return 'Showing major keys only — click to show both'
    return 'Click to show both rings'
  })
  // Cycle both → minor only → major only → both (the same direct
  // filters.update FiltersSection's toggleRing uses — there's no store
  // helper for this). Both off (the panel-only fourth state) rejoins the
  // cycle at its start rather than stopping on it.
  function cycleKeyRings() {
    filters.update((f) => {
      const { minor, major } = f.keyRings
      const next =
        minor && major
          ? { minor: true, major: false }
          : minor
            ? { minor: false, major: true }
            : { minor: true, major: true }
      return { ...f, keyRings: next }
    })
  }

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
  const STAR_GLYPH: Record<StarState, string> = {
    none: '☆',
    must: '★',
    first: PIN_FIRST_GLYPH,
    last: PIN_LAST_GLYPH,
  }
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
    // v18 #3/#8 review fix (C4): one mustInclude.update, not remove-then-
    // conditionally-add — each write is a full marksContext/visibleLibrary
    // recompute once starredOnly is on (the O(n²) combo graph rides along).
    mustInclude.update((ids) => {
      const without = ids.filter((x) => x !== id)
      return next === 'must' ? [...without, id] : without
    })
    if ($pinnedFirst === id) pinnedFirst.set(null)
    if ($pinnedLast === id) pinnedLast.set(null)
    if (next === 'first') pinnedFirst.set(id)
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
  <table class:has-selection={$selectedId !== null}>
    <!-- table-layout: fixed, driven by these widths (v24): mirrors the
         header row's column order exactly. columnWidths is computed once
         from the full library, not the filtered view, so no filter/mark
         toggle ever reflows a column — see columnWidths above. -->
    <colgroup>
      {#if showStarCol}
        <col style="width: 26px" />
      {/if}
      <col style="width: 34px" />
      {#if !easy && showComboCol}
        <col style="width: 26px" />
      {/if}
      {#each columns as field (field)}
        <col style="width: {columnWidths[field]}px" />
      {/each}
    </colgroup>
    <thead>
      <tr>
        <!-- Tags + position lead the row (v9 issue 13); the header ★ is a
             quick filter now (v18 #3/#8 — the old mark-all-★ action
             retired). `showStarCol` hides the whole column, header and row
             ★s alike; within a shown column, the button (not the row-level
             ★, which still cycles) hides in easy mode, like the 🔗 toggle
             below: easy mode neutralises the marks filter it drives. -->
        {#if showStarCol}
          <th class="tags-col">
            {#if !easy}
              <button
                class="header-toggle"
                class:on={$filters.marks.starredOnly}
                disabled={starToggleDisabled}
                title={starToggleDisabled
                  ? 'Nothing is starred yet'
                  : $filters.marks.starredOnly
                    ? 'Showing only ★ tracks — click to show all'
                    : 'Show only ★ tracks'}
                aria-label="Toggle showing only starred tracks"
                aria-pressed={$filters.marks.starredOnly}
                onclick={() => toggleMarkFilter(starredFlag)}>★</button
              >
            {/if}
          </th>
        {/if}
        <th class="pos-col">
          <!-- Toggle a metadata-rich, set-only, position-ordered view (v10
               issue 15; unified with the ☰ Constellation panel filter v25 —
               see `inSetOnly` above). Disabled while the set is empty — an
               empty set-only table is a dead end (v11 issue 12a). Stays
               mounted regardless of easy mode (unlike ★/🔗 above): it keeps
               local value here even when easy mode neutralises its
               library-wide effect. `showConstellationCol` mirrors
               `showStarCol`/`showComboCol` — the shared Advanced Settings
               tick that hides this row also hides this button. -->
          {#if showConstellationCol}
            <button
              class="pos-toggle"
              class:on={inSetOnly}
              disabled={constellationToggleDisabled}
              title={constellationToggleDisabled
                ? 'Add tracks to the constellation first'
                : inSetOnly
                  ? 'Show all tracks'
                  : 'Show only this constellation, in order'}
              aria-label="Toggle the constellation-only view"
              aria-pressed={inSetOnly}
              onclick={() => toggleMarkFilter('constellationOnly')}
            >
              <!-- An SVG, not the ☰ character (v24 review fix): a text
                   glyph's baseline sits at a font-/platform-dependent offset
                   that two rounds of padding tuning couldn't pin down
                   reliably — a vector box centers by construction, immune to
                   font metrics. -->
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <rect y="2.5" width="16" height="2" rx="1" fill="currentColor" />
                <rect y="7" width="16" height="2" rx="1" fill="currentColor" />
                <rect y="11.5" width="16" height="2" rx="1" fill="currentColor" />
              </svg>
            </button>
          {/if}
        </th>
        {#if !easy && showComboCol}
          <!-- Manual (🔗) combos, list-view analogue of the wheel's dashed
               links: unselected shows a per-row count, a selection swaps
               that for a lit/clickable icon on the actual partners. The
               header 🔗 is a quick filter (v18 #3/#8), same idiom as the
               header ★ — the old clear-all-combos action retired. -->
          <th class="manual-col">
            <button
              class="header-toggle"
              class:on={$filters.marks.comboOnly}
              disabled={comboToggleDisabled}
              title={comboToggleDisabled
                ? 'No manual combos yet'
                : $filters.marks.comboOnly
                  ? 'Showing only manual-combo tracks — click to show all'
                  : 'Show only tracks with a manual combo'}
              aria-label="Toggle showing only tracks with a manual combo"
              aria-pressed={$filters.marks.comboOnly}
              onclick={() => toggleMarkFilter(comboFlag)}>🔗</button
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
            title={PROPERTY_BY_KEY.get(field)?.hint}
            aria-sort={!inSetOnly && $trackSort.field === field
              ? $trackSort.dir === 'asc'
                ? 'ascending'
                : 'descending'
              : undefined}
          >
            <!-- v23 review fix: a normal-flow flex row, not an absolutely
                 positioned overlay — the .lock precedent
                 (CriteriaPanel.svelte:330-336) is a flex child, not an
                 overlay, and that's the layout being followed here, not
                 just its fixed width. Wrapping only touches this <th>'s own
                 contents, not the <th> or any other column's markup. -->
            <span class="th-inner">
              <button class="sort" class:key={field === 'key'} onclick={() => toggleSort(field)}>
                {COLUMN_LABEL[field]}
                <!-- Set order supersedes column sorting in set-only mode, so
                     the triangle hides there (v11 issue 12b); the stored
                     sort is untouched and returns on toggle-back. -->
                {#if !inSetOnly && $trackSort.field === field}<span class="dir"
                    >{$trackSort.dir === 'asc' ? '▲' : '▼'}</span
                  >{/if}
              </button>
              {#if keyRingButtonVisible && field === 'key'}
                <!-- ♪ ring quick filter (Design §6, v23): a sibling of
                     .sort, not nested inside it — nested buttons are
                     invalid HTML — and not a new <th>, per the brief.
                     draggable="false" + a cancelled dragstart keep a
                     click-drag on this button from being read as a column
                     reorder of the draggable <th> it sits inside. -->
                <button
                  type="button"
                  class="header-toggle key-ring"
                  class:on={keyRingOn}
                  title={keyRingTitle}
                  aria-label="Toggle filtering tracks by key ring"
                  aria-pressed={keyRingOn}
                  draggable="false"
                  onclick={(e) => {
                    e.stopPropagation()
                    cycleKeyRings()
                  }}
                  ondragstart={(e) => e.preventDefault()}>{keyRingGlyph}</button
                >
              {/if}
            </span>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#if rows.length === 0}
        <!-- v18 #3/#8 review fix (A1): a spanning row inside <tbody>, not a
             div replacing the whole <table> — <thead> (and the ★/🔗 filter
             toggles in it) must stay mounted so an active header filter
             that empties the view can always be turned back off. -->
        <tr class="empty-row">
          <td colspan={colCount}>
            <div class="empty-hint">
              <strong>Nothing to list yet.</strong>
              <span
                >Select a playlist, loosen the filters on the left, or turn off an active header
                filter to fill the table.</span
              >
            </div>
          </td>
        </tr>
      {:else}
        {#each rows as track (track.id)}
          {@const positions = positionsById.get(track.id)}
          {@const starState = starStateOf(track.id)}
          <tr
            class:selected={track.id === $selectedId}
            class:playing={audibleIds.has(track.id)}
            class:connected={connectedIds?.has(track.id) === true}
            class:set-hovered={track.id === $hoveredId}
            class:link-armed={$linkArmed}
            onclick={() => selectRow(track.id)}
          >
            {#if showStarCol}
              <td class="tags">
                <!-- One star per row cycles must-include → opener → closer
                     (v10 issue 13); the four-icon cluster is retired. -->
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
            {/if}
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
            {#if !easy && showComboCol}
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
                  class:analysed={isAnalysed(track.id, field)}
                  title={cellTitle(track, field)}>{formatPropertyValue(track, field)}</td
                >
              {/if}
            {/each}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
  {#if !inSetOnly && sorted.length > MAX_ROWS}
    <p class="capped">
      Showing the first {MAX_ROWS} of {sorted.length} tracks — flip the sort or narrow the playlist selection
      to reach the rest.
    </p>
  {/if}
</section>

<style>
  .tracks-view {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--surface);
  }

  /* v18 #3/#8 review fix (A1): now a <td> child, not the section's sole
     child, so it no longer fills/centres in the full panel height (a table
     row can't stretch into leftover flex space without real trickery) —
     .empty-row's padding below is the tradeoff, generous breathing room
     instead of true vertical centring. */
  .empty-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    /* Centres itself within the full-width colspan cell below, rather than
       stretching edge to edge (v18 review fix, round 2) — a comfortable
       reading width for the hint sentence, not the whole table's width. */
    max-width: 420px;
    margin: 0 auto;
    color: var(--ink-secondary);
    font-size: 13px;
  }

  .empty-row {
    cursor: default;
    /* Not a data row — the generic tbody tr rule below assumes ＋/click
       affordances that don't apply here (v18 review fix, round 2). */
    user-select: text;
  }

  /* v18 review fix (round 2): the generic `td` rule further down sets
     white-space: nowrap for tabular alignment, INHERITED here since
     .empty-hint/.empty-hint span never reset it — the ~106-char hint
     sentence rendered as one unbreakable line, and table-layout: auto grew
     the whole table (horizontal scroll on .tracks-view) to fit it whenever
     the view was narrower than that line, e.g. with the 280px Advanced
     panel open. break-word is a defensive backstop for any single token
     that's still too long to fit .empty-hint's max-width above. */
  .empty-row td {
    padding: 48px 16px;
    white-space: normal;
    overflow-wrap: break-word;
  }

  .empty-hint span {
    color: var(--ink-muted);
    font-size: 12px;
  }

  table {
    width: 100%;
    /* Widths come from the <colgroup> above, computed once from the full
       library (v24) — this is what stops a filter/mark toggle from
       reflowing any column, not just the ♪ ring one. Every column gets a
       measured width (v28.2): the first alpha column used to render as a
       bare <col> meant to absorb leftover space, but at the pane's 680px
       floor the pinned columns alone exceed the table width and fixed
       layout squeezed that one column — Artist, not Title as the old
       comment claimed — to nothing. The wrapper scrolls instead. */
    table-layout: fixed;
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

  /* v23 review fix: a normal-flow flex row wrapping .sort and the ♪ ring
     button (present only on the Key column), replacing an earlier
     absolutely-positioned overlay — this is what makes .key-ring's fixed
     width below a genuine in-flow neighbour of .sort rather than a floated
     box guessing at reserved padding. Scoped to this <th>'s own contents;
     every other column still renders a single flex child, pixel-identical
     to the old block layout. */
  .th-inner {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .sort {
    flex: 1 1 auto;
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

  /* The Key column has a second interactive control (.key-ring) beside its
     label — shrink the sort button to its own text so the ♪ icon sits
     right next to "Key" instead of at the column's far edge (v24 review).
     Every other column keeps the full-width flex:1 1 auto click target. */
  .sort.key {
    flex: 0 1 auto;
  }

  /* The ♪ ring quick filter (Design §6, v23): a normal-flow flex sibling of
     .sort inside .th-inner, not an overlay — the CriteriaPanel.svelte:
     330-336 .lock precedent for BOTH its layout technique (an in-flow flex
     child) and its fixed width, so the ♪ ↔ ♪A ↔ ♪B glyph swap never shifts
     .sort's label or the ▲/▼ sort arrow beside it. flex-shrink: 0 keeps it
     from being squeezed by .sort's flex-grow in a narrow column. */
  /* button.key-ring, not .key-ring alone (v25 review fix): same
     specificity as .header-toggle's own "padding: 8px 6px" resolved by
     source order before, silently overriding this padding — the element
     qualifier wins outright, regardless of order. Width fits "♪A"/"♪B"'s
     ~14px ink plus 2px each side — the previous 26px was carrying ~8px of
     dead space no glyph ever used. */
  button.key-ring {
    flex-shrink: 0;
    width: 18px;
    padding: 8px 2px;
    display: inline-flex;
    justify-content: center;
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

  /* :not(.empty-row) (v18 review fix, round 2): the info row isn't
     interactive, so it shouldn't tint like a selectable data row. */
  tbody tr:hover:not(.empty-row) {
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

  /* The audible track's row breathes (v28.2; faster and brighter in v29 #4);
     a selected one breathes between stronger mixes so selection stays visibly
     darker throughout. The peak sits above the static `tr.selected` tint, so
     the audible row reads as the loudest thing in the table. */
  tbody tr.playing {
    animation: row-breathe 1.6s ease-in-out infinite;
  }

  tbody tr.playing.selected {
    animation-name: row-breathe-selected;
  }

  @keyframes row-breathe {
    0%,
    100% {
      background-color: color-mix(in srgb, var(--accent) 22%, transparent);
    }

    50% {
      background-color: color-mix(in srgb, var(--accent) 4%, transparent);
    }
  }

  @keyframes row-breathe-selected {
    0%,
    100% {
      background-color: color-mix(in srgb, var(--accent) 40%, transparent);
    }

    50% {
      background-color: color-mix(in srgb, var(--accent) 16%, transparent);
    }
  }

  /* Without motion the tint has to carry the whole signal, so it sits above
     the static one a merely-selected row wears — 22% used to MATCH it, which
     made an audible selected row indistinguishable from a silent one. */
  @media (prefers-reduced-motion: reduce) {
    tbody tr.playing {
      animation: none;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
    }

    tbody tr.playing.selected {
      animation: none;
      background: color-mix(in srgb, var(--accent) 34%, transparent);
    }
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

  /* Analysed rather than measured by Rekordbox (v33). Deliberately costs no
     layout: the colgroup measures cell text, so a marker that changed the
     text would need to enter that measurement pass. */
  td.analysed {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    text-decoration-color: var(--muted);
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

  /* The header ★/🔗 quick filters (v18 #3/#8) are permanent controls, not row
     icons: self-contained like .pos-toggle below rather than riding .tag,
     which sets opacity:0 for the row stars and hid these until the header was
     hovered — visible only while disabled, gone the moment starring a track
     made them usable (v22). Order matters: :disabled must follow :hover, same
     specificity, so a disabled toggle never picks up the accent colour. */
  .header-toggle {
    background: none;
    border: none;
    padding: 8px 6px;
    font-size: 12px;
    color: var(--ink-muted);
    /* Springy press (v12 WS2), the one thing worth keeping from .tag. */
    transition: var(--bounce-transition);
  }

  .header-toggle:active {
    transform: scale(0.75);
  }

  .header-toggle:hover,
  .header-toggle.on {
    color: var(--accent);
  }

  .header-toggle:disabled {
    color: var(--ink-muted);
    opacity: 0.4;
    cursor: default;
  }

  .pos-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 8px 6px;
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
