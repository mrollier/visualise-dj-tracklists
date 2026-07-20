<script lang="ts">
  import AdvancedMenu from './lib/AdvancedMenu.svelte'
  import CriteriaPanel from './lib/CriteriaPanel.svelte'
  import GenreMapView from './lib/GenreMapView.svelte'
  import { restoreAutosave, startAutosave } from './lib/persistence'
  import SelectedTrackCard from './lib/SelectedTrackCard.svelte'
  import { startTheme } from './lib/theme'
  import TopBar from './lib/TopBar.svelte'
  import TourOverlay from './lib/TourOverlay.svelte'
  import TracklistPanel from './lib/TracklistPanel.svelte'
  import TracksView from './lib/TracksView.svelte'
  import { redoOnce, startUndo, undoOnce } from './lib/undoStore'
  import WheelView from './lib/WheelView.svelte'
  import { library, rightPanel, settings, suggestHotkeyTick, viewMode } from './stores'

  // Easy mode (v12 WS4) is visibility-only: the stored viewMode survives
  // untouched, the centre just always shows the wheel while easy is on.
  const effectiveView = $derived($settings.uiMode === 'easy' ? 'wheel' : $viewMode)

  restoreAutosave()
  startTheme()
  startAutosave()
  startUndo()

  // The deliberately small hotkey set (issue 2; v12 WS14, ISSUES.md stub):
  // Cmd/Ctrl+Z undoes set edits, selection AND settings changes (+Shift
  // redoes); plain 1/2/3 switch the central view; plain s runs ✨. Text
  // fields and open dialogs keep their native behaviour.
  function onKeydown(e: KeyboardEvent) {
    const target = e.target instanceof HTMLElement ? e.target : null
    const inField = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
    if (inField || document.querySelector('dialog[open]') !== null) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redoOnce()
      else undoOnce()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey || $library.length === 0) return
    // View digits stay inert in easy mode — the switch they mirror is hidden.
    if ($settings.uiMode !== 'easy') {
      if (e.key === '1') viewMode.set('wheel')
      if (e.key === '2') viewMode.set('genres')
      if (e.key === '3') viewMode.set('tracks')
    }
    if (e.key.toLowerCase() === 's') suggestHotkeyTick.update((t) => t + 1)
  }
</script>

<svelte:window onkeydown={onKeydown} />

<TopBar />
<TourOverlay />

<main>
  <CriteriaPanel />
  <!-- The central pane scrolls (only it) once the window is too narrow for the
       view's floor width, so the wheel never shrinks to nothing and the
       sidebars stay put (ISSUES.md #13). -->
  <div class="center-scroll">
    {#if $library.length === 0}
      <div class="empty">
        <h2>Your library as a web of combos</h2>
        <p>
          Import a Rekordbox collection XML or playlist TXT, a CSV, an M3U8 playlist, or tagged audio
          files — or load the sample library — to see your tracks on the Camelot wheel, with
          suggested combos as edges between them.
        </p>
        <p class="privacy">Everything stays in your browser. Nothing is uploaded.</p>
      </div>
    {:else if effectiveView === 'genres'}
      <GenreMapView />
    {:else if effectiveView === 'tracks'}
      <TracksView />
    {:else}
      <WheelView />
    {/if}
  </div>
  <!-- The right aside: advanced settings swap in where the set lives, so the
       wheel stays visible while settings change (design-v5 §E). The selected
       track's card docks at its foot whichever panel is open (v9 issue 19). -->
  {#if $rightPanel === 'advanced' || $library.length > 0}
    <div class="right-aside">
      {#if $rightPanel === 'advanced'}
        <AdvancedMenu />
      {:else}
        <TracklistPanel />
      {/if}
      <SelectedTrackCard />
    </div>
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* Central-pane scroll container (#13): shrinks with the window (min-width:0)
     but its floored view overflows and scrolls here — the fixed-width sidebars
     never move. */
  .center-scroll {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow: auto;
  }

  /* Floor each central view so a narrow window scrolls it instead of squishing
     the wheel to nothing. App-scoped specificity beats the views' own
     min-width:0. The empty state stays fluid (no floor). */
  .center-scroll > :global(.wheel-wrap),
  .center-scroll > :global(.map-wrap),
  .center-scroll > :global(.tracks-view) {
    flex: 1;
    min-width: 680px;
  }

  .center-scroll > .empty {
    flex: 1;
    min-width: 0;
  }

  .right-aside {
    /* v14 R1: fix the rail at the panels' own 280px so a long selected-track
       title or link hint can never stretch it wider. */
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* The panels keep their own 280px width; here they just fill the column
     so the card below never pushes them around. */
  .right-aside > :global(aside) {
    flex: 1;
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
