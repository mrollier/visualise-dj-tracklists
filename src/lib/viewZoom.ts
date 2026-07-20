import { select as d3select, type Selection } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom'

export interface ViewZoomOptions {
  /** d3-zoom scale extent, e.g. `[0.5, 8]` for the wheel, `[0.4, 6]` for the map. */
  scaleExtent: [number, number]
  /** Called on every zoom event; the component writes its own `$state`
   *  primitives (transform string, k) from here — never store the behaviour. */
  onZoom: (transform: ZoomTransform) => void
  /** Disable native double-click-to-zoom (the wheel uses dblclick to append). */
  disableDblClick?: boolean
  /** Optional gesture filter (the genre map rejects drag-starts on nodes so its
   *  own pointer-capture drag wins). Wheel events should stay accepted. */
  filter?: (event: MouseEvent | WheelEvent | TouchEvent) => boolean
}

export interface ViewZoom {
  /** Bind the behaviour to the SVG element; returns the `$effect` teardown. */
  attach(el: SVGSVGElement): () => void
  zoomBy(factor: number): void
  zoomReset(): void
}

/**
 * Shared d3-zoom setup for the wheel and genre-map views.
 *
 * d3-ownership hazard: the zoom `behavior` and the attached `selection` are
 * third-party-owned objects and live ONLY in these plain closure variables.
 * They must never be assigned into a component's `$state` — Svelte 5 deep
 * proxies silently swallow writes to them and zooming stops working. The
 * component keeps only PRIMITIVES (transform string, k) in `$state`, written
 * from its `onZoom` callback.
 */
export function createViewZoom(options: ViewZoomOptions): ViewZoom {
  const behavior = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent(options.scaleExtent)
    .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => options.onZoom(e.transform))
  if (options.filter !== undefined) behavior.filter(options.filter)

  // The attached selection is a plain closure var so zoomBy/zoomReset can reach
  // it without touching component state.
  let selection: Selection<SVGSVGElement, unknown, null, undefined> | null = null

  function attach(el: SVGSVGElement): () => void {
    selection = d3select(el)
    selection.call(behavior)
    if (options.disableDblClick === true) selection.on('dblclick.zoom', null)
    return () => {
      selection?.on('.zoom', null)
      selection = null
    }
  }

  function zoomBy(factor: number): void {
    if (selection !== null) behavior.scaleBy(selection, factor)
  }

  function zoomReset(): void {
    if (selection !== null) behavior.transform(selection, zoomIdentity)
  }

  return { attach, zoomBy, zoomReset }
}
