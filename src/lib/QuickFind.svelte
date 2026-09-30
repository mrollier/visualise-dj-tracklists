<script lang="ts">
  // Quick find: type part of an artist or title, pick with ↑/↓ and Enter (or
  // a click). The pick is selected and brought into sight by whichever view
  // is showing. It searches what the wheel shows; matches that playlists or
  // filters hide are counted, never revealed by changing those.
  import { quickFind } from '../core/quickFind'
  import {
    augmentedLibrary,
    quickFindOpen,
    revealRequest,
    selectedId,
    settings,
    viewMode,
    visibleLibrary,
  } from '../stores'

  let dialogEl: HTMLDialogElement
  let query = $state('')
  let active = $state(0)

  const found = $derived(quickFind($visibleLibrary, query))
  const hidden = $derived(
    query.trim() === '' ? 0 : quickFind($augmentedLibrary, query).total - found.total,
  )
  const more = $derived(found.total - found.matches.length)

  $effect(() => {
    if ($quickFindOpen && !dialogEl.open) {
      query = ''
      dialogEl.showModal()
    } else if (!$quickFindOpen && dialogEl.open) {
      dialogEl.close()
    }
  })

  // A new result list starts from its first entry.
  $effect(() => {
    void found
    active = 0
  })

  function pick(id: string) {
    selectedId.set(id)
    // The genre map has no tracks to show; the wheel does. Easy mode already
    // shows the wheel and keeps the stored view for when it is left.
    if ($viewMode === 'genres' && $settings.uiMode !== 'easy') viewMode.set('wheel')
    revealRequest.set(id)
    quickFindOpen.set(false)
  }

  function onkeydown(e: KeyboardEvent) {
    const n = found.matches.length
    // An input method's Enter confirms the characters being composed.
    if (n === 0 || e.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown') active = (active + 1) % n
    else if (e.key === 'ArrowUp') active = (active - 1 + n) % n
    else if (e.key === 'Enter') pick(found.matches[active].id)
    else return
    e.preventDefault()
  }

  // Tied to the track, so the active option's id changes with the list and a
  // screen reader announces the new top match.
  const optionId = (id: string) => `quick-find-${id.replace(/\s/g, '_')}`

  function describe(t: { artist: string | null; key: string | null; bpm: number | null }) {
    return [t.artist, t.key, t.bpm === null ? null : `${Math.round(t.bpm)} BPM`]
      .filter((part) => part !== null && part !== '')
      .join(' · ')
  }
</script>

<!-- A click on the backdrop (the dialog element itself, outside its box)
     closes it; Escape closes it natively. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<dialog
  bind:this={dialogEl}
  aria-label="Find a track"
  onclose={() => {
    // The close event fires a task later: a / pressed right after a pick has
    // reopened the dialog by then, and that must not be shut again.
    if (!dialogEl.open) quickFindOpen.set(false)
  }}
  onclick={(e) => {
    if (e.target === dialogEl) dialogEl.close()
  }}
>
  <!-- Plain text, not type="search": there Escape only clears the text, and
       it should close the dialog. -->
  <input
    type="text"
    inputmode="search"
    role="combobox"
    aria-expanded={found.matches.length > 0}
    aria-controls="quick-find-results"
    aria-autocomplete="list"
    aria-activedescendant={found.matches.length > 0
      ? optionId(found.matches[active].id)
      : undefined}
    placeholder="Find a track by artist or title"
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    {onkeydown}
  />
  <!-- Always in the DOM, so aria-controls always points somewhere and the
       live hint is announced when it changes. -->
  <ul
    id="quick-find-results"
    role="listbox"
    aria-label="Matching tracks"
    hidden={found.matches.length === 0}
  >
    {#each found.matches as track, i (track.id)}
      <!-- Keyboard choice happens in the input (aria-activedescendant);
           the mouse picks here. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id={optionId(track.id)}
        role="option"
        aria-selected={i === active}
        class:active={i === active}
        onmousemove={() => (active = i)}
        onclick={() => pick(track.id)}
      >
        <span class="title">{track.title}</span>
        <span class="meta">{describe(track)}</span>
      </li>
    {/each}
  </ul>
  <p class="hint" aria-live="polite" hidden={query.trim() === ''}>
    {#if query.trim() === ''}{:else if found.total === 0}
      {hidden > 0
        ? `No visible match — ${hidden} hidden by your playlists or filters.`
        : 'No track matches.'}
    {:else}
      {[
        more > 0 ? `${more} more — keep typing to narrow` : null,
        hidden > 0 ? `${hidden} more hidden by your playlists or filters` : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')}
    {/if}
  </p>
</dialog>

<style>
  dialog {
    margin: 12vh auto auto;
    width: min(560px, calc(100vw - 32px));
    padding: 0;
    background: var(--surface-raised);
    color: var(--ink);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--ink);
    font-size: 15px;
  }

  input:focus {
    outline: none;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 7px 14px;
    cursor: pointer;
  }

  /* The tint alone is too faint to mark the choice; the edge carries it. */
  li.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .title {
    flex-shrink: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 13px;
  }

  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-secondary);
    font-size: 12px;
  }

  .hint {
    margin: 0;
    padding: 8px 14px 10px;
    color: var(--ink-muted);
    font-size: 12px;
  }
</style>
