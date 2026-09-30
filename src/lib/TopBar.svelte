<script lang="ts">
  import { get } from 'svelte/store'
  import { AUDIO_EXTENSIONS } from '../core/audio/formats'
  import { importCsv } from '../core/importers/csv'
  import { trackFromTags } from '../core/importers/id3'
  import { importM3u } from '../core/importers/m3u'
  import { importRekordboxXml } from '../core/importers/rekordbox'
  import { importRekordboxTxt, isRekordboxTxt } from '../core/importers/rekordboxTxt'
  import { computeGenreCoverage } from '../core/genre'
  import { mergeSidecars, sanitizeAnalysis, summariseAnalysisImport } from '../core/analysis'
  import { fileStem } from '../core/exporters/filename'
  import {
    buildReport,
    type ImportReport,
    type ImportResult,
    type Playlist,
    type Track,
  } from '../core/model'
  import { sanitizeProject } from '../core/persist'
  import {
    analysis,
    autosaveError,
    colorAxis,
    importStatus,
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
  import { yieldToPaint } from './audio/sourceStore'
  import { autosaveBlocked, takeOverAutosave, unreadableAutosave } from './autosave'
  import { downloadBlob } from './saveFile'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import ProgressBar from './ProgressBar.svelte'
  import ResetDialog from './ResetDialog.svelte'
  import {
    applyProject,
    loadSampleCollection,
    planLibraryImport,
    replaceLibrary,
    replaceNeedsConfirmation,
    sampleLoadNeedsConfirmation,
    saveProject,
    updateLibrary,
  } from './persistence'
  import { effectiveTheme, toggleTheme } from './theme'
  import { maybeStartTour, startTour } from './tour'

  let fileInput: HTMLInputElement
  let resetDialog: ResetDialog
  let replaceDialog: ConfirmDialog
  let loadProjectDialog: ConfirmDialog
  let tourConfirm: ConfirmDialog
  let importDialog: ConfirmDialog
  let importCopy = $state({ title: '', body: '', confirmLabel: '' })
  let importError = $state('')

  /**
   * A collection import over the loaded library: an update in place when it
   * is the same collection again (sets, marks and combos carry across), a
   * replacement when the library is disposable or a different collection —
   * and a confirmation first whenever work would be lost.
   */
  function applyImport(
    incoming: {
      tracks: Track[]
      name: string
      playlists: Playlist[]
      set?: string[]
      selectedPlaylists?: string[]
    },
    report: ImportReport,
  ) {
    const plan = planLibraryImport(incoming.tracks, incoming.playlists)
    const replace = () => replaceLibrary({ ...incoming, report })
    const update = () => updateLibrary(incoming, plan, report)
    if (plan.decision === 'replace') return replace()
    if (plan.decision === 'update') return update()
    if (plan.decision === 'confirm-replace') {
      const percent = Math.round(plan.diff.overlap * 100)
      importCopy = {
        title: 'Replace your library?',
        body: `${incoming.name} shares ${percent}% of the tracks in the library that is loaded, so it looks like a different collection. Replacing starts over: your constellations, ★ marks and 🔗 combos are cleared. Save the project first if you want to keep them.`,
        confirmLabel: 'Replace library',
      }
      importDialog.open(replace)
      return
    }
    const { titles } = plan.remapped.lost
    const more = titles.length > 5 ? `, and ${titles.length - 5} more` : ''
    importCopy = {
      title: 'Update your library?',
      body: `${titles.length} ${titles.length === 1 ? 'track' : 'tracks'} your constellations, ★ marks or 🔗 combos use ${titles.length === 1 ? 'is' : 'are'} not in ${incoming.name}: ${titles.slice(0, 5).join(', ')}${more}. Updating removes them from your work; everything else is kept.`,
      confirmLabel: 'Update library',
    }
    importDialog.open(update)
  }

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
      importStatus.set(`Reading ${first.name}…`)
      if (first.name.toLowerCase().endsWith('.json')) {
        let parsed: unknown
        try {
          parsed = JSON.parse(await first.text())
        } catch {
          throw new Error(`${first.name} is not a project or analysis file: it is not valid JSON`)
        }
        // An analysis sidecar is a .json too, and the project parser would
        // throw on it — so the discriminator is checked first. A sidecar ADDS
        // a layer rather than replacing the library, so it raises no
        // confirmation: there is nothing to overwrite and nothing to lose.
        const sidecar = sanitizeAnalysis(parsed)
        if (sidecar !== null) {
          const summary = summariseAnalysisImport(get(library), sidecar)
          // Union, not replace: a playlist-scoped run must add to a
          // whole-library sidecar, never discard it.
          analysis.update((prev) => mergeSidecars(prev, sidecar))
          lastImportReport.set({
            ...buildReport(get(library), []),
            notes: [summary.note],
          })
          return
        }
        // Loading a saved project replaces the library the same way the
        // sample collection does — it deserves the same confirmation, which
        // it never had before (silent overwrite).
        const project = sanitizeProject(parsed)
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
          // the file — toggled on, so the collection view shows immediately.
          const result = importRekordboxTxt(buffer)
          if (result.tracks.length === 0) {
            // Nothing usable in the file: report it, keep the current library.
            lastImportReport.set(result.report)
            return
          }
          const playlistName = fileStem(first.name)
          const trackIds = result.tracks.map((t) => t.id)
          applyImport(
            {
              tracks: result.tracks,
              name: first.name,
              set: trackIds,
              playlists: [{ name: playlistName, trackIds }],
              selectedPlaylists: [playlistName],
            },
            result.report,
          )
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
      importStatus.set('Computing wheel…')
      await yieldToPaint()
      applyImport(
        {
          tracks,
          name: files.length > 1 ? `${files.length} audio files` : first.name,
          playlists: result.playlists ?? [],
        },
        report,
      )
    } catch (e) {
      importError = e instanceof Error ? e.message : String(e)
    } finally {
      importStatus.set(null)
      fileInput.value = ''
    }
  }

  async function importTextFile(file: File): Promise<ImportResult> {
    const text = await file.text()
    const isXml = file.name.toLowerCase().endsWith('.xml') || text.trimStart().startsWith('<')
    // The parse is one synchronous call that can block for seconds on a big
    // collection — paint the label first, so the user sees WHAT is blocking.
    importStatus.set(`Parsing ${file.name}…`)
    await yieldToPaint()
    return isXml ? importRekordboxXml(text) : importCsv(text)
  }

  // One sample collection: all packs as playlists in a single
  // library, loaded like an XML import. Confirms once over user work, via
  // the in-app dialog — including work sitting on top of an
  // already-loaded sample, which would otherwise rewipe silently.
  function loadSample() {
    const load = () => {
      loadSampleCollection()
      maybeStartTour() // first-ever sample load opens the guided tour
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

  // Genre-coverage diagnosis (science doc P1): how much of the
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

  // Easy mode: one hard toggle — entering
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
      // mode: disarm it so a wheel click can't silently toggle an edge.
      linkArmed.set(false)
    }
  }
