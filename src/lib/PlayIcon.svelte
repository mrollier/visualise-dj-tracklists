<script lang="ts">
  // Inline SVG, not ▶/⏸ emoji — same reason as LockIcon: a colour-emoji glyph
  // carries a font-baked bearing that makes a fixed-width icon slot stagger.
  // The viewBox is drawn edge to edge so there is no transparent margin inside
  // a 14px icon. ⏮/⏭ are deliberately absent: those glyphs already mean
  // "open/close the constellation" on the selected-track card.
  interface Props {
    playing: boolean
  }
  const { playing }: Props = $props()
</script>

<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
  {#if playing}
    <rect x="1.6" y="0.8" width="4.6" height="14.4" rx="1" fill="currentColor" />
    <rect x="9.8" y="0.8" width="4.6" height="14.4" rx="1" fill="currentColor" />
  {:else}
    <path d="M2.2 1.2 14.6 8 2.2 14.8Z" fill="currentColor" />
  {/if}
</svg>
