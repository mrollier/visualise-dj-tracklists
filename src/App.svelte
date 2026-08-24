<script lang="ts">
  import AdvancedMenu from './lib/AdvancedMenu.svelte'
  import CriteriaPanel from './lib/CriteriaPanel.svelte'
  import GenreMapView from './lib/GenreMapView.svelte'
  import { startPlayer } from './lib/audio/playerStore'
  import PanelToggle from './lib/PanelToggle.svelte'
  import { restoreAutosave, startAutosave } from './lib/persistence'
  import PlayerBar from './lib/PlayerBar.svelte'
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

  /**
   * Which of the three panels are on screen (v30).
   *
   * The right rail is the only one with two owners: ⚙ Advanced borrows it, and
   * that borrow OVERRIDES the collapse — pressing ⚙ has to produce a panel
   * whether or not the rail was put away. Its own button is therefore hidden
   * while Advanced is showing, since ⚙ and Escape already close that.
   *
   * The top panel has no flag of its own: `audioPreview` is it. A bar you
   * cannot see is a bar you cannot stop, so collapsing it really does switch
   * the feature off — playerStore keeps the session and hands it back.
   */
  const leftOpen = $derived($settings.showLeftPanel)
  const rightMounted = $derived($rightPanel === 'advanced' || $library.length > 0)
  const rightOpen = $derived($rightPanel === 'advanced' || $settings.showRightPanel)
  const rightTogglable = $derived($rightPanel !== 'advanced' && $library.length > 0)

  restoreAutosave()
  startTheme()
  startAutosave()
  startUndo()
  startPlayer()

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
  <!-- Collapsing CLIPS, it never unmounts (v30): Playlists, Filters and Genres
       are plain <details> whose fold state lives in uncontrolled DOM, and the
       panel keeps its own width inside the clip so nothing reflows or loses its
       scroll position on the way out and back. -->
  <div id="panel-left" class="left-rail" class:collapsed={!leftOpen} inert={!leftOpen}>
    <CriteriaPanel />
  </div>

  <!-- The central column, and the reason the audition bar lines up with the
       view it describes: the bar is INSIDE the column now (v30), not a
       full-width strip above everything reserving two spacer columns to match
       the rails (v29 #6). Alignment is structural, so no collapse can break it.
       The bar sits outside .center-scroll, so a narrow window scrolls the wheel
       without dragging the transport sideways. -->
  <div class="centre">
    <div id="panel-top" class="player-slot">
      <PlayerBar />
      <PanelToggle
        side="top"
        open={$settings.audioPreview}
        label="Audio preview"
        title={$settings.audioPreview
          ? 'Hide the audio preview — what is loaded comes back when you show it again'
          : 'Show the audio preview'}
        controls="panel-top"
        onToggle={() => settings.update((s) => ({ ...s, audioPreview: !s.audioPreview }))}
      />
    </div>

    <div class="center-scroll">
      {#if $library.length === 0}
        <div class="empty">
          <h2>Your library as a web of combos</h2>
          <p>
            Import a Rekordbox collection XML or playlist TXT, a CSV, an M3U8 playlist, or tagged
            audio files — or load the sample library — to see your tracks on the harmonic key wheel,
            with suggested combos as edges between them.
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

    <PanelToggle
      side="left"
      open={leftOpen}
      label="Playlists and filters"
      title={leftOpen ? 'Hide playlists and filters' : 'Show playlists and filters'}
      controls="panel-left"
      onToggle={() => settings.update((s) => ({ ...s, showLeftPanel: !s.showLeftPanel }))}
    />
    {#if rightTogglable}
      <PanelToggle
        side="right"
        open={rightOpen}
        label="Constellation panel"
        title={rightOpen ? 'Hide the constellation' : 'Show the constellation'}
        controls="panel-right"
        onToggle={() => settings.update((s) => ({ ...s, showRightPanel: !s.showRightPanel }))}
      />
    {/if}
  </div>

  <!-- The right rail: advanced settings swap in where the set lives, so the
       wheel stays visible while settings change (design-v5 §E). The selected
       track's card docks at its foot whichever panel is open (v9 issue 19). -->
  {#if rightMounted}
    <div id="panel-right" class="right-rail" class:collapsed={!rightOpen} inert={!rightOpen}>
      <div class="right-aside">
        {#if $rightPanel === 'advanced'}
          <AdvancedMenu />
        {:else}
          <TracklistPanel />
        {/if}
        <SelectedTrackCard />
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* The two clipping rails (v30). The panel inside keeps its own width, so a
     collapse changes exactly one number and reflows nothing. */
  .left-rail,
  .right-rail {
    flex-shrink: 0;
    display: flex;
    overflow: hidden;
  }

  .left-rail {
    width: var(--left-rail);
  }

  .right-rail {
    width: var(--right-rail);
  }

  .left-rail.collapsed,
  .right-rail.collapsed {
    width: 0;
  }

  /* Positioning context for all three panel buttons: its own edges ARE the
     panel boundaries, in every combination of collapses. */
  .centre {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* Zero-height when the bar is off, which is what puts the top button under
     the ribbon rather than floating over the wheel. */
  .player-slot {
    flex: 0 0 auto;
    position: relative;
  }

  /* Central-pane scroll container (#13): shrinks with the window (min-width:0)
     but its floored view overflows and scrolls here — the fixed-width sidebars
     never move. */
  .center-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: auto;
    /* The three edges a panel tab protrudes over (v30.1). Reserving the strip
       is what keeps the tabs off the content rather than merely off the panels:
       without it the top tab sat squarely on the Tracks view's KEY header, and
       the side ones on its ★ and rating columns. The wheel and the genre map
       are `meet`-scaled, so they simply draw 14px smaller. */
    padding: var(--panel-tab) var(--panel-tab) 0;
    /* The reserved strip has to read as part of the view, not as a frame around
       it — every central view paints the same surface. */
    background: var(--surface);
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
    /* v14 R1: fix the rail at the panels' own width so a long selected-track
       title or link hint can never stretch it wider — and, since v30, so the
       whole column keeps its layout while the rail around it clips to nothing. */
    width: var(--right-rail);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* The panels keep their own rail width; here they just fill the column
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
