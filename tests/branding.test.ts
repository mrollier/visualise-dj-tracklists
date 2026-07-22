import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// legal/README.md §1: "Camelot" / "Camelot Wheel" is a Mixed In Key trademark.
// The 1A-12B NOTATION is free to use and stays; branding our own wheel as "the
// Camelot wheel" is the line. This guards the user-facing surface only —
// internal identifiers (CamelotKey, camelotNumber, ...) are deliberately exempt.
const USER_FACING = [
  'public/manifest.webmanifest',
  'src/App.svelte',
  'src/lib/TourOverlay.svelte',
  'src/lib/CriteriaPanel.svelte',
  'src/lib/WheelView.svelte',
]

describe('trademark hygiene', () => {
  test('no user-facing file brands the wheel as a Camelot wheel', () => {
    for (const path of USER_FACING) {
      const text = readFileSync(path, 'utf8')
      expect(text.toLowerCase(), `${path} brands the wheel with the trademark`).not.toContain(
        'camelot wheel',
      )
      expect(text.toLowerCase(), `${path} brands the wheel with the trademark`).not.toContain(
        'camelot-wheel',
      )
    }
  })
})
