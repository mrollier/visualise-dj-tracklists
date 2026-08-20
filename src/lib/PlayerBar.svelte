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
  import {
    canLinkPersistently,
    coverage,
    indexedCount,
    linkFolder,
    reconnect,
    resolutionFor,
    rootName,
    sourceState,
    usePickedFiles,
  } from './audio/sourceStore'
  import { coverageLine } from '../core/audio/coverage'
  import DeckRow from './DeckRow.svelte'
  import { isSampleLibrary } from './persistence'

  /**
   * The audition bar (v28). One row while nothing is pinned; a second row and
   * the crossfader appear once deck A is locked.
   *
   * It renders even when nothing can play, and says why — a hidden bar cannot
   * distinguish "off" from "broken".
   */
  let folderInput = $state<HTMLInputElement | undefined>()

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

  function pickFolder() {
    if (canLinkPersistently()) void linkFolder()
    else folderInput?.click()
  }
</script>

{#if $settings.audioPreview && $library.length > 0}
  <section class="player" aria-label="Audio preview">
    <div class="decks">
      {#if $decks.aLocked}
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

      {#if $decks.aLocked}
        <label class="fader">
          <span class="end">A</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={$crossfade}
            aria-label="Crossfade between the pinned track and the selection"
            oninput={(e) => setCrossfade(e.currentTarget.valueAsNumber)}
          />
          <span class="end">B</span>
        </label>
      {/if}
    </div>

    <div class="source">
      {#if $sourceState === 'indexing'}
        <span class="status">Scanning{$rootName ? ` “${$rootName}”` : ''}… {$indexedCount}</span>
      {:else if $sourceState === 'needs-permission'}
        <button onclick={() => void reconnect()}>Reconnect “{$rootName}”</button>
      {:else if $sourceState === 'no-source'}
        <button onclick={pickFolder} disabled={sampleLibrary}>Link music folder…</button>
      {:else if $coverage !== null}
        <button class="coverage" onclick={pickFolder} title="Change the linked music folder">
          ✓ {coverageLine($coverage)}
        </button>
      {/if}
    </div>

    <!-- Firefox and Safari have no persistent grant to offer, so they fall
         back to a folder pick that lasts the session. -->
    <input
      bind:this={folderInput}
      type="file"
      webkitdirectory
      multiple
      hidden
      onchange={(e) => usePickedFiles(Array.from(e.currentTarget.files ?? []))}
    />
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

  .source {
    flex-shrink: 0;
  }

  .status {
    font-size: 11.5px;
    color: var(--ink-muted);
  }

  .coverage {
    font-size: 11.5px;
    color: var(--ink-muted);
    background: none;
    border-color: transparent;
  }

  .fader {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 2px;
  }

  .fader input[type='range'] {
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  .end {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    color: var(--ink-muted);
  }
</style>
