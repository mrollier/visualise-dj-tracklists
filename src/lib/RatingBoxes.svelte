<script lang="ts">
  // Discrete require-N-of-M control: N boxes, fill k to require k matches
  // (star-rating semantics). Sliders are for continuous values; this is a
  // count, so it gets boxes (v10 issue 3). Clicking the top-filled box steps
  // down one — all the way to zero (v11 issue 2a): "require 0" is a valid,
  // deliberate everything-connects choice.
  interface Props {
    value: number
    max: number
    onchange: (value: number) => void
    label?: string
    /**
     * Boxes at or below `floor` are locked ON — mandatory (demanded) criteria
     * pin the count there (v14 C2). The step-down never drops below the floor,
     * and locked boxes read as non-declinable.
     */
    floor?: number
  }
  let { value, max, onchange, label = 'Required matches', floor = 0 }: Props = $props()

  function pick(k: number): void {
    if (k <= floor) return // locked: mandatory, cannot be declined
    onchange(k === value ? Math.max(k - 1, floor) : k)
  }
</script>

<div class="boxes" role="group" aria-label={label}>
  {#each [...Array(Math.max(1, max)).keys()] as i (i)}
    {@const k = i + 1}
    {@const locked = k <= floor}
    <button
      type="button"
      class="box"
      class:filled={k <= value}
      class:locked
      aria-pressed={k <= value}
      disabled={locked}
      title={locked ? `required (locked): ${k}` : `require ${k}`}
      onclick={() => pick(k)}
    ></button>
  {/each}
</div>

<style>
  .boxes {
    display: inline-flex;
    gap: 5px;
  }

  .box {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1.5px solid var(--border);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .box:hover {
    border-color: var(--accent);
  }

  .box.filled {
    background: var(--accent);
    border-color: var(--accent);
  }

  /* A locked box is a mandatory (demanded) match: filled, accent-tinted, and
     non-declinable — the lock lives on the criterion row, not here. */
  .box.locked {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
    border-color: var(--accent);
    cursor: not-allowed;
    opacity: 0.85;
  }

  .box.locked:hover {
    border-color: var(--accent);
  }
</style>
