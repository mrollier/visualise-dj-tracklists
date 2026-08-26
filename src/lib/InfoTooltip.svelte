<script lang="ts">
  import type { Snippet } from 'svelte'

  // A small info icon revealing a tooltip on hover / keyboard focus, or
  // PINNED open by a click (v11 issue 6 — links inside stay reachable) until
  // an outside click or Escape. The panel positions itself `fixed` and
  // clamps to the viewport (v11 issue 4), so the two scrolling side panels
  // and the central viewer can never clip or cover it.
  interface Props {
    /** Accessible label for the trigger button. */
    label?: string
    /** Which edge of the trigger the panel prefers to align to. */
    align?: 'left' | 'right'
    /**
     * Replaces the ⓘ glyph, for rows whose own content is the natural place
     * to hover (v35.1: the descriptor filters, where a 250px rail has no
     * width for a label AND an icon). Styling comes from the caller — a
     * snippet is scoped where it is defined, not where it renders — so the
     * button only drops its own type and colour here.
     */
    trigger?: Snippet
    children: Snippet
  }
  let { label = 'More information', align = 'left', trigger, children }: Props = $props()

  let tipId = `info-tip-${Math.random().toString(36).slice(2, 9)}`

  let hovered = $state(false)
  let pinned = $state(false)
  const shown = $derived(hovered || pinned)

  let wrapEl: HTMLSpanElement
  let buttonEl: HTMLButtonElement
  let tipEl = $state<HTMLDivElement | null>(null)
  let pos = $state<{ x: number; y: number } | null>(null)

  // Position on reveal: below the trigger, flipped above when the viewport
  // runs out, clamped horizontally. Runs after the panel renders (it needs
  // the real size); until then the panel is measured invisibly.
  $effect(() => {
    if (!shown || tipEl === null) {
      pos = null
      return
    }
    const margin = 8
    const gap = 6
    const btn = buttonEl.getBoundingClientRect()
    const tip = tipEl.getBoundingClientRect()
    let x = align === 'right' ? btn.right - tip.width : btn.left
    x = Math.min(Math.max(margin, x), window.innerWidth - tip.width - margin)
    let y = btn.bottom + gap
    if (y + tip.height > window.innerHeight - margin) y = btn.top - tip.height - gap
    y = Math.max(margin, y)
    pos = { x, y }
  })
</script>

<svelte:window
  onpointerdown={(e) => {
    if (pinned && e.target instanceof Node && !wrapEl.contains(e.target)) pinned = false
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') pinned = false
  }}
/>

<!-- Hover handlers are a pointer nicety only (the button handles keyboard
     focus and click-to-pin), hence the presentation role. -->
<span
  class="info-wrap"
  role="presentation"
  bind:this={wrapEl}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
>
  <button
    type="button"
    class="info"
    class:custom={trigger !== undefined}
    class:pinned
    aria-label={label}
    aria-expanded={pinned}
    aria-describedby={tipId}
    bind:this={buttonEl}
    onclick={() => (pinned = !pinned)}
    onfocus={() => (hovered = true)}
    onblur={() => (hovered = false)}
    >{#if trigger}{@render trigger()}{:else}ⓘ{/if}</button
  >
  {#if shown}
    <div
      class="tooltip"
      role="tooltip"
      id={tipId}
      bind:this={tipEl}
      style:left="{pos?.x ?? 0}px"
      style:top="{pos?.y ?? 0}px"
      style:visibility={pos === null ? 'hidden' : 'visible'}
    >
      {@render children()}
    </div>
  {/if}
</span>

<style>
  .info-wrap {
    flex-shrink: 0;
    display: inline-flex;
  }

  .info {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--ink-muted);
    cursor: pointer;
  }

  /* A custom trigger stands in for the glyph, so the button contributes no
     type or padding of its own — only the hover/pin colour below, which the
     caller's content inherits through currentColor. `help` (not `pointer`):
     the click pins, but the affordance being advertised is an explanation.
     Declared ABOVE the hover rule deliberately: `.info.custom` and
     `.info:hover` have equal specificity, so the later one wins and putting
     this second would silently kill the hover colour. */
  .info.custom {
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: help;
    min-width: 0;
  }

  .info:hover,
  .info:focus-visible,
  .info.pinned {
    color: var(--ink);
  }

  .tooltip {
    position: fixed;
    z-index: 100;
    min-width: 200px;
    max-width: 320px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    color: var(--ink-secondary);
    text-align: left;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.45;
    white-space: normal;
  }

  /* Inline, so a <strong> mid-sentence doesn't break the paragraph in three
     (v17 #7). Report-style tooltips get their heading line from the <span>
     rule below instead. */
  .tooltip :global(strong) {
    color: var(--ink);
  }

  /* Report-style content: each span reads as its own line (the import
     popover's look, kept through the v11 conversion). */
  .tooltip :global(span) {
    display: block;
  }
</style>
