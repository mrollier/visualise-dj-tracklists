import { describe, expect, test } from 'vitest'
import { buildSetPortrait, type PortraitOptions } from '../src/core/exporters/portrait'
import { track } from './helpers'

function options(over: Partial<PortraitOptions> = {}): PortraitOptions {
  const walk = [
    track({
      id: 'a',
      title: 'Title a',
      artist: 'Artist a',
      key: '8A',
      bpm: 122,
      genre: 'techno',
      year: 2020,
    }),
    track({
      id: 'b',
      title: 'Title b',
      artist: 'Artist b',
      key: '9A',
      bpm: 125,
      genre: 'techno',
      year: 2020,
    }),
    track({
      id: 'c',
      title: 'Title c',
      artist: 'Artist c',
      key: '9B',
      bpm: 128,
      genre: 'techno',
      year: 2020,
    }),
  ]
  return {
    setName: 'Saturday Closing',
    libraryName: 'My crate',
    walk,
    library: [
      ...walk,
      track({
        id: 'd',
        title: 'Title d',
        artist: 'Artist d',
        key: '3B',
        bpm: 140,
        genre: 'techno',
        year: 2020,
      }),
    ],
    radialAxis: 'bpm',
    theme: 'dark',
    scheme: 'blue',
    date: '2026-07-18',
    ...over,
  }
}

describe('buildSetPortrait (v12 WS3)', () => {
  test('emits a standalone SVG document', () => {
    const svg = buildSetPortrait(options())
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox=')
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })

  test('draws one numbered badge per walk track and n−1 walk edges', () => {
    const svg = buildSetPortrait(options())
    expect(svg.match(/class="walk-node"/g)?.length).toBe(3)
    expect(svg.match(/class="walk-edge"/g)?.length).toBe(2)
    // The side list numbers every row.
    expect(svg).toContain('Title a')
    expect(svg).toContain('Title c')
    expect(svg).toContain('Saturday Closing')
    expect(svg).toContain('2026-07-18')
  })

  test('escapes XML in titles and artists', () => {
    const svg = buildSetPortrait(
      options({
        walk: [
          track({
            id: 'x',
            title: 'Drum & Bass <live>',
            artist: 'A & B',
            key: '8A',
            bpm: 124,
            genre: 'techno',
            year: 2020,
          }),
        ],
      }),
    )
    expect(svg).toContain('Drum &amp; Bass &lt;live&gt;')
    expect(svg).not.toContain('<live>')
  })

  test('theme picks the background: dark vs light differ', () => {
    const dark = buildSetPortrait(options({ theme: 'dark' }))
    const light = buildSetPortrait(options({ theme: 'light' }))
    expect(dark).toContain('#0b0b0b')
    expect(light).toContain('#e9e7e1')
  })

  test('keyless walk tracks park in the gutter right of the wheel', () => {
    const svg = buildSetPortrait(
      options({
        walk: [
          track({
            id: 'nk',
            title: 'Title nk',
            artist: 'Artist nk',
            key: null,
            bpm: 124,
            genre: 'techno',
            year: 2020,
          }),
        ],
      }),
    )
    const m = svg.match(/class="walk-node" transform="translate\(([\d.]+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(700) // past the wheel's rim
  })

  test('an empty walk still renders the wheel without badges', () => {
    const svg = buildSetPortrait(options({ walk: [] }))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('class="walk-node"')
  })

  test('same-slot badges separate enough to stay legible', () => {
    // Three walk tracks on the same key at the same BPM would overlap almost
    // perfectly under the wheel placement; the poster pushes its numbered
    // badges apart so every number stays readable.
    const walk = [
      track({
        id: 'a',
        title: 'Title a',
        artist: 'Artist a',
        key: '8A',
        bpm: 124,
        genre: 'techno',
        year: 2020,
      }),
      track({
        id: 'b',
        title: 'Title b',
        artist: 'Artist b',
        key: '8A',
        bpm: 124,
        genre: 'techno',
        year: 2020,
      }),
      track({
        id: 'c',
        title: 'Title c',
        artist: 'Artist c',
        key: '8A',
        bpm: 124,
        genre: 'techno',
        year: 2020,
      }),
    ]
    const svg = buildSetPortrait(options({ walk, library: walk }))
    const coords = [
      ...svg.matchAll(/class="walk-node" transform="translate\(([\d.-]+) ([\d.-]+)\)"/g),
    ].map((m) => [Number(m[1]), Number(m[2])] as const)
    expect(coords.length).toBe(3)
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        const d = Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1])
        expect(d).toBeGreaterThanOrEqual(20)
      }
    }
  })
})
