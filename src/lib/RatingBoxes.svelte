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
  }
  let { value, max, onchange, label = 'Required matches' }: Props = $props()

  function pick(k: number): void {
    onchange(k === value ? k - 1 : k)
  }
</script>

<div class="boxes" role="group" aria-label={label}>
  {#each [...Array(Math.max(1, max)).keys()] as i (i)}
    {@const k = i + 1}
    <button
      type="button"
      class="box"
      class:filled={k <= value}
      aria-pressed={k <= value}
      title={`require ${k}`}
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
</style>
