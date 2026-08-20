<script lang="ts">
  import type { DeckId } from '../core/audio/decks'
  import { formatDuration } from '../core/properties'
  import { marquee } from './marquee'
  import LockIcon from './LockIcon.svelte'
  import PlayIcon from './PlayIcon.svelte'

  interface Props {
    deck: DeckId
    /** Shown for deck A only: it is not the selection, so nothing else names it. */
    label: string | null
    playing: boolean
    position: number
    duration: number | null
    /** Why this deck cannot play, already worded. Null when it can. */
    reasonText: string | null
    /** Shown when the deck holds no track at all. */
    emptyText: string | null
    locked: boolean
    onToggle: () => void
    onSeek: (seconds: number) => void
    onLock: () => void
  }
  const {
    deck,
    label,
    playing,
    position,
    duration,
    reasonText,
    emptyText,
    locked,
    onToggle,
    onSeek,
    onLock,
  }: Props = $props()

  // The transport must NOT wait on duration: there is no AudioContext until a
  // click pays for one, so nothing knows the duration until after the first
  // play. Gating play on it would deadlock the deck. Duration gates the seek
  // line alone, which genuinely cannot work without a length.
  const transportDisabled = $derived(emptyText !== null || reasonText !== null)
  const seekDisabled = $derived(transportDisabled || duration === null)
  // While the thumb is held, the playhead must not write back or the two fight.
  let dragging = $state(false)
  let dragValue = $state(0)
  const shown = $derived(dragging ? dragValue : position)
</script>

<div class="deck" class:is-a={deck === 'a'}>
  <button
    class="transport"
    disabled={transportDisabled}
    onclick={onToggle}
    aria-label={playing ? 'Pause' : 'Play'}
    title={playing ? 'Pause' : 'Play'}
  >
    <PlayIcon {playing} />
  </button>

  {#if label !== null}
    <!-- The action flags overflow; the inner span carries the cycling motion,
         so the full title is readable if you watch for a moment. -->
    <span class="label" title={label} use:marquee={label}>
      <span class="scroll">{label}</span>
    </span>
  {/if}

  {#if emptyText !== null}
    <span class="reason">{emptyText}</span>
  {:else if reasonText !== null}
    <span class="reason">{reasonText}</span>
  {:else}
    <span class="clock tabular">{formatDuration(shown)}</span>
    <input
      class="line"
      type="range"
      min="0"
      max={duration ?? 1}
      step="0.01"
      value={shown}
      disabled={seekDisabled}
      aria-label="Position"
      onpointerdown={() => (dragging = true)}
      onpointerup={() => (dragging = false)}
      oninput={(e) => {
        dragValue = e.currentTarget.valueAsNumber
        dragging = true
      }}
      onchange={(e) => {
        dragging = false
        onSeek(e.currentTarget.valueAsNumber)
      }}
    />
    <span class="clock tabular">{duration === null ? '–:––' : formatDuration(duration)}</span>
  {/if}

  <button
    class="lock"
    class:on={locked}
    disabled={emptyText !== null}
    onclick={onLock}
    aria-pressed={locked}
    aria-label={locked ? 'Unpin the top track' : 'Pin this track to compare against'}
    title={locked ? 'Unpin the top track' : 'Pin this track to compare against'}
  >
    <LockIcon {locked} />
  </button>
</div>

<style>
  .deck {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .transport,
  .lock {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.28rem 0.5rem;
    flex-shrink: 0;
  }

  .lock.on {
    background: var(--accent);
    color: var(--on-accent);
  }

  /* A fixed column, so deck A's and deck B's seek lines start at the same x. */
  .label {
    flex: 0 0 22ch;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-secondary);
  }

  .scroll {
    display: inline-block;
  }

  /* A translated child and a static ellipsis fight, so the ellipsis goes while
     the label is cycling — the motion is what reveals the tail instead. */
  .label:global(.overflowing) {
    text-overflow: clip;
  }

  .label:global(.overflowing) .scroll {
    animation: label-cycle var(--marquee-duration, 8s) ease-in-out infinite;
  }

  /* Hold, glide to the far end, hold, glide home. */
  @keyframes label-cycle {
    0%,
    20% {
      transform: translateX(0);
    }
    55%,
    70% {
      transform: translateX(var(--marquee-shift, 0px));
    }
    100% {
      transform: translateX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .label:global(.overflowing) .scroll {
      animation: none;
    }

    .label:global(.overflowing) {
      text-overflow: ellipsis;
    }
  }

  .clock {
    font-size: 11.5px;
    color: var(--ink-muted);
    flex-shrink: 0;
  }

  .line {
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  .reason {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
