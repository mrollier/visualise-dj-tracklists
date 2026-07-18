import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
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

export default app
