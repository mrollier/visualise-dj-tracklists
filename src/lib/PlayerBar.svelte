<script lang="ts">
  import { reasonLabel } from '../core/audio/reasons'
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
   * distinguish "off" from "broken".
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
   */
  function reasonTextFor(deck: 'a' | 'b'): string | null {
    // Read the coverage store so this re-evaluates when the resolution map is
    // rebuilt — the map itself is plain module state, not reactive.
    void $coverage
    const trackId = $decks[deck]
    if (trackId === null) return null
    const context = { sampleLibrary, rootName: $rootName }
    const raised = $deckError[deck]
    if (raised !== null) return reasonLabel(raised, context)
    if (sampleLibrary) return reasonLabel('no-location', context)
    if ($sourceState === 'needs-permission') return reasonLabel('needs-permission', context)
    if ($sourceState !== 'ready') return reasonLabel('no-source', context)
    const resolution = resolutionFor(trackId)
    if (resolution === undefined || resolution.kind === 'playable') return null
    return reasonLabel(resolution.reason, {
      ...context,
      ambiguousCount: resolution.ambiguousCount,
      extension: resolution.extension,
    })
  }

  /** What the empty deck says: the folder is the blocker before the selection is. */
  const emptyHint = $derived.by(() => {
    const context = { sampleLibrary, rootName: $rootName }
    if (sampleLibrary) return reasonLabel('no-location', context)
    if ($sourceState === 'needs-permission') return reasonLabel('needs-permission', context)
    if ($sourceState !== 'ready') return reasonLabel('no-source', context)
    return 'select a track to load it'
  })
</script>

{#if $settings.audioPreview && $library.length > 0}
  <section class="player" aria-label="Audio preview">
    <div class="decks" class:locked={$decks.aLocked}>
      {#if $decks.aLocked}
        <!-- Placed first so it owns column 1; the two rows auto-place beside it. -->
        <div class="fader">
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={$crossfade}
            aria-label="Balance between the pinned track and the selection"
            title="Balance between the pinned track and the selection"
            oninput={(e) => setCrossfade(e.currentTarget.valueAsNumber)}
          />
        </div>

        <DeckRow
          deck="a"
          label={titleOf($decks.a)}
          playing={$playing.a}
          position={$positions.a}
          duration={$durations.a}
          reasonText={reasonTextFor('a')}
          emptyText={null}
          locked={true}
          onToggle={() => void togglePlay('a')}
          onSeek={(s) => seekDeck('a', s)}
          onLock={unlockDeck}
        />
      {/if}

      <DeckRow
        deck="b"
        label={$decks.aLocked ? titleOf($decks.b) : null}
        playing={$playing.b}
        position={$positions.b}
        duration={$durations.b}
        reasonText={reasonTextFor('b')}
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

  /* The decks stack; the source chip sits beside them all, so every seek line
     is the same width and the two locks line up. */
  .decks {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Pinned: a narrow fader column beside both rows. A grid rather than an
     if/else around a wrapper, so deck B's markup is written once. */
  .decks.locked {
    display: grid;
    grid-template-columns: auto 1fr;
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
    grid-row: 1 / 3;
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
  }

  /* Centre tick: two hairline nubs flanking the track, so "both tracks at full
     level" is findable by eye. Beside the track rather than across it — a mark
     drawn on the native track would sit behind it or paint over the thumb. */
  .fader::before,
  .fader::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 3px;
    height: 1px;
    background: var(--ink-muted);
    pointer-events: none;
  }

  .fader::before {
    left: 0;
  }

  .fader::after {
    right: 0;
  }
</style>
