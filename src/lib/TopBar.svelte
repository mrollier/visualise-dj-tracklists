<script lang="ts">
  import { get } from 'svelte/store'
  import { AUDIO_EXTENSIONS } from '../core/audio/formats'
  import { importCsv } from '../core/importers/csv'
  import { trackFromTags } from '../core/importers/id3'
  import { importM3u, rematchAfterImport } from '../core/importers/m3u'
  import { importRekordboxXml } from '../core/importers/rekordbox'
  import { importRekordboxTxt, isRekordboxTxt } from '../core/importers/rekordboxTxt'
  import { computeGenreCoverage } from '../core/genre'
  import { buildReport, type ImportResult } from '../core/model'
  import { parseProject, serializeProject } from '../core/persist'
  import {
    colorAxis,
    lastImportReport,
    library,
    libraryName,
    linkArmed,
    radialAxis,
    rightPanel,
    selectedId,
    settings,
    tracklist,
    viewMode,
  } from '../stores'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import ResetDialog from './ResetDialog.svelte'
  import { promptExportName } from './exportName'
  import {
    applyProject,
    currentProject,
    loadSampleCollection,
    replaceLibrary,
    replaceNeedsConfirmation,
    sampleLoadNeedsConfirmation,
  } from './persistence'
  import { effectiveTheme, toggleTheme } from './theme'
  import { maybeStartTour, startTour } from './tour'

  let fileInput: HTMLInputElement
  let resetDialog: ResetDialog
  let replaceDialog: ConfirmDialog
  let loadProjectDialog: ConfirmDialog
  let tourConfirm: ConfirmDialog
  let importError = $state('')

  async function importAudioFiles(files: File[]): Promise<ImportResult> {
    const { parseBlob } = await import('music-metadata')
    const tracks = []
    const errors: string[] = []
    for (const [i, file] of files.entries()) {
      try {
        const meta = await parseBlob(file, { duration: false })
        tracks.push(
          trackFromTags(`id3-${i}`, file.name, {
            title: meta.common.title,
            artist: meta.common.artist,
            key: meta.common.key,
            bpm: meta.common.bpm,
            genre: meta.common.genre,
            year: meta.common.year,
            album: meta.common.album,
            durationSec: meta.format.duration,
          }),
        )
      } catch (e) {
        errors.push(`${file.name}: ${String(e)}`)
      }
    }
    return { tracks, report: buildReport(tracks, errors) }
  }

  async function onFileChosen(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    if (files.length === 0) return
    importError = ''
    try {
      const first = files[0]
      if (first.name.toLowerCase().endsWith('.json')) {
        // Loading a saved project replaces the library the same way the
        // sample collection does — it deserves the same confirmation, which
        // it never had before (silent overwrite).
        const project = parseProject(await first.text())
        const load = () => applyProject(project)
        if (replaceNeedsConfirmation()) loadProjectDialog.open(load)
        else load()
        return
      }
      if (first.name.toLowerCase().endsWith('.txt')) {
        const buffer = await first.arrayBuffer()
        if (isRekordboxTxt(buffer)) {
          // A Rekordbox playlist TXT carries full metadata in playlist order:
          // it becomes the library AND the set, plus a playlist named after
          // the file — toggled on, so the collection view shows immediately
          // (design-v6 §E).
          const result = importRekordboxTxt(buffer)
          if (result.tracks.length === 0) {
            // Nothing usable in the file: report it, keep the current library.
            lastImportReport.set(result.report)
            return
          }
          const playlistName = first.name.replace(/\.[^.]+$/, '')
          const trackIds = result.tracks.map((t) => t.id)
          replaceLibrary({
            tracks: result.tracks,
            name: first.name,
            set: trackIds,
            playlists: [{ name: playlistName, trackIds }],
            selectedPlaylists: [playlistName],
            report: result.report,
          })
          return
        }
        // A plain .txt falls through to the CSV importer below.
      }
      if (/\.m3u8?$/i.test(first.name)) {
        // Playlist import: becomes the set, matched against the loaded library.
        const result = importM3u(await first.text(), get(library))
        if (result.newTracks.length > 0) {
          library.update((tracks) => [...tracks, ...result.newTracks])
        }
        tracklist.set(result.tracklist)
        selectedId.set(null)
        lastImportReport.set(result.report)
        if (get(libraryName) === '') libraryName.set(first.name)
        return
      }
      const result = AUDIO_EXTENSIONS.test(first.name)
        ? await importAudioFiles(files.filter((f) => AUDIO_EXTENSIONS.test(f.name)))
        : await importTextFile(first)
      const { tracks, report } = result
      if (tracks.length === 0) {
        // Nothing usable in the file: report it, keep the current library.
        lastImportReport.set(report)
        return
      }
      // A collection import replaces the library, but a playlist imported
      // earlier keeps its order: bare M3U tracks are re-matched against the
      // fresh collection and pick up its metadata.
      const rematch = rematchAfterImport(get(library), get(tracklist), tracks)
      if (rematch.matched > 0) {
        report.notes = [
          ...(report.notes ?? []),
          `${rematch.matched} playlist track${rematch.matched === 1 ? '' : 's'} matched to the imported collection`,
        ]
      }
      replaceLibrary({
        tracks: rematch.library,
        name: files.length > 1 ? `${files.length} audio files` : first.name,
        set: rematch.tracklist,
        playlists: result.playlists,
        report,
      })
    } catch (e) {
      importError = e instanceof Error ? e.message : String(e)
    } finally {
      fileInput.value = ''
    }
  }

  async function importTextFile(file: File): Promise<ImportResult> {
    const text = await file.text()
    const isXml = file.name.toLowerCase().endsWith('.xml') || text.trimStart().startsWith('<')
    return isXml ? importRekordboxXml(text) : importCsv(text)
  }

  function saveProject() {
    const filename = promptExportName('dj-tracklists-project', '.json')
    if (filename === null) return
    const url = URL.createObjectURL(
      new Blob([serializeProject(currentProject())], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // One sample collection (design-v6 §D): all packs as playlists in a single
  // library, loaded like an XML import. Confirms once over user work, via
  // the in-app dialog (issue 6) — including work sitting on top of an
  // already-loaded sample, which used to rewipe silently (v18 #1).
  function loadSample() {
    const load = () => {
      loadSampleCollection()
      maybeStartTour() // first-ever sample load opens the guided tour (WS12)
    }
    if (sampleLoadNeedsConfirmation()) replaceDialog.open(load)
    else load()
  }

  const missingSummary = $derived.by(() => {
    const report = $lastImportReport
    if (!report) return null
    const parts = Object.entries(report.missing)
      .filter(([, count]) => count > 0)
      .map(([field, count]) => `${count}× ${field}`)
    return parts.length > 0 ? `missing: ${parts.join(', ')}` : null
  })

  // Genre-coverage diagnosis (v12 WS6 — science doc P1): how much of the
  // library the similarity data reaches, always current, not just at import.
  const genreCoverage = $derived($library.length > 0 ? computeGenreCoverage($library) : null)
  const coverageSummary = $derived.by(() => {
    const cov = genreCoverage
    if (cov === null || cov.outside === 0) return null
    const top = cov.top
      .slice(0, 3)
      .map(({ label, count }) => `${label} ×${count}`)
      .join(', ')
    const invisible = cov.invisible > 0 ? ` (${cov.invisible} of them match nothing at all)` : ''
    return `${cov.outside} of ${cov.tagged} tagged tracks have genres outside the similarity data${invisible} — top: ${top}`
  })

  // Easy mode (v12 WS4; computation v14 WS6/E1): one hard toggle — entering
  // easy switches computation onto sensible defaults via the effective-store
  // layer, not just hiding controls. It also puts the set panel back — the
  // advanced panel it would orphan is hidden.
  const easy = $derived($settings.uiMode === 'easy')
  function toggleUiMode() {
    const entering = !easy
    settings.update((s) => ({ ...s, uiMode: entering ? 'easy' : 'advanced' }))
    if (entering) {
      rightPanel.set('set')
      // Link mode is an advanced affordance and its 🔗 button vanishes in easy
      // (v14 WS6): disarm it so a wheel click can't silently toggle an edge.
      linkArmed.set(false)
    }
  }
</script>

<header>
  <h1>Zodiac Tracker</h1>

  <div class="controls">
    <!-- Easy mode hides these wheel-only controls but KEEPS their layout box
         (visibility, not removal) so the surviving buttons never slide — the
         empty gap signals "options fell away" (ISSUES.md #5). -->
    <div
      class="view-switch"
      class:easy-hidden={easy}
      data-tour="views"
      role="group"
      aria-label="Central view"
    >
      <button
        class:active={$viewMode === 'wheel'}
        onclick={() => viewMode.set('wheel')}
        disabled={$library.length === 0}>Wheel</button
      >
      <button
        class:active={$viewMode === 'genres'}
        onclick={() => viewMode.set('genres')}
        disabled={$library.length === 0}>Genres</button
      >
      <button
        class:active={$viewMode === 'tracks'}
        onclick={() => viewMode.set('tracks')}
        disabled={$library.length === 0}>Tracks</button
      >
    </div>

    <!-- Radius/Colour only mean something on the wheel (issue 4): off-wheel
       they DIM but stay adjustable (v11 issue 13). Without a library they
       act on nothing and disable outright — a different rule that stays. -->
    <label
      class:off-view={$viewMode !== 'wheel' || $library.length === 0}
      class:easy-hidden={easy}
      title="Only affects the Wheel view"
    >
      Radius
      <select bind:value={$radialAxis} disabled={$library.length === 0}>
        <option value="bpm">BPM</option>
        <option value="rating">Rating</option>
        <option value="year">Year</option>
        <option value="energy">Energy</option>
      </select>
    </label>

    <label
      class:off-view={$viewMode !== 'wheel' || $library.length === 0}
      class:easy-hidden={easy}
      title="Only affects the Wheel view"
    >
      Colour
      <select bind:value={$colorAxis} disabled={$library.length === 0}>
        <option value="auto">Auto</option>
        <option value="rating">Rating</option>
        <option value="bpm">BPM</option>
        <option value="year">Year</option>
        <option value="energy">Energy</option>
      </select>
    </label>

    <!-- The sample's own info icon moved to the status ⓘ (v11 issue 4):
         loading raises an import report like any other import. -->
    <button onclick={loadSample} title="Load the sample collection (all themed packs as playlists)"
      >Load sample</button
    >
    <!-- A .json here is a saved project (auto-detected in onFileChosen), not
         a fresh library import — the label says so and the button sits next
         to Save so the pair reads as one load/save unit (ISSUES.md). -->
    <button
      onclick={() => fileInput.click()}
      title="Import a library (XML/CSV/TXT/M3U/audio files), or load a previously saved project (.json)"
      >Import / load project…</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept=".xml,.csv,.txt,.json,.m3u,.m3u8,.mp3,.wav,.flac,.aif,.aiff,.m4a,.ogg"
      multiple
      hidden
      onchange={onFileChosen}
    />
    <button onclick={saveProject} disabled={$library.length === 0}>Save project</button>
    <button
      class="advanced-toggle"
      class:easy-hidden={easy}
      aria-pressed={$rightPanel === 'advanced'}
      class:active={$rightPanel === 'advanced'}
      title="Advanced options"
      onclick={() => rightPanel.update((p) => (p === 'advanced' ? 'set' : 'advanced'))}
    >
      ⚙ Advanced
    </button>
    <!-- Easy mode (v12 WS4; computation v14 WS6/E1): a hard toggle — easy
         shows the wheel, Playlists, ✨ and the set; everything else hides AND
         computes on sensible defaults instead of its current values. -->
    <button
      class="mode-toggle"
      data-tour="easy"
      aria-pressed={easy}
      class:active={easy}
      title={easy
        ? 'Back to the full interface — everything is where you left it'
        : 'Run on sensible defaults; keep the wheel and your constellation'}
      onclick={toggleUiMode}
    >
      {easy ? 'All controls' : 'Easy mode'}
    </button>
    <button
      class="theme-toggle"
      title={$effectiveTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={$effectiveTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onclick={toggleTheme}
    >
      {$effectiveTheme === 'dark' ? '☀' : '☾'}
    </button>
    <button class="danger" onclick={() => resetDialog.open()} disabled={$library.length === 0}
      >Reset</button
    >
    <ResetDialog bind:this={resetDialog} />
    <ConfirmDialog
      bind:this={replaceDialog}
      title="Replace your library?"
      body="Loading the sample collection replaces the current library and clears your constellations, ★ marks and manual combos. Save the project first if you want to keep them."
      confirmLabel="Replace and load"
      danger
    />
    <ConfirmDialog
      bind:this={loadProjectDialog}
      title="Load this project?"
      body="Loading a saved project replaces your current library, constellations, filters, criteria and manual combos. Save the current project first if you want to keep it."
      confirmLabel="Load and replace"
      danger
    />
    <ConfirmDialog
      bind:this={tourConfirm}
      title="Replay the guided tour?"
      body="Replaying the tour swaps in the demo collection and resets criteria, filters and view to the walkthrough defaults. Save the project first if you want to keep your current library and sets."
      confirmLabel="Start tour"
      danger
    />
  </div>

  <!-- Just the collection name; the import details live behind the ⓘ icon
       (hover or focus it) so the header stays uncrowded (ISSUES.md #7/#13). -->
  <div class="status">
    {#if importError}
      <span class="error">{importError}</span>
    {/if}
    {#if $libraryName}
      <span class="name">{$libraryName}</span>
    {/if}
    {#if $lastImportReport}
      <InfoTooltip label="Import details" align="right">
        <span><strong>{$lastImportReport.total} tracks imported</strong></span>
        {#if missingSummary}
          <span>{missingSummary}</span>
        {/if}
        {#if $lastImportReport.errors.length > 0}
          <span>{$lastImportReport.errors.length} skipped</span>
        {/if}
        {#each $lastImportReport.notes ?? [] as note (note)}
          <span>{note}</span>
        {/each}
        {#if coverageSummary}
          <span>{coverageSummary}</span>
        {/if}
        <button
          class="tour-link"
          onclick={() =>
            sampleLoadNeedsConfirmation() ? tourConfirm.open(startTour) : startTour()}
          >Show the guided tour</button
        >
      </InfoTooltip>
    {/if}
  </div>
</header>

<style>
  /* The header may wrap on narrow windows, and the flexible pieces shrink
     with ellipsis — the view switch must never clip (ISSUES.md #13). */
  header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--page);
  }

  h1 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: 0.2px;
  }

  .view-switch {
    display: inline-flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .view-switch button {
    border: none;
    border-radius: 0;
    padding: 4px 10px;
    white-space: nowrap;
  }

  .view-switch button.active {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  /* Easy mode hides the wheel-only controls but keeps their layout box, so
     the surviving buttons hold their position (ISSUES.md #5). visibility
     already removes them from tab order and the a11y tree. */
  .easy-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* The mode toggle's label flips between "Easy mode" (83px) and "All
     controls" (85px); a fixed min-width keeps the theme + Reset buttons after
     it from shifting when it changes (ISSUES.md #5). */
  .mode-toggle {
    min-width: 92px;
    text-align: center;
  }

  .advanced-toggle.active,
  .mode-toggle.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .tour-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: inherit;
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }

  .controls label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .controls label.off-view {
    color: var(--ink-muted);
    opacity: 0.6;
  }

  .status {
    margin-left: auto;
    color: var(--ink-muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .status .name {
    color: var(--ink-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status .error {
    color: var(--walk-bright);
  }

  /* The import-report popover converted to the shared InfoTooltip (v11
     issues 3+6) — its hand-rolled twin CSS is gone with it. */
</style>
