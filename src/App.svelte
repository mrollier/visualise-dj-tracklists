<script lang="ts">
  import CriteriaPanel from './lib/CriteriaPanel.svelte'
  import GenreMapView from './lib/GenreMapView.svelte'
  import { restoreAutosave, startAutosave } from './lib/persistence'
  import TopBar from './lib/TopBar.svelte'
  import TracklistPanel from './lib/TracklistPanel.svelte'
  import WheelView from './lib/WheelView.svelte'
  import { library, viewMode } from './stores'

  restoreAutosave()
  startAutosave()
</script>

<TopBar />

<main>
  <CriteriaPanel />
  {#if $library.length === 0}
    <div class="empty">
      <h2>Your library as a web of combos</h2>
      <p>
        Import a Rekordbox XML export, a CSV, or tagged audio files — or load the sample library —
        to see your tracks on the Camelot wheel, with suggested combos as edges between them.
      </p>
      <p class="privacy">Everything stays in your browser. Nothing is uploaded.</p>
    </div>
  {:else}
    {#if $viewMode === 'genres'}
      <GenreMapView />
    {:else}
      <WheelView />
    {/if}
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
