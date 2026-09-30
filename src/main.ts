import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { restoreAutosave } from './lib/autosave'

// The saved project is read before anything renders, so no view ever shows
// (or saves) the empty state the restore is about to replace. index.html
// shows a loading line meanwhile.
const target = document.getElementById('app')!
void restoreAutosave().finally(() => {
  target.replaceChildren()
  mount(App, { target })
})

// PWA (v12 WS11): production builds register the offline-shell worker; dev
// stays worker-free so Vite's module graph is never cached in the way.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Best-effort: the app works identically without it, just not offline.
    })
  })
}
