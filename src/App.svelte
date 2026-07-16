<script lang="ts">
  import AdvancedMenu from './lib/AdvancedMenu.svelte'
  import CriteriaPanel from './lib/CriteriaPanel.svelte'
  import GenreMapView from './lib/GenreMapView.svelte'
  import { restoreAutosave, startAutosave } from './lib/persistence'
  import { startTheme } from './lib/theme'
  import TopBar from './lib/TopBar.svelte'
  import TracklistPanel from './lib/TracklistPanel.svelte'
  import TracksView from './lib/TracksView.svelte'
  import { redoOnce, startUndo, undoOnce } from './lib/undoStore'
  import WheelView from './lib/WheelView.svelte'
  import { library, rightPanel, viewMode } from './stores'

  restoreAutosave()
  startTheme()
  startAutosave()
  startUndo()

  // Cmd/Ctrl+Z undoes set edits and selection changes; +Shift redoes
  // (issue 2 — deliberately the only global shortcut). Text fields and open
  // dialogs keep their native behaviour.
  function onKeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    const target = e.target instanceof HTMLElement ? e.target : null
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
    if (document.querySelector('dialog[open]') !== null) return
    e.preventDefault()
    if (e.shiftKey) redoOnce()
    else undoOnce()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<TopBar />

<main>
  <CriteriaPanel />
  {#if $library.length === 0}
    <div class="empty">
      <h2>Your library as a web of combos</h2>
      <p>
        Import a Rekordbox collection XML or playlist TXT, a CSV, an M3U8 playlist, or tagged audio
        files — or load the sample library — to see your tracks on the Camelot wheel, with suggested
        combos as edges between them.
      </p>
      <p class="privacy">Everything stays in your browser. Nothing is uploaded.</p>
    </div>
  {:else if $viewMode === 'genres'}
    <GenreMapView />
  {:else if $viewMode === 'tracks'}
    <TracksView />
  {:else}
    <WheelView />
  {/if}
  <!-- The right aside: advanced settings swap in where the set lives, so the
       wheel stays visible while settings change (design-v5 §E). -->
  {#if $rightPanel === 'advanced'}
    <AdvancedMenu />
  {:else if $library.length > 0}
    <TracklistPanel />
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 20%;
    background: var(--surface);
    color: var(--ink-secondary);
  }

  .empty h2 {
    color: var(--ink);
  }

  .privacy {
    color: var(--ink-muted);
    font-size: 12px;
  }
</style>
