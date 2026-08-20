<script lang="ts">
  import { reasonLabel, type UnplayableReason } from '../core/audio/reasons'
  import type { Track } from '../core/model'
  import { library, selectedId, settings } from '../stores'
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
  const reasonContext = $derived({ sampleLibrary, rootName: $rootName })

  function titleOf(id: string | null): string | null {
    if (id === null) return null
    const track: Track | undefined = $library.find((t) => t.id === id)
    if (track === undefined) return null
    return track.artist === null ? track.title : `${track.artist} — ${track.title}`
  }

  /**
   * Why deck B cannot play, most specific cause first. A per-deck error set by
   * the element itself beats the static guess; the folder state beats both,
   * because without a folder nothing is resolvable at all.
   */
  function reasonFor(deck: 'a' | 'b'): UnplayableReason | null {
    if ($deckError[deck] !== null) return $deckError[deck]
    if ($decks[deck] === null) return null
    if (sampleLibrary) return 'no-location'
    if ($sourceState === 'needs-permission') return 'needs-permission'
    if ($sourceState !== 'ready') return 'no-source'
    return null
  }

  function pickFolder() {
    if (canLinkPersistently()) void linkFolder()
    else folderInput?.click()
  }
</script>

{#if $settings.audioPreview && $library.length > 0}
  <section class="player" aria-label="Audio preview">
    {#if $decks.aLocked}
      <DeckRow
        deck="a"
        label={titleOf($decks.a)}
        playing={$playing.a}
        position={$positions.a}
        duration={$durations.a}
        reason={reasonFor('a')}
        {reasonContext}
        locked={true}
        onToggle={() => void togglePlay('a')}
        onSeek={(s) => seekDeck('a', s)}
        onLock={unlockDeck}
      />
    {/if}

    <div class="row">
      <DeckRow
        deck="b"
        label={$decks.aLocked ? titleOf($decks.b) : null}
        playing={$playing.b}
        position={$positions.b}
        duration={$durations.b}
        reason={reasonFor('b')}
        {reasonContext}
        locked={$decks.aLocked}
        onToggle={() => void togglePlay('b')}
        onSeek={(s) => seekDeck('b', s)}
        onLock={$decks.aLocked ? unlockDeck : lockDeck}
      />

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
    </div>

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
    {#if $selectedId === null && $decks.b === null && $sourceState === 'ready'}
      <span class="hint">{reasonLabel('no-source', reasonContext)}</span>
    {/if}
  </section>
{/if}

<style>
  .player {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 14px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .row > :global(.deck) {
    flex: 1;
    min-width: 0;
  }

  .source {
    flex-shrink: 0;
  }

  .status,
  .hint {
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
