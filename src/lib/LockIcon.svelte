<script lang="ts">
  // Inline SVG, not the 🔒/🔓 emoji (v26 fix): a colour-emoji glyph carries
  // its own font-baked right-side bearing, so even a box that's correctly
  // flush with the panel's right inset (matching .range-reset/.count/.info)
  // reads as sitting short of it. A vector path has no such bearing to
  // fight — same durable fix as TracksView's hamburger toggle.
  //
  // The viewBox is drawn edge to edge (v27): the first cut kept a 24-unit
  // box around a shape spanning 4…20, which put ~3px of transparent margin
  // inside a 14px icon and left the padlock looking short of the right edge
  // all over again — the emoji's bearing rebuilt in SVG.
  interface Props {
    locked: boolean
  }
  const { locked }: Props = $props()
</script>

<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
  <rect
    x="0.9"
    y="7.4"
    width="14.2"
    height="7.7"
    rx="1.6"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
  />
  <path
    d={locked ? 'M4.4 7.4V4.6a3.6 3.6 0 0 1 7.2 0v2.8' : 'M4.4 7.4V4.6a3.6 3.6 0 0 1 6.9-1.35'}
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
  />
</svg>
