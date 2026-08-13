import { describe, expect, test } from 'vitest'
import { ghostWalkIds } from '../src/core/ghosts'

describe('ghostWalkIds (v18 #11)', () => {
  test('empty walk: nothing to ghost', () => {
    expect(ghostWalkIds([], new Set())).toEqual([])
  })

  test('every walk member visible: nothing to ghost', () => {
    expect(ghostWalkIds(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toEqual([])
  })

  test('a hidden member surfaces as a ghost id', () => {
    expect(ghostWalkIds(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['b'])
  })

  test('preserves first-occurrence order, not sorted or reversed', () => {
    expect(ghostWalkIds(['c', 'a', 'b'], new Set())).toEqual(['c', 'a', 'b'])
  })

  test('a repeated hidden id ghosts once, at its first occurrence', () => {
    expect(ghostWalkIds(['a', 'b', 'a', 'c'], new Set(['c']))).toEqual(['a', 'b'])
  })

  test('mixed visible/hidden walk keeps only the hidden ids, in walk order', () => {
    expect(ghostWalkIds(['a', 'b', 'c', 'd'], new Set(['b', 'd']))).toEqual(['a', 'c'])
  })
})
