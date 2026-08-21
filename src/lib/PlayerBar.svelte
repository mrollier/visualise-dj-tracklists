<script lang="ts">
  import { extensionOf } from '../core/audio/formats'
  import {
    reasonDetail,
    reasonLabel,
    type ReasonContext,
    type UnplayableReason,
  } from '../core/audio/reasons'
  import type { Track } from '../core/model'
  import { library, settings } from '../stores'
  import {
    crossfade,
    deckError,
    decks,
    durations,
    lockDeck,
    playing,
    positions,
    seekDeck,
    setCrossfade,
    togglePlay,
    unlockDeck,
  } from './audio/playerStore'
  import { coverage, resolutionFor, rootName, sourceState } from './audio/sourceStore'
  import DeckRow from './DeckRow.svelte'
  import FolderLinkControl from './FolderLinkControl.svelte'
  import { isSampleLibrary } from './persistence'

  /**
   * The audition bar (v28). One row while nothing is pinned; a second row and
   * the crossfader appear once deck A is locked.
   *
   * It renders even when nothing can play, and says why — a hidden bar cannot
   * distinguish "off" from "broken". That now includes an empty library
   * (v29 #1): switching the preview on used to produce nothing at all, which
   * reads as a broken setting rather than a missing import.
   */
  const sampleLibrary = $derived(isSampleLibrary($library))

  function titleOf(id: string | null): string | null {
    if (id === null) return null
    const track: Track | undefined = $library.find((t) => t.id === id)
    if (track === undefined) return null
    return track.artist === null ? track.title : `${track.artist} — ${track.title}`
  }

  /**
   * Why a deck cannot play, most specific cause first. An error the element
   * itself raised beats the static guess; the folder state beats both, since
   * without a folder nothing is resolvable at all.
   *
   * Returns the short line for the row and the long one for the ⓘ beside it
   * (v29 #7), from one reason and one context so the two cannot disagree.
   */
  function reasonFor(deck: 'a' | 'b'): { label: string; detail: string } | null {
    // Read the coverage store so this re-evaluates when the resolution map is
    // rebuilt — the map itself is plain module state, not reactive.
    void $coverage
    const trackId = $decks[deck]
    if (trackId === null) return null
    const said = (reason: UnplayableReason, extra: Partial<ReasonContext> = {}) => {
      const context = { sampleLibrary, rootName: $rootName, ...extra }
      return { label: reasonLabel(reason, context), detail: reasonDetail(reason, context) }
    }
    const raised = $deckError[deck]
    // `raised` is the element's verdict, not the static resolution's guess, and
    // the copy says which of the two is speaking.
    if (raised !== null) return said(raised, { raised: true, extension: extensionFor(trackId) })
    if (sampleLibrary) return said('no-location')
    if ($sourceState === 'needs-permission') return said('needs-permission')
    if ($sourceState !== 'ready') return said('no-source')
    const resolution = resolutionFor(trackId)
    if (resolution === undefined || resolution.kind === 'playable') return null
    return said(resolution.reason, {
      ambiguousCount: resolution.ambiguousCount,
      extension: resolution.extension,
    })
  }

  /** The library's own extension for a track, for an error the element raised. */
  function extensionFor(trackId: string): string | null {
    const track = $library.find((t) => t.id === trackId)
    return track?.location == null ? null : extensionOf(track.location)
  }

  /** What the empty deck says: the folder is the blocker before the click is. */
  const emptyHint = $derived.by(() => {
    const context = { sampleLibrary, rootName: $rootName }
    // With no library there is nothing to click, but linking the folder first
    // is a perfectly good order to do things in — so say what is missing
    // rather than hiding the bar, which is the whole point of it rendering.
    if ($library.length === 0)
      return $sourceState === 'ready'
        ? 'folder linked — import a library to hear its tracks'
        : 'import a library, then link your music folder'
    if (sampleLibrary) return reasonLabel('no-location', context)
    if ($sourceState === 'needs-permission') return reasonLabel('needs-permission', context)
    if ($sourceState !== 'ready') return reasonLabel('no-source', context)
    return 'click a track to hear it'
  })
