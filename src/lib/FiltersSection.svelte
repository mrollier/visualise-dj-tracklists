<script lang="ts">
  import { get } from 'svelte/store'
  import {
    clampRange,
    propertyExtents,
    wholeExtent,
    type LibraryFilters,
    type PropertyRange,
  } from '../core/filter'
  import { PROPERTY_BY_KEY, type TrackProperty } from '../core/properties'
  import type { TrackSortField } from '../core/trackSort'
  import { filters, library, playlistScopedLibrary, settings, visibleLibrary } from '../stores'

  type RangeSide = 'min' | 'max'

  // The rows on show: the user's visibleFilters selection (advanced "Track
  // properties" table), resolved through the registry (v11 issue 1).
  const rows = $derived(
    $settings.visibleFilters
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
        seeded === undefined || seeded === null
          ? { min: '', max: '' }
          : { min: String(seeded[0]), max: String(seeded[1]) }
    } else if (prop.kind === 'date') {
      inputs[prop.key] = {
        min: range === undefined || range[0] === DATE_OPEN_MIN ? '' : String(range[0]),
        max: range === undefined || range[1] === DATE_OPEN_MAX ? '' : String(range[1]),
      }
    } else {
      inputs[prop.key] =
        range === undefined
          ? { min: '', max: '' }
          : { min: String(range[0]), max: String(range[1]) }
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
    } else {
      // Text: lowercased prefix bounds; an empty side stays open, so only
      // clamp when both sides are present.
      let low = min.trim().toLowerCase()
      let high = max.trim().toLowerCase()
      if (low !== '' && high !== '') {
        ;[low, high] = clampRange([low, high], edited)
        if (reflect) inputs[prop.key] = { min: low, max: high }
      }
      writeProperty(prop.key, low === '' && high === '' ? null : [low, high])
    }
  }

  /** Reset: numeric ranges to the selection's whole-number extremes; text
   *  and date rows to blank (off). */
  function resetRange(prop: TrackProperty): void {
    if (prop.kind === 'number' || prop.kind === 'key') {
      const range = whole(scopedExtents[prop.key] ?? null)
      inputs[prop.key] =
        range === null ? { min: '', max: '' } : { min: String(range[0]), max: String(range[1]) }
      writeProperty(prop.key, range)
    } else {
      inputs[prop.key] = { min: '', max: '' }
      writeProperty(prop.key, null)
    }
  }

  // The minor/major ring switch (issue 6): semantically always a filter
  // (v8 issue 10) — since v9 its control finally lives here too.
  const RING_CHOICES = [
    { value: 'both', label: 'both' },
    { value: 'minor', label: 'minor' },
    { value: 'major', label: 'major' },
  ] as const
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
      {:else}
        <input
          type="text"
          placeholder="from"
          aria-label="{prop.label} from"
          value={boxes(prop.key).min}
          onchange={(e) => setBox(prop, 'min', e.currentTarget.value, true)}
        />
        <span class="dash">–</span>
        <input
          type="text"
          placeholder="to"
          aria-label="{prop.label} to"
          value={boxes(prop.key).max}
          onchange={(e) => setBox(prop, 'max', e.currentTarget.value, true)}
        />
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
      {#each RING_CHOICES as choice (choice.value)}
        <button
          class:on={$filters.keyRing === choice.value}
          aria-pressed={$filters.keyRing === choice.value}
          onclick={() => filters.update((f) => ({ ...f, keyRing: choice.value }))}
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
    gap: 6px;
    padding: 4px 0;
  }

  .filter-label {
    width: 64px;
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

  .filter-row input[type='date'] {
    width: auto;
    flex: 1;
    min-width: 0;
  }

  .filter-row input[type='text'] {
    flex: 1;
  }

  .dash {
    color: var(--ink-muted);
  }

  .range-reset {
    padding: 1px 6px;
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
