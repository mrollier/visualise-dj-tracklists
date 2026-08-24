<script lang="ts">
  import ChevronIcon from './ChevronIcon.svelte'

  /**
   * The button that puts one panel away, and brings it back (v30).
   *
   * It sits ON the boundary it controls — half in the panel, half in the
   * central column — which is only possible because every one of them is
   * positioned against the CENTRAL column's own edges. Those edges are the
   * boundaries in both states, so nothing here has to know a rail width, and a
   * collapse moves the button for free.
   *
   * The chevron points the way the panel will go, so the button reads as an
   * instruction rather than a state: outward closes, inward re-opens.
   *
   * `aria-expanded` + `aria-controls` rather than `aria-pressed`: this is a
   * disclosure for a region that is still in the DOM (collapsing clips, it
   * never unmounts), which is exactly what those two are for. The accessible
   * name stays the panel's name; the tooltip says what the press will do.
   */
  interface Props {
    side: 'left' | 'right' | 'top'
    open: boolean
    /** The panel's name — stable, since `aria-expanded` carries the state. */
    label: string
    /** What pressing it does right now, for the tooltip. */
    title: string
    /** id of the element this collapses. */
    controls: string
    onToggle: () => void
  }
  const { side, open, label, title, controls, onToggle }: Props = $props()

  const direction = $derived.by(() => {
    if (side === 'top') return open ? 'up' : 'down'
    if (side === 'left') return open ? 'left' : 'right'
    return open ? 'right' : 'left'
  })
</script>

<button
  type="button"
  class="panel-toggle {side}"
  class:tucked={!open}
  aria-expanded={open}
  aria-controls={controls}
  aria-label={label}
  {title}
  onclick={onToggle}
>
  <ChevronIcon {direction} />
</button>

<style>
  /* Absolutely positioned against `.centre` (or, for the top one, against the
     player slot inside it) and translated back by half its own size, so it
     straddles the seam rather than sitting inside either side of it. */
  .panel-toggle {
    position: absolute;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--ink-muted);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
  }

  .panel-toggle:hover,
  .panel-toggle:focus-visible {
    color: var(--accent);
    border-color: var(--accent);
  }

  .left,
  .right {
    width: 16px;
    height: 34px;
    top: 50%;
  }

  .left {
    left: 0;
    transform: translate(-50%, -50%);
  }

  .right {
    right: 0;
    transform: translate(50%, -50%);
  }

  /* Straddling the seam is right while there is a panel on the other side of
     it. Once there is not, the seam IS the window edge, and half the button
     would hang outside it — so a collapsed rail's button docks inside instead. */
  .left.tucked,
  .right.tucked {
    transform: translate(0, -50%);
  }

  /* `top: 100%` of the player slot: the bar's lower edge when the bar is
     showing, and — since the slot is then zero-height — the ribbon's lower edge
     when it is not. One rule, both states. */
  .top {
    width: 34px;
    height: 16px;
    left: 50%;
    top: 100%;
    transform: translate(-50%, -50%);
  }
</style>