</script>

{#if $settings.audioPreview}
  <section class="player" aria-label="Audio preview">
    <div class="decks">
      <!-- Always rendered, input or not: the empty column is what keeps the
           play buttons from shifting sideways the moment a track is pinned. -->
      <div class="fader" class:live={$decks.aLocked}>
        {#if $decks.aLocked}
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={$crossfade}
            aria-label="Balance between the pinned track and the clicked track"
            title="Balance between the pinned track and the clicked one — double-click to centre"
            oninput={(e) => setCrossfade(e.currentTarget.valueAsNumber)}
            ondblclick={() => setCrossfade(0)}
          />
        {/if}
      </div>

      {#if $decks.aLocked}
        <DeckRow
          deck="a"
          label={titleOf($decks.a)}
          playing={$playing.a}
          position={$positions.a}
          duration={$durations.a}
          reason={reasonFor('a')}
          emptyText={null}
          locked={true}
          onToggle={() => void togglePlay('a')}
          onSeek={(s) => seekDeck('a', s)}
          onLock={unlockDeck}
        />
      {/if}

      <DeckRow
        deck="b"
        label={titleOf($decks.b)}
        playing={$playing.b}
        position={$positions.b}
        duration={$durations.b}
        reason={reasonFor('b')}
        emptyText={$decks.b === null ? emptyHint : null}
        locked={false}
        onToggle={() => void togglePlay('b')}
        onSeek={(s) => seekDeck('b', s)}
        onLock={lockDeck}
      />
    </div>

    <div class="source">
      <FolderLinkControl layout="bar" />
    </div>
  </section>
{/if}

<style>
  .player {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 14px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  /* The deck rows beside a narrow fader column; the source chip sits beside
     them all, so every seek line is the same width and the locks line up. One
     grid for both states (v28.2) — the fader cell is reserved even while
     empty, so pinning never shifts the transport sideways. */
  .decks {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 22px 1fr;
    align-items: center;
    column-gap: 8px;
    row-gap: 4px;
  }

  .source {
    flex-shrink: 0;
  }

  /* Vertical, spanning both rows (v28.1). The old full-width horizontal
     slider with A/B end letters was a whole extra row under a bar specified as
     minimal; this costs no height at all. */
  .fader {
    grid-column: 1;
    /* One row while nothing is pinned — spanning two would drag an empty
       implicit row (and its row-gap) into the single-deck bar's height. */
    grid-row: 1;
    position: relative;
    align-self: stretch;
    width: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Standard recipe, and the only one still needed: Chrome 124+, Firefox 120+,
     Safari 16.5+. Default `direction: ltr` puts the LOWEST value at the top —
     and min="-1" is deck A, which is the top row — so nothing inverts. */
  .fader input[type='range'] {
    writing-mode: vertical-lr;
    /* Absolutely positioned, and that is load-bearing rather than cosmetic: a
       `height: 100%` here resolves against a grid row whose own height depends
       on this element, and Chromium resolves that circularity by stretching
       the fader to the whole viewport. Out of flow, it contributes nothing to
       row sizing and top/bottom give it a definite height. */
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 18px;
    margin: 0;
    padding: 0;
    /* Above the centre-tick nubs: the pseudos and this positioned input paint
       in DOM order, which put the right-hand nub in front of the thumb. */
    z-index: 1;
  }

  /* Centre tick: two hairline nubs flanking the track, so "both tracks at full
     level" is findable by eye. Beside the track rather than across it — a mark
     drawn on the native track would sit behind it or paint over the thumb. */
  .fader.live {
    grid-row: 1 / 3;
  }

  .fader.live::before,
  .fader.live::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 3px;
    height: 1px;
    background: var(--ink-muted);
    pointer-events: none;
  }

  .fader.live::before {
    left: 0;
  }

  .fader.live::after {
    right: 0;
  }
</style>
