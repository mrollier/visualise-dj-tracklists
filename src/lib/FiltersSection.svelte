<script lang="ts">
  import { get } from 'svelte/store'
  import {
    ALPHA_CATCH_ALL,
    alphaBucketLabel,
    clampRange,
    colourChipOptions,
    propertyExtents,
    wholeExtent,
    type LibraryFilters,
    type PropertyRange,
    type QualityChoice,
  } from '../core/filter'
  import { isPanelFilterKey, PANEL_FILTERS } from '../core/marks'
  import {
    ANALYSIS_GROUP_HINT,
    isDescriptorKey,
    PROPERTY_BY_KEY,
    REKORDBOX_COLOURS,
    type TrackProperty,
  } from '../core/properties'
  import InfoTooltip from './InfoTooltip.svelte'
  import PanelFilterIcon from './PanelFilterIcon.svelte'
  import type { TrackSortField } from '../core/trackSort'
  import {
    filters,
    library,
    playlistScopedLibrary,
    setMarkFilter,
    settings,
    visibleLibrary,
  } from '../stores'

  type RangeSide = 'min' | 'max'

  // Alpha buckets A…Z then '#' (v14 WS2): options for the min/max selects.
  const ALPHA_OPTIONS = Array.from({ length: ALPHA_CATCH_ALL + 1 }, (_, i) => ({
    value: i,
    label: alphaBucketLabel(i),
  }))

  // The rows on show: the user's visibleFilters selection (advanced "Track
  // properties" table), resolved through the registry (v11 issue 1). Since
  // v18 (#3/#8) visibleFilters can also carry the starred/combos/keys panel
  // pseudo-keys, filtered out here — those three render as their own gated
  // group below the property {#each} (panelRows, from the PANEL_FILTERS
  // registry, in registry order — v23), bound to filters.marks/keyRings
  // directly rather than a per-property range.
  const rows = $derived(
    $settings.visibleFilters
      .filter((key): key is TrackSortField => !isPanelFilterKey(key))
      .map((key) => PROPERTY_BY_KEY.get(key))
      .filter((p): p is TrackProperty => p !== undefined && p.filterable),
  )
  // The analysis-derived rows (v35) sit in their own collapsed group, so the
  // caveat they share — one offline run, no validation against the ear — is
  // stated once on the group rather than four times.
  const plainRows = $derived(rows.filter((p) => p.analysisOnly !== true))
  const analysisRows = $derived(rows.filter((p) => p.analysisOnly === true))
  const panelRows = $derived(PANEL_FILTERS.filter((m) => $settings.visibleFilters.includes(m.key)))

  /**
   * The row's own bounds: the key wheel's 1–12, else 0 up to the registry's
   * `max` (5 for Rating, 100 for the descriptors) — `undefined` where the
   * property is genuinely unbounded (BPM, Year, play count).
   *
   * One source for the boxes' `min`/`max` attributes AND for `commit`'s
   * clamping. They used to disagree: the attributes came from the registry
   * while commit fell back to a hardcoded 0/9999, so on a library with no
   * values for a property, typing one side filled the other with 9999 —
   * a Danceability of 9999% (and a Rating of 9999) on a control that
   * advertised a ceiling of 100.
   */
  function propBounds(prop: TrackProperty): [number, number | undefined] {
    if (prop.kind === 'key') return [1, 12]
    return [0, prop.max]
  }

  /** The number boxes' ceiling: kind for keys, the registry for everything else. */
  function boxMax(prop: TrackProperty): string | undefined {
    const ceiling = propBounds(prop)[1]
    return ceiling === undefined ? undefined : String(ceiling)
  }

  // Extents of the playlist-scoped library for the numeric-ish rows: the
  // defaults follow the playlists you work in, not the whole collection.
  const scopedExtents = $derived(
    propertyExtents(
      $playlistScopedLibrary,
      rows.filter((p) => p.kind === 'number' || p.kind === 'key').map((p) => p.key),
    ),
  )

  // Local min/max text per row, seeded from the playlist selection's actual
  // extremes or from an active filter. Only user edits (and playlist
  // toggles, which reset the numeric ranges) write to the filters store, so
  // loaded projects keep their saved ranges.
  let inputs = $state<Partial<Record<TrackSortField, { min: string; max: string }>>>({})

  // Date sentinels keep persisted JSON finite while a side stays open.
  const DATE_OPEN_MIN = '0000-01-01'
  const DATE_OPEN_MAX = '9999-12-31'

  // The open ceiling for a property with no registry max and nothing in
  // scope (BPM, Year, play count, file size). Finite, so the range still
  // serialises; MAX_SAFE_INTEGER rather than a hardcoded 9999, which was
  // below the real values of size (bytes) and would have filtered them all
  // out had any track been missing its extent.
  const OPEN_MAX = Number.MAX_SAFE_INTEGER

  function seedRow(prop: TrackProperty, active: LibraryFilters): void {
    const range = active.properties[prop.key]
    if (prop.kind === 'number' || prop.kind === 'key') {
      const seeded = range ?? whole(scopedExtents[prop.key] ?? null)
      inputs[prop.key] =
        seeded === undefined || seeded === null || !Array.isArray(seeded)
          ? { min: '', max: '' }
          : { min: String(seeded[0]), max: String(seeded[1]) }
    } else if (prop.kind === 'alpha') {
      // Absent range = the full A…# span (filter off).
      inputs[prop.key] = Array.isArray(range)
        ? { min: String(range[0]), max: String(range[1]) }
        : { min: '0', max: String(ALPHA_CATCH_ALL) }
    } else if (prop.kind === 'date') {
      inputs[prop.key] =
        range === undefined || !Array.isArray(range)
          ? { min: '', max: '' }
          : {
              min: range[0] === DATE_OPEN_MIN ? '' : String(range[0]),
              max: range[1] === DATE_OPEN_MAX ? '' : String(range[1]),
            }
    } else if (prop.kind === 'contains') {
      inputs[prop.key] = {
        min:
          range !== undefined && !Array.isArray(range) && 'contains' in range ? range.contains : '',
        max: '',
      }
    } else {
      // colour / quality read the store directly; this placeholder keeps the
      // lazy-seed guard satisfied.
      inputs[prop.key] = { min: '', max: '' }
    }
  }

  let seededForLibrary: unknown = null
  let seededForPlaylists: unknown = null
  $effect(() => {
    const lib = $library
    const selection = $filters.playlists
    if (lib !== seededForLibrary) {
      // Fresh library (import or project load): show the saved filter when
      // the project carries one, else the selection's whole-number extremes.
      // Never writes to the store here.
      seededForLibrary = lib
      seededForPlaylists = selection
      inputs = {}
      const active = get(filters)
      for (const prop of rows) seedRow(prop, active)
      return
    }
    // Toggling playlists resets the NUMERIC ranges to the new selection's
    // extremes (deliberate: stale ranges from another playlist would
    // silently hide tracks). Text and date filters are absolute criteria,
    // not scope-relative, so they survive the toggle.
    if (selection !== seededForPlaylists) {
      seededForPlaylists = selection
      for (const prop of rows) {
        if (prop.kind === 'number' || prop.kind === 'key') resetRange(prop)
      }
    }
  })

  // A filter made visible after load has no input entry yet — seed it lazily
  // so the row opens showing the saved filter or the scoped extent. A row that
  // has GONE also drops its entry: hiding a filter clears it from the store, so
  // a kept entry would make the row come back displaying a range that is no
  // longer applied — and the next keystroke would silently re-apply the other
  // side of it.
  $effect(() => {
    const active = get(filters)
    const visible = new Set(rows.map((prop) => prop.key))
    for (const key of Object.keys(inputs) as TrackSortField[]) {
      if (!visible.has(key)) Reflect.deleteProperty(inputs, key)
    }
    for (const prop of rows) {
      if (inputs[prop.key] === undefined) seedRow(prop, active)
    }
  })

  function whole(extent: [number, number] | null): [number, number] | null {
    return extent === null ? null : wholeExtent(extent)
  }

  function boxes(key: TrackSortField): { min: string; max: string } {
    return inputs[key] ?? { min: '', max: '' }
  }

  /** Record a keystroke into the row's local state, then commit. */
  function setBox(prop: TrackProperty, side: RangeSide, value: string, reflect = false): void {
    inputs[prop.key] = { ...boxes(prop.key), [side]: value }
    commit(prop, side, reflect)
  }

  function writeProperty(key: TrackSortField, range: PropertyRange | null): void {
    filters.update((f) => {
      const properties = { ...f.properties }
      if (range === null) Reflect.deleteProperty(properties, key)
      else properties[key] = range
      return { ...f, properties }
    })
  }

  /**
   * Push the boxes into the store, clamped so min never exceeds max. The
   * store always receives the clamped range; the boxes themselves are only
   * rewritten on change (blur/enter), so clamping never fights mid-typing.
   */
  function commit(prop: TrackProperty, edited: RangeSide, reflect = false): void {
    const { min, max } = boxes(prop.key)
    if (min === '' && max === '') {
      writeProperty(prop.key, null)
      return
    }
    if (prop.kind === 'number' || prop.kind === 'key') {
      // An emptied side falls back to the selection extreme, then to the
      // property's own bound — never past it. With no values in scope there
      // is no extent, and that is exactly when the fallback is visible.
      const [floor, ceiling] = propBounds(prop)
      const extent = scopedExtents[prop.key] ?? (prop.kind === 'key' ? [1, 12] : null)
      // Typed values clamp to the same bound: `max="100"` on a number input
      // constrains the spinner, not the keyboard, so 500 would otherwise
      // reach the store on a property that cannot exceed 100.
      const cap = (n: number): number => Math.min(Math.max(n, floor), ceiling ?? OPEN_MAX)
      const range = clampRange(
        [
          cap(min === '' ? (extent?.[0] ?? floor) : Number(min)),
          cap(max === '' ? (extent?.[1] ?? ceiling ?? OPEN_MAX) : Number(max)),
        ],
        edited,
      )
      if (reflect) inputs[prop.key] = { min: String(range[0]), max: String(range[1]) }
      writeProperty(prop.key, range)
    } else if (prop.kind === 'date') {
      // Clamped like every other range (v40, Codex bug 6): an inverted pair
      // used to be stored raw, and it hides every track — dated ones match
      // nothing, undated ones are excluded by the date rule itself. ISO
      // YYYY-MM-DD compares lexically, which is clampRange's string mode.
      const range = clampRange(
        [min === '' ? DATE_OPEN_MIN : min, max === '' ? DATE_OPEN_MAX : max],
        edited,
      )
      if (reflect) {
        inputs[prop.key] = {
          min: range[0] === DATE_OPEN_MIN ? '' : range[0],
          max: range[1] === DATE_OPEN_MAX ? '' : range[1],
        }
      }
      writeProperty(prop.key, range)
    }
    // alpha/contains/colour/quality use their own handlers, never setBox/commit.
  }

  // --- alpha (v14 WS2): two bucket selects; the full A…# span writes null. ---
  function setAlpha(prop: TrackProperty, side: RangeSide, value: string): void {
    const next = { ...boxes(prop.key), [side]: value }
    const [min, max] = clampRange([Number(next.min), Number(next.max)], side)
    inputs[prop.key] = { min: String(min), max: String(max) }
    writeProperty(prop.key, min === 0 && max === ALPHA_CATCH_ALL ? null : [min, max])
  }

  // --- contains (v14 WS2): one text box; blank writes null. ---
  function setContains(prop: TrackProperty, value: string): void {
    inputs[prop.key] = { min: value, max: '' }
    const text = value.trim()
    writeProperty(prop.key, text === '' ? null : { contains: text })
  }

  // --- colour (v14 WS2): chip toggles; empty selection writes null. ---
  const scopedColours = $derived([
    ...new Set($playlistScopedLibrary.map((t) => t.colour).filter((c): c is string => c !== null)),
  ])
  function selectedColours(key: TrackSortField): string[] {
    const range = $filters.properties[key]
    return range !== undefined && !Array.isArray(range) && 'colours' in range ? range.colours : []
  }
  function toggleColour(prop: TrackProperty, colour: string): void {
    const current = selectedColours(prop.key)
    const next = current.includes(colour)
      ? current.filter((c) => c !== colour)
      : [...current, colour]
    writeProperty(prop.key, next.length === 0 ? null : { colours: next })
  }
  function swatch(colour: string): string {
    return colour.startsWith('0x') ? `#${colour.slice(2)}` : colour
  }

  // --- quality (F5): independent lossy/lossless toggles. Both-on writes null
  // (no filter); otherwise the allow-list — which may be empty (both-off →
  // only unknown-format tracks show, per the missing-passes rule). ---
  const QUALITY_TOGGLES: QualityChoice[] = ['lossy', 'lossless']
  function selectedQualities(key: TrackSortField): QualityChoice[] {
    const range = $filters.properties[key]
    return range !== undefined && !Array.isArray(range) && 'qualities' in range
      ? range.qualities
      : ['lossy', 'lossless'] // absent = both-on
  }
  function toggleQuality(prop: TrackProperty, q: QualityChoice): void {
    const cur = selectedQualities(prop.key)
    const next = cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q]
    const bothOn = next.includes('lossy') && next.includes('lossless')
    writeProperty(prop.key, bothOn ? null : { qualities: next })
  }

  /** Reset: numeric ranges to the selection's whole-number extremes; alpha to
   *  the full span; contains/colour/quality/date rows to blank (off). */
  function resetRange(prop: TrackProperty): void {
    if (prop.kind === 'number' || prop.kind === 'key') {
      const range = whole(scopedExtents[prop.key] ?? null)
      inputs[prop.key] =
        range === null ? { min: '', max: '' } : { min: String(range[0]), max: String(range[1]) }
      writeProperty(prop.key, range)
    } else if (prop.kind === 'alpha') {
      inputs[prop.key] = { min: '0', max: String(ALPHA_CATCH_ALL) }
      writeProperty(prop.key, null)
    } else {
      inputs[prop.key] = { min: '', max: '' }
      writeProperty(prop.key, null)
    }
  }

  // The minor/major ring toggles (F5): semantically always a filter (v8 issue
  // 10) — two independent on/off buttons. Both-off shows only keyless tracks.
  const RING_TOGGLES = [
    { key: 'minor', label: 'minor' },
    { key: 'major', label: 'major' },
  ] as const
  function toggleRing(ring: 'minor' | 'major'): void {
    filters.update((f) => ({ ...f, keyRings: { ...f.keyRings, [ring]: !f.keyRings[ring] } }))
  }
