<script lang="ts">
  import type { PanelFilterKey } from '../core/marks'

  /**
   * The four permanent panel rows' icons, as vectors rather than the ★/☰/🔗/♪
   * text glyphs they replace (v27 fix).
   *
   * Those four glyphs come from three different fonts (🔗 is a colour emoji,
   * the rest are text) and their advance widths ran 9.5px…18px at the same
   * font-size. In a fixed-width slot that staggered every icon's left edge AND
   * every icon-to-label gap by up to 4px — no amount of centring, padding or
   * per-glyph font-size tuning can fix that, because the raggedness IS the
   * font metrics. A vector box is exactly as wide as it says it is, so all
   * four now share one left edge and one gap by construction — the same
   * reasoning that moved the Tracks header's ☰ and the criteria lock to SVG.
   */
  interface IconPath {
    d: string
    /** Stroked outline; omitted means a solid fill. */
    stroke?: boolean
  }

  interface IconSpec {
    /** Chosen so the drawn ink fills the box — a viewBox with slack of its own
     *  would re-introduce the very margins this component exists to remove. */
    viewBox: string
    paths: readonly IconPath[]
    /** User-unit width for this icon's stroked paths. */
    strokeWidth?: number
  }

  // A Record (not an {#if} chain): a fifth PANEL_FILTERS row then fails to
  // compile here instead of silently rendering no icon.
  const ICONS: Record<PanelFilterKey, IconSpec> = {
    starred: {
      viewBox: '0 0 16 16',
      paths: [
        {
          d: 'M8 .76 10.29 5.61 15.61 6.29 11.71 9.97 12.7 15.23 8 12.66 3.3 15.23 4.29 9.97 .39 6.29 5.71 5.61z',
        },
      ],
    },
    // Three bars, same construction as the Tracks header's ☰ toggle.
    constellation: {
      viewBox: '0 0 16 16',
      paths: [
        { d: 'M1 2h14a1 1 0 0 1 0 2H1a1 1 0 0 1 0-2z' },
        { d: 'M1 7h14a1 1 0 0 1 0 2H1a1 1 0 0 1 0-2z' },
        { d: 'M1 12h14a1 1 0 0 1 0 2H1a1 1 0 0 1 0-2z' },
      ],
    },
    combos: {
      viewBox: '0 0 24 24',
      strokeWidth: 2.4,
      paths: [
        { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', stroke: true },
        { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', stroke: true },
      ],
    },
    keys: {
      viewBox: '3 1.8 19.2 19.2',
      strokeWidth: 2.4,
      paths: [
        { d: 'M9 18V5l12-2v13', stroke: true },
        { d: 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
        { d: 'M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
      ],
    },
  }

  interface Props {
    key: PanelFilterKey
    /** Rendered size in px; the icon fills it edge to edge. */
    size?: number
  }
  const { key, size = 14 }: Props = $props()
  const spec = $derived(ICONS[key])
</script>

<svg viewBox={spec.viewBox} width={size} height={size} aria-hidden="true">
  {#each spec.paths as path (path.d)}
    <path
      d={path.d}
      fill={path.stroke === true ? 'none' : 'currentColor'}
      stroke={path.stroke === true ? 'currentColor' : 'none'}
      stroke-width={path.stroke === true ? spec.strokeWidth : undefined}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {/each}
</svg>
