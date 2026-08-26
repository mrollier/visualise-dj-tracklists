<script lang="ts">
  import type { PanelFilterKey } from '../core/marks'
  import type { DescriptorKey } from '../core/properties'

  /**
   * Icons for the left panel's non-plain filter rows: the four permanent panel
   * rows, as vectors rather than the ★/☰/🔗/♪ text glyphs they replace (v27
   * fix), and since v35.1 the four analysis descriptors, which are labelled by
   * a single letter in the rail and so lean on their icon to be recognisable.
   * The v27 reasoning below is exactly why those four are not emoji either.
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

  // A Record (not an {#if} chain): a fifth PANEL_FILTERS row or descriptor
  // then fails to compile here instead of silently rendering no icon.
  const ICONS: Record<PanelFilterKey | DescriptorKey, IconSpec> = {
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
    // The four descriptors (v35.1). Chosen to be distinguishable by SHAPE at
    // 14px, not by metaphor: a bolt is angular, the wave horizontal, the tone
    // mark a square and the smiley a circle — so the four never read as one
    // another in a stacked rail even before the eye resolves the drawing.
    // Arousal — intensity, as a bolt.
    arousal: {
      viewBox: '0 0 16 16',
      paths: [{ d: 'M9.5 0 2.8 9.2h4.1L6.3 16 13.2 6.6H8.9z' }],
    },
    // Valence — the negative↔positive axis, as the half-filled tone mark.
    // Square, not the usual circle, so it cannot be mistaken for happiness.
    valence: {
      viewBox: '0 0 16 16',
      strokeWidth: 1.5,
      paths: [
        {
          d: 'M3 1.6h10a1.4 1.4 0 0 1 1.4 1.4v10a1.4 1.4 0 0 1-1.4 1.4H3a1.4 1.4 0 0 1-1.4-1.4V3A1.4 1.4 0 0 1 3 1.6z',
          stroke: true,
        },
        { d: 'M3 1.6h5v12.8H3a1.4 1.4 0 0 1-1.4-1.4V3A1.4 1.4 0 0 1 3 1.6z' },
      ],
    },
    // Danceability — groove, as one period of a wave.
    danceability: {
      viewBox: '0 0 16 16',
      strokeWidth: 1.8,
      paths: [{ d: 'M1 8c1.75-5 5.25-5 7 0s5.25 5 7 0', stroke: true }],
    },
    // Happiness — the model's 'happy' class, as the one mark nobody has to
    // look up.
    happiness: {
      viewBox: '0 0 16 16',
      strokeWidth: 1.5,
      paths: [
        { d: 'M8 1.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 1 0 0-13.2z', stroke: true },
        { d: 'M5.8 6a1 1 0 1 0 0 2 1 1 0 1 0 0-2z' },
        { d: 'M10.2 6a1 1 0 1 0 0 2 1 1 0 1 0 0-2z' },
        { d: 'M5 9.7a3.4 3.4 0 0 0 6 0', stroke: true },
      ],
    },
  }

  interface Props {
    key: PanelFilterKey | DescriptorKey
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
