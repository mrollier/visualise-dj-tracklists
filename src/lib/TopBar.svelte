<script lang="ts">
  import { importCsv } from '../core/importers/csv'
  import { importRekordboxXml } from '../core/importers/rekordbox'
  import { SAMPLE_TRACKS } from '../data/sample-tracks'
  import {
    lastImportReport,
    library,
    libraryName,
    radialAxis,
    selectedId,
    tracklist,
  } from '../stores'

  let fileInput: HTMLInputElement

  async function onFileChosen(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const text = await file.text()
    const isXml = file.name.toLowerCase().endsWith('.xml') || text.trimStart().startsWith('<')
    const { tracks, report } = isXml ? importRekordboxXml(text) : importCsv(text)
    library.set(tracks)
    libraryName.set(file.name)
    lastImportReport.set(report)
    tracklist.set([])
    selectedId.set(null)
    fileInput.value = ''
  }

  function loadSample() {
    library.set(SAMPLE_TRACKS)
    libraryName.set('Sample library')
    lastImportReport.set(null)
    tracklist.set([])
    selectedId.set(null)
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

    <button onclick={() => fileInput.click()}>Import library…</button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".xml,.csv,.txt"
      hidden
      onchange={onFileChosen}
    />
    <button onclick={loadSample}>Load sample</button>
  </div>

  <div class="status">
    {#if $libraryName}
      <span>{$libraryName}</span>
    {/if}
    {#if $lastImportReport}
      <span class="report">
        {$lastImportReport.total} tracks imported{missingSummary ? ` — ${missingSummary}` : ''}
        {#if $lastImportReport.errors.length > 0}
          · {$lastImportReport.errors.length} skipped
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
</style>
