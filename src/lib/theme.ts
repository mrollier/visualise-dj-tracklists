import { derived, get, writable } from 'svelte/store'
import type { ThemeName } from '../core/scales'
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

/** Start following the system preference and stamping <html data-theme>. */
export function startTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  const track = () => systemTheme.set(media.matches ? 'light' : 'dark')
  track()
  media.addEventListener('change', track)
  effectiveTheme.subscribe((theme) => {
    document.documentElement.dataset.theme = theme
  })
}

export function toggleTheme(): void {
  const next = get(effectiveTheme) === 'dark' ? 'light' : 'dark'
  settings.update((s) => ({ ...s, theme: next }))
}
