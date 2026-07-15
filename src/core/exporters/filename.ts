/**
 * Append `ext` (e.g. '.m3u8') to a user-typed export name unless it already
 * ends with it (case-insensitive). Surrounding whitespace is trimmed; any
 * other dot-suffix is treated as part of the name, not an extension.
 */
export function ensureExtension(name: string, ext: string): string {
  const trimmed = name.trim()
  return trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? trimmed : `${trimmed}${ext}`
}
