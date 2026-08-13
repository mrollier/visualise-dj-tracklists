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
  import { isMarkFilterKey } from '../core/marks'
  import { PROPERTY_BY_KEY, REKORDBOX_COLOURS, type TrackProperty } from '../core/properties'
  import type { TrackSortField } from '../core/trackSort'
  import { filters, library, playlistScopedLibrary, settings, visibleLibrary } from '../stores'

  type RangeSide = 'min' | 'max'

  // Alpha buckets A…Z then '#' (v14 WS2): options for the min/max selects.
  const ALPHA_OPTIONS = Array.from({ length: ALPHA_CATCH_ALL + 1 }, (_, i) => ({
    value: i,
    label: alphaBucketLabel(i),
  }))

  // The rows on show: the user's visibleFilters selection (advanced "Track
  // properties" table), resolved through the registry (v11 issue 1). Since
  // v18 (#3/#8) visibleFilters can also carry the 'starred'/'combos' marks
  // pseudo-keys; this section only renders property rows, so they are
  // skipped here (their own row is a separate control, outside this task).
  const rows = $derived(
    $settings.visibleFilters
      .filter((key): key is TrackSortField => !isMarkFilterKey(key))
      .map((key) => PROPERTY_BY_KEY.get(key))
      .filter((p): p is TrackProperty => p !== undefined && p.filterable),
  )

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

  // A filter made visible after load has no input entry yet — seed it
  // lazily so the row opens showing the saved filter or the scoped extent.
  $effect(() => {
    const active = get(filters)
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
      // An emptied side falls back to the selection extreme (keeps JSON-safe
      // finite bounds); key ranges fall back to the full 1–12 wheel.
      const extent = scopedExtents[prop.key] ?? (prop.kind === 'key' ? [1, 12] : null)
      const range = clampRange(
        [
          min === '' ? (extent?.[0] ?? 0) : Number(min),
          max === '' ? (extent?.[1] ?? 9999) : Number(max),
        ],
        edited,
      )
      if (reflect) inputs[prop.key] = { min: String(range[0]), max: String(range[1]) }
      writeProperty(prop.key, range)
    } else if (prop.kind === 'date') {
      writeProperty(prop.key, [min === '' ? DATE_OPEN_MIN : min, max === '' ? DATE_OPEN_MAX : max])
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

  {#each rows as prop (prop.key)}
    <div class="filter-row">
      <span class="filter-label">{prop.key === 'dateAdded' ? 'Added' : prop.label}</span>
      {#if prop.kind === 'number' || prop.kind === 'key'}
        <input
          type="number"
          placeholder="min"
          min={prop.kind === 'key' ? '1' : '0'}
          max={boxes(prop.key).max === ''
            ? prop.kind === 'key'
              ? '12'
              : prop.key === 'rating'
                ? '5'
                : undefined
            : boxes(prop.key).max}
          value={boxes(prop.key).min}
          oninput={(e) => setBox(prop, 'min', e.currentTarget.value)}
          onchange={(e) => setBox(prop, 'min', e.currentTarget.value, true)}
        />
        <span class="dash">–</span>
        <input
          type="number"
          placeholder="max"
          min={boxes(prop.key).min === '' ? (prop.kind === 'key' ? '1' : '0') : boxes(prop.key).min}
          max={prop.kind === 'key' ? '12' : prop.key === 'rating' ? '5' : undefined}
          value={boxes(prop.key).max}
          oninput={(e) => setBox(prop, 'max', e.currentTarget.value)}
          onchange={(e) => setBox(prop, 'max', e.currentTarget.value, true)}
        />
      {:else if prop.kind === 'date'}
        <input
          type="date"
          aria-label="{prop.label} after"
          value={boxes(prop.key).min}
          onchange={(e) => setBox(prop, 'min', e.currentTarget.value)}
        />
        <span class="dash">–</span>
        <input
          type="date"
          aria-label="{prop.label} before"
          value={boxes(prop.key).max}
          onchange={(e) => setBox(prop, 'max', e.currentTarget.value)}
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
  {/each}

  <div class="filter-row">
    <span class="filter-label">Keys</span>
    <div class="ring-switch" role="group" aria-label="Show keys">
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
  </div>
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

  /* F1/#10: number boxes are a fixed 58px — enough for a 4-digit year and the
     hover spinner (macOS Chrome + Safari), but no wider. grow:0 stops them
     ballooning to fill the row (which read as too wide); the reset button
     right-aligns so it still hugs the row's edge. */
  .filter-row input[type='number'] {
    width: auto;
    flex: 0 1 58px;
    min-width: 52px;
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
</style>
