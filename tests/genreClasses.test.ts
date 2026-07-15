import { describe, expect, test } from 'vitest'
import { computeGenreClasses } from '../src/core/genreClasses'

describe('computeGenreClasses', () => {
  test('two clearly different families become two classes', () => {
    const genres = [
      'Deep House',
      'Deep House',
      'Tech House',
      'House',
      'Drum & Bass',
      'Liquid Drum & Bass',
    ]
    const result = computeGenreClasses(genres, 'hybrid', 4)
    expect(result).not.toBeNull()
    const { classOf, classes } = result!
    expect(classes).toHaveLength(2)
    expect(classOf.get('deep house')).toBe(classOf.get('tech house'))
    expect(classOf.get('deep house')).toBe(classOf.get('house'))
    expect(classOf.get('drum & bass')).toBe(classOf.get('liquid drum & bass'))
    expect(classOf.get('house')).not.toBe(classOf.get('drum & bass'))
  })

  test('classes come largest-first with a representative label', () => {
    const genres = ['Deep House', 'Deep House', 'Tech House', 'Drum & Bass']
    const { classes } = computeGenreClasses(genres, 'hybrid', 4)!
    expect(classes[0].label).toBe('deep house') // 3 house tracks > 1 dnb track
    expect(classes[0].size).toBe(3)
    expect(classes[1].size).toBe(1)
  })

  test('a homogeneous library forms no classes (everything stays a circle)', () => {
    const genres = ['House', 'Deep House', 'Tech House', 'Funky House']
    expect(computeGenreClasses(genres, 'hybrid', 4)).toBeNull()
  })

  test('respects the configured maximum number of classes', () => {
    const genres = ['Techno', 'Jazz', 'Reggae', 'Folk', 'Hip Hop', 'Classical']
    const result = computeGenreClasses(genres, 'hybrid', 2)
    expect(result).not.toBeNull()
    expect(result!.classes.length).toBeLessThanOrEqual(2)
  })

  test('is deterministic', () => {
    const genres = ['Techno', 'Minimal Techno', 'Jazz', 'Soul', 'Dubstep', 'Grime']
    const a = computeGenreClasses(genres, 'hybrid', 3)
    const b = computeGenreClasses(genres, 'hybrid', 3)
    expect(a).toEqual(b)
  })

  test('ignores missing genres and keys off the primary component', () => {
    const genres = ['House / Techno', null, 'Deep House', null, 'Drum & Bass']
    const result = computeGenreClasses(genres, 'hybrid', 4)
    expect(result).not.toBeNull()
    // "House / Techno" is classified by its first component.
    expect(result!.classOf.has('house')).toBe(true)
    expect(result!.classOf.get('house')).toBe(result!.classOf.get('deep house'))
  })

  test('fewer than two distinct genres yields null', () => {
    expect(computeGenreClasses(['Techno', 'Techno', null], 'hybrid', 4)).toBeNull()
    expect(computeGenreClasses([], 'hybrid', 4)).toBeNull()
  })
})
