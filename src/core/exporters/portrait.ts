import {
  ALL_CAMELOT_KEYS,
  camelotRing,
  normalizeKey,
  wheelSlotAngleDeg,
  type CamelotKey,
} from '../keys'
import { annularSectorPath, relaxSlotAngles, type SlotNode } from '../layout'
import type { Track } from '../model'
import { ACCENT_TOKENS, radialDomain, type ColorScheme, type ThemeName } from '../scales'
import {
  WALK_CHEVRON_D,
  WALK_CHEVRON_REF,
  WALK_CHEVRON_SIZE,
  WALK_CHEVRON_STROKE,
  WALK_CHEVRON_VIEW_BOX,
  walkChevronMid,
} from '../walkArrow'

/**
 * The set portrait (v12 WS3): the walk over the wheel as a standalone SVG
 * poster — title, date and the tracklist down the side. Pure string building,
 * no DOM; rasterisation to PNG lives in the lib layer. The palette mirrors
 * the app.css theme tokens; the wheel geometry mirrors WheelView (24 zigzag
 * slots, deterministic same-slot relaxation, ±4° fan cap).
 */

export interface PortraitOptions {
  setName: string
  libraryName: string
  /** The walk, resolved to tracks, in play order. */
  walk: Track[]
  /** The visible library, drawn as the faint backdrop the walk threads. */
  library: Track[]
  radialAxis: 'bpm' | 'rating' | 'year' | 'energy'
  theme: ThemeName
  scheme: ColorScheme
  /** Printed under the title; defaults to today (injectable for tests). */
  date?: string
}

/** Mirrors the app.css token block per theme (sync by eye, not imported). */
const SURFACES: Record<
  ThemeName,
  {
    page: string
    ink: string
    inkSecondary: string
    inkMuted: string
    grid: string
    sectorMinor: string
    sectorMajor: string
  }
> = {
  dark: {
    page: '#0b0b0b',
    ink: '#f2f2f0',
    inkSecondary: '#c3c2b7',
    inkMuted: '#8a8880',
    grid: '#2c2c2a',
    sectorMinor: 'rgba(124, 152, 255, 0.05)',
    sectorMajor: 'rgba(255, 196, 110, 0.045)',
  },
  light: {
    page: '#e9e7e1',
    ink: '#1d1d1b',
    inkSecondary: '#4c4b44',
    inkMuted: '#7d7b72',
    grid: '#dedcd4',
    sectorMinor: 'rgba(70, 100, 220, 0.06)',
    sectorMajor: 'rgba(200, 130, 20, 0.055)',
  },
}

const W = 1200
const H = 800
const CX = 400
const CY = 400
const R_MAX = 320
const R_MIN = 105
const R_FALLBACK = 68
const GUTTER_X = CX + R_MAX + 44 // keyless walk tracks park here
const PANEL_X = 828
const PANEL_RIGHT = 1160
const HALF_SPREAD_DEG = 4 // the v10 fan cap
const NODE_RADIUS_WORLD = 5

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function point(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  const round = (v: number) => Math.round(v * 100) / 100
  return [round(CX + r * Math.cos(rad)), round(CY + r * Math.sin(rad))]
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…'
}

interface Placed {
  x: number
  y: number
}

/**
 * Place every track with a key exactly like the wheel does: per-slot
 * deterministic relaxation at the radial metric's radius; a missing radial
 * value sits on the dashed fallback ring. Keyless tracks return null here and
 * are parked in the gutter by the caller.
 */
function placeTracks(
  tracks: Track[],
  axis: PortraitOptions['radialAxis'],
  scale: (v: number) => number,
): Map<string, Placed> {
  const bySlot = new Map<CamelotKey, { node: SlotNode; angle: number }[]>()
  const radiusOf = (t: Track): number => {
    const v = t[axis]
    return typeof v === 'number' && Number.isFinite(v) ? scale(v) : R_FALLBACK
  }
  for (const t of tracks) {
    const key = normalizeKey(t.key)
    if (key === null) continue
    const list = bySlot.get(key) ?? []
    list.push({ node: { id: t.id, r: radiusOf(t) }, angle: wheelSlotAngleDeg(key) })
    bySlot.set(key, list)
  }
  const out = new Map<string, Placed>()
  for (const entries of bySlot.values()) {
    const offsets = relaxSlotAngles(
      entries.map((e) => e.node),
      HALF_SPREAD_DEG,
      NODE_RADIUS_WORLD,
    )
    for (const { node, angle } of entries) {
      const [x, y] = point(angle + (offsets.get(node.id) ?? 0), node.r)
      out.set(node.id, { x, y })
    }
  }
  return out
}

