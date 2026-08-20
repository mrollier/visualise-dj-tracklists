import { describe, expect, test } from 'vitest'
import { clampSeek, resolveDuration } from '../src/core/audio/transport'

describe('resolveDuration', () => {
  test('prefers the element, which knows the real file', () => {
    expect(resolveDuration(371.4, 372)).toBe(371.4)
  })

  test('falls back to the library duration while metadata is still loading', () => {
    expect(resolveDuration(NaN, 372)).toBe(372)
  })

  test('falls back for a streaming-style infinite duration', () => {
    expect(resolveDuration(Infinity, 372)).toBe(372)
  })

  test('is null when neither source knows', () => {
    expect(resolveDuration(NaN, null)).toBe(null)
  })

  test('treats a zero-length element duration as unknown', () => {
    expect(resolveDuration(0, 372)).toBe(372)
  })
})

describe('clampSeek', () => {
  test('passes a position inside the track through', () => {
    expect(clampSeek(30, 372)).toBe(30)
  })

  test('clamps past the end', () => {
    expect(clampSeek(400, 372)).toBe(372)
  })

  test('clamps before the start', () => {
    expect(clampSeek(-5, 372)).toBe(0)
  })

  test('refuses to seek at all when the duration is unknown', () => {
    expect(clampSeek(30, null)).toBe(0)
  })

  test('treats a non-finite request as the start', () => {
    expect(clampSeek(NaN, 372)).toBe(0)
  })
})
