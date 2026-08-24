<script lang="ts">
  import ChevronIcon from './ChevronIcon.svelte'

  /**
   * The button that puts one panel away, and brings it back (v30).
   *
   * It is a TAB attached to the boundary it controls (v30.1): flat against the
   * seam, rounded into the central view, and protruding only that way. v30 had
   * it straddling the seam, half inside the panel — which put chrome on the
   * panel's own contents, worst at the top where it landed on the deck row's
   * seek line. The tab pays for that with a sliver of the central view instead,
   * which has room: the wheel keeps an empty gutter outside its outermost ring.
   *
   * Either way it is positioned against the CENTRAL column's own edges, which
   * are the panel boundaries in every combination of collapses — so nothing
   * here has to know a rail width, and a collapse moves the tab for free.
   * Never crossing the seam also retires v30's `.tucked` case: there is no
   * longer a state in which half the button would hang outside the window.
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
     player slot inside it) and translated back on ONE axis only, so the tab
     centres along the seam without ever crossing it. */
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
    cursor: pointer;
  }

  /* The ink is deliberately a sliver — this is furniture, not a control anyone
     hunts for. The hit area is not: an invisible cushion brings every tab up to
     the 24px pointer target in both axes without widening what is drawn. It
     grows ONLY into the central view, never back across the seam — a cushion
     over the panel would take clicks from the contents this wave is trying to
     stop covering. */
  .panel-toggle::before {
    content: '';
    position: absolute;
    inset: 0;
  }

  .panel-toggle:hover,
  .panel-toggle:focus-visible {
    color: var(--accent);
    border-color: var(--accent);
  }

  .left,
  .right {
    width: 14px;
    height: 40px;
    top: 50%;
    transform: translateY(-50%);
  }

  /* Flat edge on the seam, rounded into the view, and no border along the seam
     itself: the tab reads as growing out of the panel rather than floating over
     it. With the rail collapsed the seam is the window edge, and the same rule
     docks it there — which is why there is no second state to describe. */
  .left {
    left: 0;
    border-left: none;
    border-radius: 0 8px 8px 0;
  }

  .left::before {
    right: -10px;
  }

  .right {
    right: 0;
    border-right: none;
    border-radius: 8px 0 0 8px;
  }

  .right::before {
    left: -10px;
  }

  /* `top: 100%` of the player slot: the bar's lower edge when the bar is
     showing, and — since the slot is then zero-height — the ribbon's lower edge
     when it is not. One rule, both states. */
  .top {
    width: 44px;
    height: 14px;
    left: 50%;
    top: 100%;
    transform: translateX(-50%);
    border-top: none;
    border-radius: 0 0 8px 8px;
  }

  .top::before {
    bottom: -10px;
  }
</style>