/**
 * Push near-coincident badge centres apart until every pair sits at least
 * `minDist` apart — numbered badges are far bigger than the wheel's dots, so
 * a harmonically tight set would otherwise stack them unreadably. Symmetric
 * pairwise pushes, deterministic in walk order; coincident points break the
 * tie rightwards.
 */
function separateBadges(points: Placed[], minDist: number, iterations = 40): Placed[] {
  const pts = points.map((p) => ({ ...p }))
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x
        const dy = pts[j].y - pts[i].y
        const d = Math.hypot(dx, dy)
        if (d >= minDist) continue
        moved = true
        const ux = d < 0.01 ? 1 : dx / d
        const uy = d < 0.01 ? 0 : dy / d
        const push = (minDist - d) / 2
        pts[i].x -= ux * push
        pts[i].y -= uy * push
        pts[j].x += ux * push
        pts[j].y += uy * push
      }
    }
    if (!moved) break
  }
  return pts.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }))
}

export function buildSetPortrait(o: PortraitOptions): string {
  const S = SURFACES[o.theme]
  const accents = ACCENT_TOKENS[o.theme][o.scheme]
  const walkColor = accents['--walk']
  const walkBright = accents['--walk-bright']
  const badgeText = o.theme === 'dark' ? '#0b0b0b' : '#ffffff'
  const date = o.date ?? new Date().toISOString().slice(0, 10)

  // Radial scale over everything the poster shows, mirroring radialDomain.
  const values = [...o.library, ...o.walk]
    .map((t) => t[o.radialAxis])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const extent: [number, number] | null =
    values.length > 0 ? [Math.min(...values), Math.max(...values)] : null
  const [lo, hi] = radialDomain(null, extent)
  const scale = (v: number) => R_MIN + ((v - lo) / (hi - lo)) * (R_MAX - R_MIN)

  // One placement pass over library ∪ walk so backdrop and badges agree.
  const seen = new Set(o.library.map((t) => t.id))
  const everything = [...o.library, ...o.walk.filter((t) => !seen.has(t.id))]
  const placed = placeTracks(everything, o.radialAxis, scale)

  // Keyless walk tracks park in a little gutter column, in walk order.
  let gutterIndex = 0
  const positionOf = (t: Track): Placed => {
    const p = placed.get(t.id)
    if (p !== undefined) return p
    return { x: GUTTER_X, y: CY - R_MAX / 2 + 40 * gutterIndex++ }
  }
  const walkPositions = separateBadges(o.walk.map(positionOf), 23)

  const parts: string[] = []

  // Sectors + key labels.
  for (const key of ALL_CAMELOT_KEYS) {
    const angle = wheelSlotAngleDeg(key)
    const fill = camelotRing(key) === 'A' ? S.sectorMinor : S.sectorMajor
    parts.push(
      `<path d="${annularSectorPath(CX, CY, angle - 7.5, angle + 7.5, R_MIN - 6, R_MAX + 14)}" fill="${fill}" stroke="${S.grid}" stroke-width="0.5"/>`,
    )
    const [lx, ly] = point(angle, R_MAX + 34)
    const weight = camelotRing(key) === 'B' ? 600 : 400
    parts.push(
      `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="${weight}" fill="${S.inkSecondary}">${key}</text>`,
    )
  }

  // Radius grid: lo / mid / hi rings with labels up the 12 o'clock axis.
  const ticks = [lo, (lo + hi) / 2, hi]
  for (const t of ticks) {
    const r = scale(t)
    parts.push(
      `<circle cx="${CX}" cy="${CY}" r="${r.toFixed(1)}" fill="none" stroke="${S.grid}" stroke-width="0.6" stroke-dasharray="2 4"/>`,
      `<text x="${CX + 6}" y="${(CY - r + 12).toFixed(1)}" font-size="10.5" fill="${S.inkMuted}">${Math.round(t)}</text>`,
    )
  }
  parts.push(
    `<circle cx="${CX}" cy="${CY}" r="${R_FALLBACK}" fill="none" stroke="${S.grid}" stroke-width="0.8" stroke-dasharray="3 5"/>`,
  )

  // The library backdrop the walk threads through.
  const walkIds = new Set(o.walk.map((t) => t.id))
  for (const t of o.library) {
    if (walkIds.has(t.id)) continue
    const p = placed.get(t.id)
    if (p === undefined) continue
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="${S.inkMuted}" fill-opacity="0.45"/>`)
  }

  // The walk: edges with a mid-edge direction chevron, then numbered badges
  // on top — the badges' opaque page-coloured ring already covers where a
  // line meets a node, the same relationship the wheel has between edges
  // and stars.
  for (let i = 0; i < walkPositions.length - 1; i++) {
    const a = walkPositions[i]
    const b = walkPositions[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1) continue
    const mid = walkChevronMid(a.x, a.y, b.x, b.y)
    const points =
      mid === null
        ? `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
        : `${a.x.toFixed(1)},${a.y.toFixed(1)} ${mid.x.toFixed(1)},${mid.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
    parts.push(
      `<polyline class="walk-edge" points="${points}" fill="none" stroke="${walkColor}" stroke-width="2.4" marker-mid="url(#pa)"/>`,
    )
  }
  o.walk.forEach((_t, i) => {
    const p = walkPositions[i]
    parts.push(
      `<g class="walk-node" transform="translate(${p.x} ${p.y})">` +
        `<circle r="11" fill="${walkColor}" stroke="${S.page}" stroke-width="1.5"/>` +
        `<text text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="${badgeText}">${i + 1}</text>` +
        `</g>`,
    )
  })
  if (o.walk.some((t) => placed.get(t.id) === undefined)) {
    parts.push(
      `<text x="${GUTTER_X}" y="${CY - R_MAX / 2 - 22}" text-anchor="middle" font-size="10.5" letter-spacing="1" fill="${S.inkMuted}">NO KEY</text>`,
    )
  }

  // Side panel: title, meta, the tracklist, footer.
  const title = clip(o.setName, 26)
  const meta = [o.libraryName, date, `${o.walk.length} tracks`].filter((s) => s !== '').join(' · ')
  parts.push(
    `<text x="${PANEL_X}" y="86" font-size="27" font-weight="700" fill="${S.ink}">${esc(title)}</text>`,
    `<text x="${PANEL_X}" y="112" font-size="13" fill="${S.inkMuted}">${esc(meta)}</text>`,
    `<line x1="${PANEL_X}" y1="130" x2="${PANEL_RIGHT}" y2="130" stroke="${S.grid}" stroke-width="1"/>`,
  )
  const listTop = 158
  const listBottom = 742
  const maxRows = 24
  const rows = o.walk.slice(0, maxRows)
  const step = rows.length > 0 ? Math.min(28, (listBottom - listTop) / rows.length) : 0
  rows.forEach((t, i) => {
    const y = (listTop + i * step).toFixed(1)
    const label = `${clip(t.title, 30)}`
    const artist = t.artist !== null ? ` — ${clip(t.artist, 22)}` : ''
    const side = [t.key, t.bpm !== null ? String(Math.round(t.bpm)) : null]
      .filter((v) => v !== null)
      .join(' · ')
    parts.push(
      `<text x="${PANEL_X}" y="${y}" font-size="13" fill="${S.inkSecondary}">` +
        `<tspan fill="${walkBright}" font-weight="700">${String(i + 1).padStart(2, ' ')}</tspan>` +
        `<tspan dx="8" font-weight="600" fill="${S.ink}">${esc(label)}</tspan>` +
        `<tspan>${esc(artist)}</tspan></text>`,
      side === ''
        ? ''
        : `<text x="${PANEL_RIGHT}" y="${y}" text-anchor="end" font-size="11" fill="${S.inkMuted}">${esc(side)}</text>`,
    )
  })
  if (o.walk.length > maxRows) {
    parts.push(
      `<text x="${PANEL_X}" y="${(listTop + maxRows * step + 4).toFixed(1)}" font-size="12" fill="${S.inkMuted}">+ ${o.walk.length - maxRows} more</text>`,
    )
  }
  parts.push(
    `<text x="${PANEL_X}" y="775" font-size="11" fill="${S.inkMuted}">Zodiac Tracker — a constellation is a walk through your library</text>`,
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">` +
    `<defs><marker id="pa" viewBox="${WALK_CHEVRON_VIEW_BOX}" refX="${WALK_CHEVRON_REF}" refY="${WALK_CHEVRON_REF}" markerWidth="${WALK_CHEVRON_SIZE}" markerHeight="${WALK_CHEVRON_SIZE}" markerUnits="userSpaceOnUse" orient="auto">` +
    `<path d="${WALK_CHEVRON_D}" fill="none" stroke="${walkColor}" stroke-width="${WALK_CHEVRON_STROKE}" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>` +
    `<rect width="${W}" height="${H}" fill="${S.page}"/>` +
    parts.filter((p) => p !== '').join('\n') +
    `</svg>`
  )
}
