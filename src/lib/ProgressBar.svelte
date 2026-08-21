<script lang="ts">
  /**
   * The app's one progress bar (v29 #2). Determinate when the total is known,
   * indeterminate when it cannot be — a File System Access walk discovers the
   * folder as it goes and has no total until it is finished.
   *
   * A div pair rather than `<progress>`: the native element cannot be styled
   * consistently across the three browsers this app supports, and its
   * indeterminate animation is a different shape in each.
   */
  interface Props {
    /** Omit for an indeterminate bar. */
    value?: number
    max?: number
    /** Accessible name — the visible status line beside it is not one. */
    label: string
    /** Bar width. The player bar has a narrow column; the panel does not. */
    width?: string
  }
  const { value, max, label, width = '100%' }: Props = $props()

  const fraction = $derived(
    value !== undefined && max !== undefined && max > 0
      ? Math.min(1, Math.max(0, value / max))
      : null,
  )
</script>

<div
  class="track"
  style:width
  role="progressbar"
  aria-label={label}
  aria-valuemin={fraction === null ? undefined : 0}
  aria-valuemax={fraction === null ? undefined : 100}
  aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
>
  <div
    class="fill"
    class:indeterminate={fraction === null}
    style:width={fraction === null ? undefined : `${fraction * 100}%`}
  ></div>
</div>

<style>
  .track {
    flex-shrink: 0;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.2s linear;
  }

  /* Nothing to measure, so the bar says "still working" by moving. */
  .fill.indeterminate {
    width: 40%;
    animation: slide 1.1s ease-in-out infinite;
    transition: none;
  }

  @keyframes slide {
    0% {
      transform: translateX(-100%);
    }

    100% {
      transform: translateX(250%);
    }
  }

  /* A still bar still has to read as "working, total unknown", so it fills the
     track at a lower weight rather than sitting at some arbitrary fraction. */
  @media (prefers-reduced-motion: reduce) {
    .fill.indeterminate {
      width: 100%;
      animation: none;
      opacity: 0.5;
    }
  }
</style>
