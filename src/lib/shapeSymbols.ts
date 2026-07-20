import {
  symbol,
  symbolCircle,
  symbolDiamond,
  symbolSquare,
  symbolStar,
  symbolTriangle,
  symbolWye,
  type SymbolType,
} from 'd3-shape'

/**
 * Genre-class node shapes (docs/designs/design-v4.md §E): class 0 (largest)
 * keeps the circle; further classes get increasingly angular symbols. Shared
 * verbatim by the wheel and the genre map.
 */
export const CLASS_SYMBOLS: SymbolType[] = [
  symbolCircle,
  symbolSquare,
  symbolTriangle,
  symbolDiamond,
  symbolStar,
  symbolWye,
]

/**
 * Build a render-time memo of static symbol-path strings, keyed by
 * `${moddedClassIndex}:${r}`. A plain (non-reactive) Map on purpose: these are
 * pure static path strings, never a reactive source — that's why this lives in
 * a `.ts` module rather than a component (no `svelte/prefer-svelte-reactivity`
 * disable needed here). `classIndex === null` maps to a circle (key index -1);
 * other indices wrap via modulo over `CLASS_SYMBOLS`.
 */
export function createShapePathCache(
  symbols: SymbolType[] = CLASS_SYMBOLS,
): (classIndex: number | null, r: number) => string {
  const cache = new Map<string, string>()
  return (classIndex: number | null, r: number): string => {
    const idx = classIndex === null ? -1 : classIndex % symbols.length
    const key = `${idx}:${r}`
    let path = cache.get(key)
    if (path === undefined) {
      const type = idx === -1 ? symbolCircle : symbols[idx]
      path =
        symbol()
          .type(type)
          .size(Math.PI * r * r)() ?? ''
      cache.set(key, path)
    }
    return path
  }
}
