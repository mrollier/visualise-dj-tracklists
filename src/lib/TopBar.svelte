<script lang="ts">
  import { get } from 'svelte/store'
  import { importCsv } from '../core/importers/csv'
  import { trackFromTags } from '../core/importers/id3'
  import { importM3u, rematchAfterImport } from '../core/importers/m3u'
  import { importRekordboxXml } from '../core/importers/rekordbox'
  import { buildReport, type ImportResult } from '../core/model'
  import { parseProject, serializeProject } from '../core/persist'
  import { SAMPLE_TRACKS } from '../data/sample-tracks'
  import {
    colorAxis,
    lastImportReport,
    library,
    libraryName,
    radialAxis,
    resetSuggestions,
    selectedId,
    tracklist,
  } from '../stores'
  import AdvancedMenu from './AdvancedMenu.svelte'
  import ResetDialog from './ResetDialog.svelte'
  import { applyProject, currentProject } from './persistence'

  const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff?|m4a|ogg)$/i

  let fileInput: HTMLInputElement
  let resetDialog: ResetDialog
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
        applyProject(parseProject(await first.text()))
        lastImportReport.set(null)
        return
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
      const { tracks, report } = AUDIO_EXTENSIONS.test(first.name)
        ? await importAudioFiles(files.filter((f) => AUDIO_EXTENSIONS.test(f.name)))
        : await importTextFile(first)
      // A collection import replaces the library, but a playlist imported
      // earlier keeps its order: bare M3U tracks are re-matched against the
      // fresh collection and pick up its metadata.
      const rematch = rematchAfterImport(get(library), get(tracklist), tracks)
      library.set(rematch.library)
      libraryName.set(files.length > 1 ? `${files.length} audio files` : first.name)
      if (rematch.matched > 0) {
        report.notes = [
          ...(report.notes ?? []),
          `${rematch.matched} playlist track${rematch.matched === 1 ? '' : 's'} matched to the imported collection`,
        ]
      }
      lastImportReport.set(report)
      tracklist.set(rematch.tracklist)
      selectedId.set(null)
      resetSuggestions()
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
    const url = URL.createObjectURL(
      new Blob([serializeProject(currentProject())], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'dj-tracklists-project.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function loadSample() {
    library.set(SAMPLE_TRACKS)
    libraryName.set('Sample library')
    lastImportReport.set(null)
    tracklist.set([])
    selectedId.set(null)
    resetSuggestions()
  }

  const missingSummary = $derived.by(() => {
    const report = $lastImportReport
    if (!report) return null
    const parts = Object.entries(report.missing)
      .filter(([, count]) => count > 0)
      .map(([field, count]) => `${count}× ${field}`)
    return parts.length > 0 ? `missing: ${parts.join(', ')}` : null
  })
</script>

<header>
  <h1>visualise-dj-tracklists</h1>

  <div class="controls">
    <label>
      Radius
      <select bind:value={$radialAxis}>
        <option value="bpm">BPM</option>
        <option value="rating">Rating</option>
        <option value="year">Year</option>
      </select>
    </label>

    <label>
      Colour
      <select bind:value={$colorAxis}>
        <option value="auto">Auto</option>
        <option value="rating">Rating</option>
        <option value="bpm">BPM</option>
        <option value="year">Year</option>
      </select>
    </label>

    <button onclick={() => fileInput.click()}>Import…</button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".xml,.csv,.txt,.json,.m3u,.m3u8,.mp3,.wav,.flac,.aif,.aiff,.m4a,.ogg"
      multiple
      hidden
      onchange={onFileChosen}
    />
    <button onclick={loadSample}>Load sample</button>
    <button onclick={saveProject} disabled={$library.length === 0}>Save project</button>
    <AdvancedMenu />
    <button class="danger" onclick={() => resetDialog.open()}>Reset</button>
    <ResetDialog bind:this={resetDialog} />
  </div>

  <div class="status">
    {#if importError}
      <span class="error">{importError}</span>
    {/if}
    {#if $libraryName}
      <span>{$libraryName}</span>
    {/if}
    {#if $lastImportReport}
      <span class="report">
        {$lastImportReport.total} tracks imported{missingSummary ? ` — ${missingSummary}` : ''}
        {#if $lastImportReport.errors.length > 0}
          · {$lastImportReport.errors.length} skipped
        {/if}
        {#if $lastImportReport.notes?.length}
          · {$lastImportReport.notes.join(' · ')}
        {/if}
      </span>
    {/if}
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 18px;
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

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .controls label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status {
    margin-left: auto;
    color: var(--ink-muted);
    font-size: 12px;
    display: flex;
    gap: 10px;
  }

  .status .report {
    color: var(--ink-secondary);
  }

  .status .error {
    color: var(--walk-bright);
  }
</style>
