<script lang="ts">
  import type { Snippet } from 'svelte'

  // A small info icon that reveals a tooltip on hover / keyboard focus. Lifts
  // the import-report popover pattern (TopBar) into one reusable place so long
  // explanations can hide behind an ⓘ instead of filling the panel (v10).
  interface Props {
    /** Accessible label for the trigger button. */
    label?: string
    /** Which edge the panel aligns to (avoid clipping at a panel's right). */
    align?: 'left' | 'right'
    children: Snippet
  }
  let { label = 'More information', align = 'left', children }: Props = $props()

  let tipId = `info-tip-${Math.random().toString(36).slice(2, 9)}`
</script>

<span class="info-wrap">
  <button type="button" class="info" aria-label={label} aria-describedby={tipId}>ⓘ</button>
  <div class="tooltip" class:right={align === 'right'} role="tooltip" id={tipId}>
    {@render children()}
  </div>
</span>

<style>
  .info-wrap {
    position: relative;
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
    cursor: help;
  }

  .info:hover,
  .info:focus-visible {
    color: var(--ink);
  }

  .tooltip {
    display: none;
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
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

  .tooltip.right {
    left: auto;
    right: 0;
  }

  .tooltip :global(strong) {
    display: block;
    color: var(--ink);
  }

  .info-wrap:hover .tooltip,
  .info:focus-visible + .tooltip {
    display: block;
  }
</style>
