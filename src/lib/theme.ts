import { derived, get, writable } from 'svelte/store'
import { ACCENT_TOKENS, type ThemeName } from '../core/scales'
import { settings } from '../stores'

/**
 * Theme plumbing (design-v5 §E): the dark tokens live on :root, light
 * overrides on :root[data-theme='light']. A fresh visitor follows the system
 * preference; the top-bar toggle stores an explicit choice in settings
 * (persisted with the project).
 */

const systemTheme = writable<ThemeName>('dark')

export const effectiveTheme = derived(
  [settings, systemTheme],
  ([$settings, $system]) => $settings.theme ?? $system,
)

/**
 * Start following the system preference and stamping <html data-theme>.
 * The colour scheme's accent family is stamped as inline CSS variables at
 * the same time (issue 13): app.css carries the blue defaults; the active
 * scheme overrides them from ACCENT_TOKENS in src/core/scales.ts.
 */
export function startTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  const track = () => systemTheme.set(media.matches ? 'light' : 'dark')
  track()
  media.addEventListener('change', track)
  const accentSource = derived(
    [effectiveTheme, settings],
    ([$theme, $settings]) => ACCENT_TOKENS[$theme][$settings.colorScheme],
  )
  effectiveTheme.subscribe((theme) => {
    document.documentElement.dataset.theme = theme
  })
  accentSource.subscribe((tokens) => {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value)
    }
  })
}

export function toggleTheme(): void {
  const next = get(effectiveTheme) === 'dark' ? 'light' : 'dark'
  settings.update((s) => ({ ...s, theme: next }))
}
