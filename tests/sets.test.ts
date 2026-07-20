import { describe, expect, test } from 'vitest'
import {
  canAddSet,
  freshFirstSet,
  MAX_SETS,
  newSetId,
  nextSetName,
  ordinalSetName,
  removeAllOccurrences,
  uniqueSetName,
} from '../src/core/sets'

describe('the set cap (v8 issue 18)', () => {
  test('eight sets at most; canAddSet gates the switcher and the generator', () => {
    expect(MAX_SETS).toBe(8)
    const seven = Array.from({ length: 7 }, () => freshFirstSet())
    expect(canAddSet(seven)).toBe(true)
    expect(canAddSet([...seven, freshFirstSet()])).toBe(false)
  })
})

describe('ordinalSetName', () => {
  test('names the first twelve sets with ordinal words', () => {
    expect(ordinalSetName(0)).toBe('First Constellation')
    expect(ordinalSetName(1)).toBe('Second Constellation')
    expect(ordinalSetName(2)).toBe('Third Constellation')
    expect(ordinalSetName(11)).toBe('Twelfth Constellation')
  })

  test('falls back to numbers beyond the twelfth', () => {
    expect(ordinalSetName(12)).toBe('Constellation 13')
    expect(ordinalSetName(99)).toBe('Constellation 100')
  })
})

describe('nextSetName', () => {
  test('advances past the names already taken', () => {
    expect(nextSetName([])).toBe('First Constellation')
    expect(nextSetName(['First Constellation'])).toBe('Second Constellation')
    expect(nextSetName(['First Constellation', 'Second Constellation'])).toBe('Third Constellation')
  })

  test('counts the EXISTING sets, custom names included (v9 issue 18)', () => {
    // The reported bug: two renamed sets, add a third → it said "First Constellation".
    expect(nextSetName(['warm-up', 'peak time bangers'])).toBe('Third Constellation')
    expect(nextSetName(['Second Constellation', 'peak time bangers'])).toBe('Third Constellation')
  })

  test('scans past taken ordinals beyond the count', () => {
    expect(nextSetName(['First Constellation', 'Third Constellation'])).toBe('Fourth Constellation')
  })
})

describe('uniqueSetName (v9 issue 18)', () => {
  test('a free name passes through untouched', () => {
    expect(uniqueSetName('Peak time', ['First Constellation'])).toBe('Peak time')
  })

  test('clashes get a file-manager suffix, counting past taken ones', () => {
    expect(uniqueSetName('Peak time', ['Peak time'])).toBe('Peak time (2)')
    expect(uniqueSetName('Peak time', ['Peak time', 'Peak time (2)'])).toBe('Peak time (3)')
  })
})

describe('newSetId / freshFirstSet', () => {
  test('ids are unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newSetId()))
    expect(ids.size).toBe(100)
  })

  test('freshFirstSet builds an un-generated First Constellation around the given tracks', () => {
    const set = freshFirstSet(['a', 'b'])
    expect(set.name).toBe('First Constellation')
    expect(set.trackIds).toEqual(['a', 'b'])
    expect(set.generated).toBe(false)
    expect(set.id.length).toBeGreaterThan(0)
    expect(freshFirstSet().trackIds).toEqual([])
  })
})

describe('removeAllOccurrences (v9 issue 14)', () => {
  test('removes every slot holding the track, keeping the rest in order', () => {
    expect(removeAllOccurrences(['a', 'b', 'a', 'c', 'a'], 'a')).toEqual(['b', 'c'])
  })

  test('an absent id leaves the list untouched (same contents, new array not required)', () => {
    expect(removeAllOccurrences(['a', 'b'], 'z')).toEqual(['a', 'b'])
  })

  test('never mutates the input', () => {
    const ids = ['a', 'b', 'a']
    removeAllOccurrences(ids, 'a')
    expect(ids).toEqual(['a', 'b', 'a'])
  })
})
