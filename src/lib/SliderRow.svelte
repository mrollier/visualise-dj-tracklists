<script lang="ts">
  // A reusable labelled range-slider row, extracted from AdvancedMenu (v14.1
  // WS11) — same markup/styles as the original inline rows, just shared.
  let {
    label,
    value = $bindable(),
    min,
    max,
    step,
    display = (v: number) => String(v),
    title = undefined,
    dimmed = false,
  }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    display?: (v: number) => string
    title?: string
    dimmed?: boolean
  } = $props()
</script>

<label class:off-view={dimmed} {title}>
  {label} <strong>{display(value)}</strong>
  <input type="range" {min} {max} {step} bind:value />
</label>

<style>
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
    flex-wrap: wrap;
  }

  label.off-view {
    color: var(--ink-muted);
    opacity: 0.6;
  }

  input[type='range'] {
    width: 100%;
    padding: 0;
  }
</style>
