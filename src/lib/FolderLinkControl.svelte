<script lang="ts">
  import { coverageLine } from '../core/audio/coverage'
  import { commonAncestorPath } from '../core/location'
  import { library } from '../stores'
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
  import { isSampleLibrary } from './persistence'

  /**
   * The one control that links a music folder, in both the places it appears:
   * the player bar is the discovery path, Advanced → Preview the management
   * one. Shared rather than duplicated so the wording, the fallback picker and
   * the path hint can only ever say one thing.
   */
  interface Props {
    layout: 'bar' | 'panel'
  }
  const { layout }: Props = $props()

  let folderInput = $state<HTMLInputElement | undefined>()
  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  const sampleLibrary = $derived(isSampleLibrary($library))

  /**
   * No browser lets a page aim a folder picker at a path (v28.1): Chromium's
   * `showDirectoryPicker` takes only well-known names — we pass `'music'` —
   * and `<input webkitdirectory>` takes nothing at all. Showing the path is
   * the whole of what is left, and it is enough: the macOS open panel takes
   * ⌘⇧G and a paste, GTK and Windows dialogs take Ctrl+L.
   */
  const suggestedPath = $derived(
    sampleLibrary ? null : commonAncestorPath($library.map((t) => t.location)),
  )

  const jumpKeys =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? '⌘⇧G' : 'Ctrl+L'

  function pickFolder() {
    if (canLinkPersistently()) void linkFolder()
    else folderInput?.click()
  }

  function copyPath() {
    const path = suggestedPath
    if (path === null) return
    void navigator.clipboard
      ?.writeText(path)
      .then(() => {
        copied = true
        clearTimeout(copyTimer)
        copyTimer = setTimeout(() => (copied = false), 1500)
      })
      .catch(() => {
        // Clipboard blocked or unavailable. The path is on screen and in the
        // button's title either way, so there is nothing to report.
      })
  }
</script>

<div class="link" class:panel={layout === 'panel'}>
  {#if $sourceState === 'indexing'}
    <span class="status">Scanning{$rootName ? ` “${$rootName}”` : ''}… {$indexedCount}</span>
  {:else if $sourceState === 'needs-permission'}
    <button onclick={() => void reconnect()}>Reconnect “{$rootName}”</button>
  {:else if $sourceState === 'ready' && $coverage !== null}
    <button class="coverage" onclick={pickFolder} title="Change the linked music folder">
      ✓ {coverageLine($coverage)}
    </button>
  {:else}
    <button onclick={pickFolder} disabled={sampleLibrary}>Link music folder…</button>
    {#if suggestedPath !== null}
      <!-- Deliberately a separate control from the button above: the picker is
           modal, so the copy has to happen first. -->
      <button
        class="path"
        onclick={copyPath}
        title="Your library lives in {suggestedPath} — copy it, then press {jumpKeys} in the picker"
      >
        {copied ? '✓ copied' : suggestedPath} ⧉
      </button>
    {/if}
  {/if}

  <!-- Firefox and Safari have no persistent grant to offer, so they fall back
       to a folder pick that lasts the session. -->
  <input
    bind:this={folderInput}
    type="file"
    webkitdirectory
    multiple
    hidden
    onchange={(e) => usePickedFiles(Array.from(e.currentTarget.files ?? []))}
  />
</div>

{#if layout === 'panel' && suggestedPath !== null && $sourceState !== 'ready'}
  <p class="tip">
    Your library lives in that folder. Copy the path, then press {jumpKeys} in the picker to jump straight
    there — no browser lets this page open it for you.
  </p>
{/if}

<style>
  .link {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .link.panel {
    flex-wrap: wrap;
    padding: 2px 0;
  }

  .status {
    font-size: 11.5px;
    color: var(--ink-muted);
  }

  .coverage,
  .path {
    font-size: 11.5px;
    color: var(--ink-muted);
    background: none;
    border-color: transparent;
  }

  .path {
    max-width: 26ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tip {
    margin: 2px 0 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--ink-muted);
  }
</style>