</script>

<header>
  <h1>Zodiac Tracker</h1>

  <div class="controls">
    <!-- Easy mode hides these wheel-only controls but KEEPS their layout box
         (visibility, not removal) so the surviving buttons never slide — the
         empty gap signals "options fell away". -->
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

    <!-- Radius/Colour only mean something on the wheel: off-wheel
       they DIM but stay adjustable. Without a library they
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

    <!-- The sample's own info icon moved to the status ⓘ:
         loading raises an import report like any other import. -->
    <button
      onclick={loadSample}
      disabled={$importStatus !== null}
      title="Load the sample collection (all themed packs as playlists)">Load sample</button
    >
    <!-- A .json here is a saved project (auto-detected in onFileChosen), not
         a fresh library import — the label says so and the button sits next
         to Save so the pair reads as one load/save unit. -->
    <button
      onclick={() => fileInput.click()}
      disabled={$importStatus !== null}
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
    <button
      onclick={() => void saveProject()}
      disabled={$library.length === 0}
      title="Save the whole project as a file (⌘S)">Save project</button
    >
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
    <!-- Easy mode: a hard toggle — easy
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
      bind:this={importDialog}
      title={importCopy.title}
      body={importCopy.body}
      confirmLabel={importCopy.confirmLabel}
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
       (hover or focus it) so the header stays uncrowded. -->
  <div class="status">
    {#if $importStatus}
      <span class="busy" role="status">{$importStatus}</span>
      <ProgressBar label={$importStatus} width="110px" />
    {/if}
    {#if importError}
      <span class="error">{importError}</span>
    {/if}
    <!-- Autosave must never fail silently: the loss would only show on the
         next reload, long after the cause. -->
    {#if $autosaveBlocked}
      <span class="error" role="status">
        Open in another tab — changes here are not saved.
        <button class="inline" onclick={() => void takeOverAutosave()}>Use this tab</button>
      </span>
    {:else if $autosaveError}
      <span class="error" role="status">
        {$autosaveError}
        {#if $unreadableAutosave !== null}
          <button
            class="inline"
            onclick={() =>
              downloadBlob(
                new Blob([$unreadableAutosave ?? ''], { type: 'application/json' }),
                'Unreadable autosave.json',
              )}>Download it</button
          >
        {/if}
      </span>
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
     with ellipsis — the view switch must never clip. */
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
     the surviving buttons hold their position. visibility
     already removes them from tab order and the a11y tree. */
  .easy-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* The mode toggle's label flips between "Easy mode" (83px) and "All
     controls" (85px); a fixed min-width keeps the theme + Reset buttons after
     it from shifting when it changes. */
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

  .status .error .inline {
    margin-left: 6px;
    padding: 1px 8px;
    font-size: 11px;
  }

  .status .busy {
    white-space: nowrap;
  }
</style>
