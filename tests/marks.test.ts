import { describe, expect, test } from 'vitest'
import {
  comboIdSet,
  isMarkFilterKey,
  MARK_FILTER_KEYS,
  starredIdSet,
  type MarkFilterKey,
} from '../src/core/marks'
import type { ManualEdge } from '../src/core/model'

describe('starredIdSet (v18 #3/#8)', () => {
  test('collects must-include ids, deduped', () => {
    expect(starredIdSet(['a', 'b', 'a'], null, null)).toEqual(new Set(['a', 'b']))
  })

  test('includes both pins even when neither is in must-include', () => {
    expect(starredIdSet([], 'first-id', 'last-id')).toEqual(new Set(['first-id', 'last-id']))
  })

  test('unions must-include and the pins, deduping an id that is both', () => {
    expect(starredIdSet(['a', 'b'], 'b', 'c')).toEqual(new Set(['a', 'b', 'c']))
  })

  test('null pins and an empty must-include yield an empty set', () => {
    expect(starredIdSet([], null, null)).toEqual(new Set())
  })
})

describe('comboIdSet (v18 #3/#8)', () => {
  const edges: ManualEdge[] = [
    { a: 'x', b: 'y' },
    { a: 'y', b: 'z', tag: 'mashup' },
  ]

  test('collects both endpoints of every edge, deduped', () => {
    expect(comboIdSet(edges)).toEqual(new Set(['x', 'y', 'z']))
  })

  test('no edges yields an empty set', () => {
    expect(comboIdSet([])).toEqual(new Set())
  })
})

describe('MARK_FILTER_KEYS / isMarkFilterKey (v18 #3/#8)', () => {
  test('the two pseudo-keys are starred and combos, in that order', () => {
    expect(MARK_FILTER_KEYS).toEqual(['starred', 'combos'])
  })

  test('recognizes only the two pseudo-keys', () => {
    const keys: MarkFilterKey[] = ['starred', 'combos']
    for (const k of keys) expect(isMarkFilterKey(k)).toBe(true)
    expect(isMarkFilterKey('bpm')).toBe(false)
    expect(isMarkFilterKey('nonsense')).toBe(false)
    expect(isMarkFilterKey('')).toBe(false)
  })
})
