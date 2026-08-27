import { describe, expect, test } from 'vitest'
import { estimateMinutes } from '../src/lib/analysisHelper'

describe('estimateMinutes (v38)', () => {
  test('scales from the measured v34 run rate — 2040 tracks in ~122 min', () => {
    expect(estimateMinutes(2040)).toBe(123)
  })

  test('a small playlist rounds up to at least one minute', () => {
    expect(estimateMinutes(1)).toBe(1)
    expect(estimateMinutes(0)).toBe(0)
  })
})
