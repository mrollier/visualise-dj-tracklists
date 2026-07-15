// Drives the running dev server (npm run dev) through the main flows and
// saves screenshots. Usage: node scripts/screenshot.mjs [output-dir]
import { chromium } from 'playwright'

const scratch = process.argv[2] ?? 'screenshots'
const { mkdirSync } = await import('node:fs')
mkdirSync(scratch, { recursive: true })
const errors = []

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
} catch {
  browser = await chromium.launch() // fall back to bundled if present
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('http://localhost:5173')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.getByText('Your library as a web of combos').waitFor()
await page.screenshot({ path: `${scratch}/01-empty.png` })

await page.getByRole('button', { name: 'Load sample' }).click()
await page.getByText('combo suggestions').waitFor()
await page.screenshot({ path: `${scratch}/02-wheel.png` })

// hover a node to show the tooltip
const node = page.locator('g.node[aria-label*="Seven Bridges"]')
await node.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/03-tooltip.png` })

// click to select → focus dimming; suggest a set from the selection
await node.click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/04-selected.png` })
await page.getByRole('button', { name: /Suggest a set/ }).click()
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.screenshot({ path: `${scratch}/05-suggested-set.png` })

// filters: open panel, restrict genre
await page.locator('summary', { hasText: 'Filters' }).click()
await page.locator('summary', { hasText: 'Genres' }).click()
await page.getByRole('button', { name: 'None' }).click()
await page.getByRole('checkbox', { name: 'Drum & Bass' }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/06-genre-filter.png` })
await page.getByRole('button', { name: 'All' }).click()

// advanced menu: switch genre method to graph
await page.getByRole('button', { name: /Advanced/ }).click()
await page.locator('.panel select').first().selectOption('graph')
await page.screenshot({ path: `${scratch}/07-advanced.png` })
await page.keyboard.press('Escape')

// colour axis auto-swap when radius = rating
await page.locator('header select').first().selectOption('rating')
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/08-color-swap.png` })
await page.locator('header select').first().selectOption('bpm')

// zoom
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/09-zoomed.png` })
await page.getByRole('button', { name: 'Reset zoom' }).click()

// M3U8 import becomes the set (3 matched + 1 new track)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/playlist.m3u8')
await page.getByText('4 tracks', { exact: true }).waitFor()
await page.screenshot({ path: `${scratch}/10-m3u-import.png` })

// export the set as M3U8
const downloadPromise = page.waitForEvent('download')
await page.getByRole('button', { name: 'Export M3U8' }).click()
const download = await downloadPromise
await download.saveAs(`${scratch}/exported.m3u8`)

// reload → autosave restores everything (give the debounced save time to flush)
await page.waitForTimeout(700)
await page.reload()
await page.getByText('combo suggestions').waitFor()
await page.getByText('4 tracks', { exact: true }).waitFor()
await page.screenshot({ path: `${scratch}/11-restored.png` })

// import a real Rekordbox XML export through the UI
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox.xml')
await page.getByText('4 tracks imported').waitFor()
await page.screenshot({ path: `${scratch}/12-rekordbox-import.png` })

// reset with confirmation dialog
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await page.getByText('Reset everything?').waitFor()
await page.screenshot({ path: `${scratch}/13-reset-dialog.png` })
await page.getByRole('button', { name: 'Reset everything' }).click()
await page.getByText('Your library as a web of combos').waitFor()
await page.screenshot({ path: `${scratch}/14-after-reset.png` })

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
