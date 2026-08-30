import { describe, expect, test } from 'vitest'
import {
  canAddSet,
  freshFirstSet,
  MAX_SETS,
  moveItem,
  newSetId,
  nextSetName,
  ordinalSetName,
  removeAllOccurrences,
  shortenLegacySetName,
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
  test('counts upward in bare ordinals', () => {
    expect(ordinalSetName(0)).toBe('First')
    expect(ordinalSetName(1)).toBe('Second')
    expect(ordinalSetName(2)).toBe('Third')
    expect(ordinalSetName(11)).toBe('Twelfth')
  })

  test('past the ordinals it falls back to the bare number', () => {
    expect(ordinalSetName(12)).toBe('13')
    expect(ordinalSetName(99)).toBe('100')
  })
})

describe('shortenLegacySetName', () => {
  test('strips the noun from an untouched pre-v17 default', () => {
    expect(shortenLegacySetName('First Constellation')).toBe('First')
    expect(shortenLegacySetName('Twelfth Constellation')).toBe('Twelfth')
    expect(shortenLegacySetName('Constellation 13')).toBe('13')
  })

  test('leaves a name the user chose alone', () => {
    expect(shortenLegacySetName('peak time bangers')).toBe('peak time bangers')
    expect(shortenLegacySetName('My Constellation')).toBe('My Constellation')
    expect(shortenLegacySetName('Constellation')).toBe('Constellation')
    expect(shortenLegacySetName('First')).toBe('First')
  })
})

describe('nextSetName', () => {
  test('advances past the names already taken', () => {
    expect(nextSetName([])).toBe('First')
    expect(nextSetName(['First'])).toBe('Second')
    expect(nextSetName(['First', 'Second'])).toBe('Third')
  })

  test('counts the EXISTING sets, custom names included (v9 issue 18)', () => {
    // The reported bug: two renamed sets, add a third → it said "First".
    expect(nextSetName(['warm-up', 'peak time bangers'])).toBe('Third')
    expect(nextSetName(['Second', 'peak time bangers'])).toBe('Third')
  })

  test('scans past taken ordinals beyond the count', () => {
    expect(nextSetName(['First', 'Third'])).toBe('Fourth')
  })
})

describe('uniqueSetName (v9 issue 18)', () => {
  test('a free name passes through untouched', () => {
    expect(uniqueSetName('Peak time', ['First'])).toBe('Peak time')
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

  test('freshFirstSet builds an un-generated First constellation around the given tracks', () => {
    const set = freshFirstSet(['a', 'b'])
    expect(set.name).toBe('First')
    expect(set.trackIds).toEqual(['a', 'b'])
    expect(set.generated).toBe(false)
    expect(set.id.length).toBeGreaterThan(0)
    expect(freshFirstSet().trackIds).toEqual([])
  })

  test('takes ownership of the supplied track ids', () => {
    const supplied = ['a']
    const set = freshFirstSet(supplied)
    supplied.push('b')

    expect(set.trackIds).toEqual(['a'])
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

describe('moveItem', () => {
  test('moves an item down to a later gap', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd'])
  })

  test('moves an item up to an earlier gap', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  test('gap 0 puts the item first, gap length puts it last', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a'])
  })

  test('the two gaps flanking the item are both no-ops', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'b', 'c'])
  })

  test('duplicate ids move by position, not by identity', () => {
    expect(moveItem(['a', 'b', 'a'], 2, 0)).toEqual(['a', 'a', 'b'])
  })

  test('an out-of-range index is a no-op', () => {
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['a', 'b'])
  })

  test('never mutates the input', () => {
    const ids = ['a', 'b', 'c']
    moveItem(ids, 0, 3)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})
