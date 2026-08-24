<script lang="ts">
  // Inline SVG, not ‹ › ⌃ ⌄ — same reason as LockIcon and PlayIcon: a text
  // glyph carries a font-baked bearing, and these four have to look like one
  // arrow rotated four ways inside a fixed 14px slot. One path, rotated about
  // the box centre, guarantees that.
  interface Props {
    direction: 'left' | 'right' | 'up' | 'down'
    size?: number
  }
  const { direction, size = 12 }: Props = $props()

  const ANGLE: Record<Props['direction'], number> = { left: 0, up: 90, right: 180, down: 270 }
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  <path
    d="M11 1.6 4.4 8l6.6 6.4"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    transform="rotate({ANGLE[direction]} 8 8)"
  />
</svg>