</script>

<details>
  <summary class="micro-label">
    Filters
    <!-- Visible over the SELECTED PLAYLISTS' total (issue 8): the filter's
         effect is judged against what the playlists put on the table. -->
    <span class="summary-count"
      >{$visibleLibrary.length} of {$playlistScopedLibrary.length} tracks</span
    >
  </summary>

  {#snippet filterRow(prop: TrackProperty)}
    <div class="filter-row">
      {#if prop.analysisOnly === true && isDescriptorKey(prop.key)}
        {@const key = prop.key}
        <!-- The whole label — icon and letter together — is the tooltip
             trigger (v35.1). A separate ⓘ would have to come out of the same
             52px the label column gives every row, and a dotted underline
             under a one-character label reads as a stray mark. -->
        <span class="filter-label descriptor">
          <InfoTooltip label="About {prop.label}">
            {#snippet trigger()}
              <span class="descriptor-trigger">
                <PanelFilterIcon {key} />{prop.shortLabel ?? prop.label}
              </span>
            {/snippet}
            <!-- The name on its own line (InfoTooltip renders a bare <span>
                 as a block): the rail shows only a letter, so the tooltip is
                 a definition and wants a term above its gloss, not a bold
                 run-in ahead of a capitalised sentence. -->
            <span><strong>{prop.label}</strong></span>
            {prop.hint}
          </InfoTooltip>
        </span>
      {:else}
        <span class="filter-label" title={prop.hint}
          >{prop.key === 'dateAdded' ? 'Added' : prop.label}</span
        >
      {/if}
      {#if prop.kind === 'number' || prop.kind === 'key'}
        <input
          type="number"
          placeholder="min"
          min={prop.kind === 'key' ? '1' : '0'}
          max={boxes(prop.key).max === '' ? boxMax(prop) : boxes(prop.key).max}
          value={boxes(prop.key).min}
          oninput={(e) => setBox(prop, 'min', e.currentTarget.value)}
          onchange={(e) => setBox(prop, 'min', e.currentTarget.value, true)}
        />
        <span class="dash">–</span>
        <input
          type="number"
          placeholder="max"
          min={boxes(prop.key).min === '' ? (prop.kind === 'key' ? '1' : '0') : boxes(prop.key).min}
          max={boxMax(prop)}
          value={boxes(prop.key).max}
          oninput={(e) => setBox(prop, 'max', e.currentTarget.value)}
          onchange={(e) => setBox(prop, 'max', e.currentTarget.value, true)}
        />
      {:else if prop.kind === 'date'}
        <input
          type="date"
          aria-label="{prop.label} after"
          value={boxes(prop.key).min}
          onchange={(e) => setBox(prop, 'min', e.currentTarget.value, true)}
        />
        <span class="dash">–</span>
        <input
          type="date"
          aria-label="{prop.label} before"
          value={boxes(prop.key).max}
          onchange={(e) => setBox(prop, 'max', e.currentTarget.value, true)}
        />
      {:else if prop.kind === 'alpha'}
        <select
          class="alpha-select"
          aria-label="{prop.label} from"
          value={boxes(prop.key).min}
          onchange={(e) => setAlpha(prop, 'min', e.currentTarget.value)}
        >
          {#each ALPHA_OPTIONS as opt (opt.value)}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
        <span class="dash">–</span>
        <select
          class="alpha-select"
          aria-label="{prop.label} to"
          value={boxes(prop.key).max}
          onchange={(e) => setAlpha(prop, 'max', e.currentTarget.value)}
        >
          {#each ALPHA_OPTIONS as opt (opt.value)}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
      {:else if prop.kind === 'contains'}
        <input
          type="text"
          placeholder="contains…"
          aria-label="{prop.label} contains"
          value={boxes(prop.key).min}
          onchange={(e) => setContains(prop, e.currentTarget.value)}
        />
      {:else if prop.kind === 'colour'}
        <div class="colour-chips" role="group" aria-label="{prop.label} filter">
          {#each colourChipOptions(scopedColours, selectedColours(prop.key)) as chip (chip.colour)}
            <button
              class="colour-chip"
              class:on={selectedColours(prop.key).includes(chip.colour)}
              class:out-of-scope={!chip.inScope}
              aria-pressed={selectedColours(prop.key).includes(chip.colour)}
              title={chip.inScope
                ? (REKORDBOX_COLOURS[chip.colour] ?? chip.colour)
                : `${REKORDBOX_COLOURS[chip.colour] ?? chip.colour} — not in the selected playlists; click to remove`}
              onclick={() => toggleColour(prop, chip.colour)}
            >
              <span class="colour-swatch" style="background:{swatch(chip.colour)}"></span>
              {REKORDBOX_COLOURS[chip.colour] ?? chip.colour}
            </button>
          {/each}
        </div>
      {:else}
        <div class="ring-switch" role="group" aria-label="{prop.label} filter">
          {#each QUALITY_TOGGLES as q (q)}
            <button
              class:on={selectedQualities(prop.key).includes(q)}
              aria-pressed={selectedQualities(prop.key).includes(q)}
              onclick={() => toggleQuality(prop, q)}
            >
              {q}
            </button>
          {/each}
        </div>
      {/if}
      <button
        class="range-reset"
        title={prop.kind === 'number' || prop.kind === 'key'
          ? "Reset to the selection's range"
          : 'Clear this filter'}
        aria-label="Reset {prop.label} filter"
        onclick={() => resetRange(prop)}>↺</button
      >
    </div>
  {/snippet}

  {#each plainRows as prop (prop.key)}
    {@render filterRow(prop)}
  {/each}

  {#if analysisRows.length > 0}
    <!-- Not a <details> any more (v35.1): a second collapsible nested inside
         the Filters one looked like a peer of Playlists/Genres/Combo criteria
         and hid rows the user had just deliberately switched on. A hairline
         and a caption say "these four are different" without hiding them —
         the same break Starred/Constellation get below. -->
    {#if plainRows.length > 0}
      <div class="group-divider"></div>
    {/if}
    <div class="analysis-caption">
      Analysis
      <span class="caption-info">
        <InfoTooltip label="About the analysed values" align="right"
          >{ANALYSIS_GROUP_HINT}</InfoTooltip
        >
      </span>
    </div>
    {#each analysisRows as prop (prop.key)}
      {@render filterRow(prop)}
    {/each}
  {/if}

  {#if panelRows.length > 0 && rows.length > 0}
    <!-- A divider of its own, not a border on the first row below it (v27):
         a border sits inside that row's box, so the row was 1px taller than
         its three siblings and the space under the line could only be bought
         with padding, which made it taller still. Standalone, its equal
         margins put the same 12px above and below the line. -->
    <div class="group-divider"></div>
  {/if}
  {#each panelRows as m (m.key)}
    <div class="filter-row pseudo">
      <span class="filter-label">
        <PanelFilterIcon key={m.key} />{m.text}
      </span>
      {#if m.flag !== undefined}
        {@const flag = m.flag}
        <!-- Two-button segmented switch, exactly like the Keys row below —
             not a single morphing button (v18 #3/#8 review fix, B3): a
             single button showing "all" while pressed=false announces
             nothing useful, and its width jumps between the two labels. No
             ↺ reset either: clicking "all" IS the reset. -->
        <div class="ring-switch" role="group" aria-label="{m.aria} filter">
          <button
            class:on={!$filters.marks[flag]}
            aria-pressed={!$filters.marks[flag]}
            onclick={() => setMarkFilter(flag, false)}>all</button
          >
          <button
            class:on={$filters.marks[flag]}
            aria-pressed={$filters.marks[flag]}
            onclick={() => setMarkFilter(flag, true)}>only</button
          >
        </div>
      {:else}
        <div class="ring-switch" role="group" aria-label="{m.aria} filter">
          {#each RING_TOGGLES as choice (choice.key)}
            <button
              class:on={$filters.keyRings[choice.key]}
              aria-pressed={$filters.keyRings[choice.key]}
              onclick={() => toggleRing(choice.key)}
            >
              {choice.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</details>

<style>
  summary {
    cursor: pointer;
    color: var(--ink-secondary);
    font-weight: 600;
    margin-bottom: 8px;
  }

  .summary-count {
    color: var(--ink-muted);
    font-weight: 400;
    font-size: 12px;
    margin-left: 6px;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
  }

  .filter-label {
    width: 52px;
    flex-shrink: 0;
    color: var(--ink-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .filter-row input {
    width: 64px;
    min-width: 0;
    padding: 2px 6px;
  }

  /* F1/#10: number boxes are wide enough for a 4-digit year plus the hover
     spinner (macOS Chrome + Safari) without clipping. grow:0 stops them
     ballooning to fill the row (which read as too wide); the reset button
     right-aligns so it still hugs the row's edge. Shared by every numeric
     filter row (BPM, Rating, Energy, Year, …), not Year-specific, so all
     number boxes stay a uniform width. */
  .filter-row input[type='number'] {
    width: auto;
    flex: 0 1 64px;
    min-width: 58px;
    padding: 2px 2px 2px 6px;
    font-variant-numeric: tabular-nums;
  }

  .filter-row input[type='date'] {
    width: auto;
    flex: 1;
    min-width: 0;
  }

  .filter-row input[type='text'] {
    flex: 1;
  }

  .alpha-select {
    flex: 1 1 0;
    min-width: 0;
    padding: 2px 2px;
  }

  .colour-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }

  .colour-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    font-size: 11.5px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--ink-muted);
  }

  .colour-chip.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--ink);
  }

  /* v14.1 WS7: still selected (hence .on too) but no longer in the scoped
     playlists — dimmed + dashed so it reads as removable, not just active. */
  .colour-chip.out-of-scope {
    border-style: dashed;
    opacity: 0.6;
  }

  .colour-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
  }

  .dash {
    color: var(--ink-muted);
  }

  .range-reset {
    margin-left: auto;
    padding: 1px 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }

  .range-reset:hover {
    color: var(--ink);
  }

  .ring-switch {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .ring-switch button {
    padding: 2px 10px;
    font-size: 11.5px;
    background: none;
    border: none;
    border-radius: 0;
    color: var(--ink-muted);
  }

  .ring-switch button + button {
    border-left: 1px solid var(--border);
  }

  .ring-switch button.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--ink);
  }

  /* v23: the pseudo rows are wider-labelled than BPM/Year/Rating and carry no
     ↺, so they opt out of the 52px label column rather than widening it for
     everyone — at 250px the panel has ~12px of slack and the number boxes are
     already at their 52px min-width. The switch takes .range-reset's
     margin-left:auto instead, so all three right-align on the row's edge. */
  /* flex, not the inline flow the property rows use: the icon and the word
     are then two flex items with one exact `gap` between them (v27), instead
     of an inline box whose trailing space is whatever the glyph's advance
     width happened to leave over. align-items centres the icon against the
     text without any vertical-align/line-height tuning. */
  .filter-row.pseudo .filter-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: auto;
    overflow: visible;
    text-overflow: clip;
  }

  .filter-row.pseudo .ring-switch {
    margin-left: auto;
  }

  /* Deliberately NOT .micro-label: that class is the top-level
     Playlists/Filters/Genres/Combo criteria voice, and this caption sits one
     level down inside Filters, not beside them. Sentence case at a smaller
     size and muted colour reads as a subsection without borrowing a chrome
     idiom this panel uses nowhere else — it has only type and hairlines. */
  .analysis-caption {
    display: flex;
    align-items: center;
    padding: 2px 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-muted);
  }

  /* The ⓘ lands in the ↺ column, so the caption's right edge is the one
     every row below it already shares. */
  .caption-info {
    display: inline-flex;
    margin-left: auto;
  }

  /* v35.1: the descriptor labels keep the SAME 52px column as every other
     row — that shared left edge for the number boxes and the ↺ is the whole
     point of shortening "Danceability" to "D". Icon (14) + gap (5) + letter
     (~9) = 28px, so the column is no longer the binding constraint it was
     when it had to hold a full word. */
  .filter-label.descriptor {
    overflow: visible;
  }

  .descriptor-trigger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  /* The one rule dividing metadata ranges above from the marks/ring group
     below. --baseline is the intra-section divider token, shared by every
     sub-divider inside the left panel's dropdowns (a bit darker than
     --grid, which divides the dropdowns themselves); suppressed when
     nothing is above it. Equal margins (v27): with the rows' own 4px
     padding that reads as 12px of air on each side of the line — the same
     12px the Genres divider below the group already has above it, so the
     group sits symmetrically between the two. */
  .group-divider {
    border-top: 1px solid var(--baseline);
    margin: 8px 0;
  }
</style>
