import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { linkArmed, manualEdges, selectedId, selectOrLink } from '../src/stores'

// v14 WS10: the link-mode click block (formerly duplicated verbatim in the
// wheel's select() and the tracks table's selectRow()) now lives in stores.
describe('selectOrLink', () => {
  beforeEach(() => {
    manualEdges.set([])
    selectedId.set(null)
    linkArmed.set(false)
  })
  afterEach(() => {
    manualEdges.set([])
    selectedId.set(null)
    linkArmed.set(false)
  })

  test('armed + different id → toggles the edge, selection unchanged', () => {
    selectedId.set('a')
    linkArmed.set(true)

    selectOrLink('b')

    expect(get(manualEdges)).toEqual([{ a: 'a', b: 'b' }])
    // The selection stays on the source so marks chain.
    expect(get(selectedId)).toBe('a')
  })

  test('armed + different id again → un-marks the same edge (toggle semantics)', () => {
    selectedId.set('a')
    linkArmed.set(true)

    selectOrLink('b')
    selectOrLink('b')

    expect(get(manualEdges)).toEqual([])
    expect(get(selectedId)).toBe('a')
  })

  test('unarmed → toggles the selection, never touching edges', () => {
    selectOrLink('a')
    expect(get(selectedId)).toBe('a')
    expect(get(manualEdges)).toEqual([])

    // Clicking the same id again clears the selection.
    selectOrLink('a')
    expect(get(selectedId)).toBe(null)
    expect(get(manualEdges)).toEqual([])
  })

  test('armed but no selection → falls through to the selection toggle', () => {
    linkArmed.set(true)
    selectedId.set(null)

    selectOrLink('a')

    // selectedId was null, so the guard fails and it behaves like a plain click.
    expect(get(selectedId)).toBe('a')
    expect(get(manualEdges)).toEqual([])
  })

  test('armed + same id → the id !== selectedId guard blocks a self-edge', () => {
    selectedId.set('a')
    linkArmed.set(true)

    selectOrLink('a')

    // No self-edge is created, and the early return leaves the selection intact.
    expect(get(manualEdges)).toEqual([])
    expect(get(selectedId)).toBe('a')
  })
})
