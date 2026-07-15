import { ensureExtension } from '../core/exporters/filename'

/**
 * Ask the user to name an export before saving (ISSUES.md #15). Returns the
 * filename with the extension guaranteed, or null when they cancel (or clear
 * the field) — the caller aborts the download then.
 */
export function promptExportName(defaultBase: string, ext: string): string | null {
  const answer = prompt('File name', defaultBase)
  if (answer === null || answer.trim() === '') return null
  return ensureExtension(answer, ext)
}
