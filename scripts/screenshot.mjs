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
// Emulate a dark system preference: screenshots stay identical across
// machines, and the theme-toggle step below deterministically lands on light.
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
})
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

// genre-class shapes: the legend must carry shape chips for the sample
if ((await page.locator('.shape-chip').count()) === 0) {
  errors.push('no genre-class shape chips in the legend')
}

// static background: filtering must not rescale the axes or reshape nodes
const ticksBefore = await page.locator('text.tick-label').allTextContents()
const nodesBefore = await page.locator('g.node').count()
await page.locator('summary', { hasText: 'Filters' }).click()
await page.locator('.filter-row input').nth(2).fill('2021') // year min
await page.waitForTimeout(300)
const ticksFiltered = await page.locator('text.tick-label').allTextContents()
const nodesFiltered = await page.locator('g.node').count()
if (ticksFiltered.join() !== ticksBefore.join()) {
  errors.push(`filtering rescaled the radial ticks: ${ticksBefore} -> ${ticksFiltered}`)
}
if (nodesFiltered >= nodesBefore) {
  errors.push('year filter did not remove any nodes')
}
await page.locator('.filter-row input').nth(2).fill('')
await page.waitForTimeout(200)
await page.locator('summary', { hasText: 'Filters' }).click()

// hover a node to show the tooltip
const node = page.locator('g.node[aria-label*="Seven Bridges"]')
await node.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/03-tooltip.png` })

// click to select → focus dimming; suggest a set from the selection
await node.click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/04-selected.png` })
// shorter walks (8) keep unused neighbours around for the hub step below
await page.getByRole('button', { name: /Advanced/ }).click()
await page.locator('.panel input[type=number]').fill('8')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Suggest a set/ }).click()
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.screenshot({ path: `${scratch}/05-suggested-set.png` })

// suggestion history: two fresh suggestions, then back to the previous one
await page.getByRole('button', { name: /new/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: /new/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: /previous/ }).click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/06-suggestion-arrows.png` })

// pinned closer: at the history head, pin the last track, regenerate — the
// closer must survive (the opener is already covered by selection seeding)
await page.locator('.suggest-row .primary').click() // forward to head ("next ▶")
await page.waitForTimeout(200)
const lastTitle = await page.locator('aside ol li.track .names strong').last().textContent()
await page.locator('aside ol li.track').last().hover()
await page.locator('aside ol li.track .pin').last().click()
await page.locator('.suggest-row .primary').click() // fresh walk with the pin ("✨ new ▶")
await page.waitForTimeout(300)
const lastAfter = await page.locator('aside ol li.track .names strong').last().textContent()
if (lastAfter !== lastTitle) {
  errors.push(`pinned closer not honoured: "${lastTitle}" -> "${lastAfter}"`)
}
await page.locator('aside ol li.track').last().hover()
await page.locator('aside ol li.track .pin').last().click() // unpin

// hub button: suggest the next track (appends to the set)
const setCountBefore = await page.locator('aside ol li.track').count()
await page.locator('g.hub').click()
await page.waitForTimeout(200)
const setCountAfter = await page.locator('aside ol li.track').count()
if (setCountAfter !== setCountBefore + 1) {
  errors.push(`hub button did not append: ${setCountBefore} -> ${setCountAfter}`)
}
await page.screenshot({ path: `${scratch}/07-hub-next.png` })

// duplicate tracks: adding a track that is already in the set must work
// (it opens the set, so a second non-consecutive add is a duplicate)
const dupBefore = await page.locator('aside ol li.track').count()
await page.locator('g.node[aria-label*="Seven Bridges"]').dblclick()
await page.waitForTimeout(300)
const dupAfter = await page.locator('aside ol li.track').count()
if (dupAfter !== dupBefore + 1) {
  errors.push(`duplicate append failed: ${dupBefore} -> ${dupAfter}`)
}

// genre map view: overlays, all-method edge tooltip data, nearby ghosts
await page.getByRole('button', { name: 'Genres', exact: true }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'hybrid' }).click()
await page.getByRole('button', { name: 'taxonomy' }).click()
await page.getByRole('checkbox', { name: 'show nearby genres' }).check()
await page.waitForTimeout(1800)
const mapNodes = await page.locator('.genre-node').count()
const ghostNodes = await page.locator('.genre-node.ghost').count()
if (mapNodes === 0) errors.push('genre map rendered no nodes')
if (ghostNodes === 0) errors.push('genre map rendered no ghost neighbours')
await page.screenshot({ path: `${scratch}/07b-genre-map.png` })
await page.getByRole('button', { name: 'Wheel', exact: true }).click()
await page.waitForTimeout(200)

// filters: open panel, restrict genre; range inputs show library extremes
await page.locator('summary', { hasText: 'Filters' }).click()
const bpmMin = await page.locator('.filter-row input').first().inputValue()
if (bpmMin === '') errors.push('filter inputs not seeded with library extremes')
await page.locator('summary', { hasText: 'Genres' }).click()
await page.getByRole('button', { name: 'None', exact: true }).click()
await page.getByRole('checkbox', { name: 'Drum & Bass' }).check()
await page.waitForTimeout(300)
// the legend keeps every class, greying out the filtered-away ones
if ((await page.locator('.shape-chip.dimmed').count()) === 0) {
  errors.push('genre filtering did not grey out any legend class chips')
}
await page.screenshot({ path: `${scratch}/08-genre-filter.png` })
await page.getByRole('button', { name: 'All', exact: true }).click()

// advanced menu (now in the right aside, wheel stays visible): hybrid method
// with sourced explainer, top-k controls, split +2/+7 checkboxes, vinyl mode
await page.getByRole('button', { name: /Advanced/ }).click()
if ((await page.locator('aside.panel').count()) === 0) {
  errors.push('advanced settings did not open in the right aside')
}
await page.locator('.panel select').first().selectOption('hybrid')
if ((await page.locator('.panel .hint a').count()) === 0) {
  errors.push('method explainer carries no source links')
}
await page.getByText('Link each genre to its').waitFor() // top-k mode controls
await page.getByRole('radio').nth(1).check() // switch to threshold mode…
await page.getByText('Similarity ≥').waitFor()
await page.getByRole('radio').first().check() // …and back to mutual top-k
await page.getByRole('checkbox', { name: 'allow +2 moves', exact: false }).check()
await page.getByRole('checkbox', { name: 'allow +2 moves', exact: false }).uncheck()
// strict vinyl mode must visibly rewire the graph
const edgesBefore = await page.locator('.combo-edge').count()
await page.getByRole('checkbox', { name: 'vinyl mode' }).check()
await page.waitForTimeout(300)
const edgesVinyl = await page.locator('.combo-edge').count()
if (edgesVinyl === edgesBefore) {
  errors.push(`vinyl mode changed no edges (${edgesBefore} before and after)`)
}
await page.screenshot({ path: `${scratch}/09-advanced.png` })
await page.keyboard.press('Escape')
if ((await page.locator('aside.panel').count()) !== 0) {
  errors.push('Escape did not close the advanced aside')
}
await page.getByRole('checkbox', { name: /half\/double/ }).check()
await page.waitForTimeout(300)

// colour axis auto-swap when radius = rating
await page.locator('header select').first().selectOption('rating')
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/10-color-swap.png` })
await page.locator('header select').first().selectOption('bpm')

// zoom: node disks must keep their screen size
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/11-zoomed.png` })
await page.getByRole('button', { name: 'Reset zoom' }).click()

// M3U8 import becomes the set (3 matched + 1 new track)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/playlist.m3u8')
await page.getByText('4 tracks', { exact: true }).waitFor()
await page.screenshot({ path: `${scratch}/12-m3u-import.png` })

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
await page.screenshot({ path: `${scratch}/13-restored.png` })

// import a real Rekordbox XML export through the UI
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox.xml')
await page.getByText('4 tracks imported').waitFor()
await page.screenshot({ path: `${scratch}/14-rekordbox-import.png` })

// Rekordbox playlist TXT (UTF-16 TSV): becomes library AND set in file order
await page.locator('input[type=file]').setInputFiles('tests/fixtures/playlist-utf16.txt')
await page.getByText('5 tracks imported').waitFor()
await page.locator('aside span.count', { hasText: '5 tracks' }).waitFor() // set = playlist order
await page.screenshot({ path: `${scratch}/14b-txt-import.png` })

// collection XML with playlists: empty wheel + hint until a playlist is on
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox-playlists.xml')
await page.getByText('Nothing to show yet.').waitFor()
if ((await page.locator('g.node').count()) !== 0) {
  errors.push('collection with playlists did not start with an empty wheel')
}
await page.getByRole('checkbox', { name: 'Warm-up & After' }).check()
await page.waitForTimeout(300)
if ((await page.locator('g.node').count()) !== 2) {
  errors.push('toggling a playlist did not reveal exactly its tracks')
}
await page.getByRole('checkbox', { name: 'Not in a playlist' }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/14c-playlists.png` })

// themed sample pack with demo set from the advanced menu
await page.getByRole('button', { name: /Advanced/ }).click()
await page.locator('.panel select').last().selectOption('halftime-bass')
page.once('dialog', (d) => d.accept())
await page.getByRole('button', { name: 'Load pack + demo set' }).click()
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.getByText('Halftime & Bass (sample)').waitFor()
await page.getByRole('checkbox', { name: /half\/double/ }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/15-sample-pack.png` })

// sample cycling: ▶ loads a fresh pack, ◀ returns to the previous one
// (the reload above reset the session history, so the plain button is back)
await page.getByRole('button', { name: 'Load sample' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'sample ▶' }).click()
await page.waitForTimeout(300)
const cycledName = await page.locator('header .status span').last().textContent()
if (!cycledName?.includes('(sample)')) {
  errors.push(`sample ▶ did not load a pack: "${cycledName}"`)
}
await page.getByRole('button', { name: 'sample ▶' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: '◀', exact: true }).click()
await page.waitForTimeout(300)
const backName = await page.locator('header .status span').last().textContent()
if (backName !== cycledName) {
  errors.push(`sample ◀ did not return to the previous pack: "${backName}" vs "${cycledName}"`)
}
await page.screenshot({ path: `${scratch}/15b-sample-cycling.png` })

// importing a new library resets stale filters from the previous one
const yearMin = page.locator('.filter-row input').nth(2)
if (!(await yearMin.isVisible())) await page.locator('summary', { hasText: 'Filters' }).click()
await yearMin.fill('2999') // filters the current library out entirely
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox.xml')
await page.getByText('4 tracks imported').waitFor()
if ((await page.locator('g.node').count()) !== 4) {
  errors.push('importing a new library kept stale filters from the previous one')
}

// replacing own work with a sample asks for confirmation exactly once
let dialogCount = 0
const countDialog = (d) => {
  dialogCount++
  return d.accept()
}
page.on('dialog', countDialog)
await page.getByRole('button', { name: 'sample ▶' }).click()
await page.waitForTimeout(400)
page.off('dialog', countDialog)
if (dialogCount !== 1) {
  errors.push(`replacing own work with a sample confirmed ${dialogCount} times, not once`)
}

// an import that yields no tracks reports, but keeps the current library
const nodesBeforeGarbage = await page.locator('g.node').count()
await page.locator('input[type=file]').setInputFiles('tests/fixtures/empty-playlist.txt')
await page.getByText('0 tracks imported').waitFor()
if ((await page.locator('g.node').count()) !== nodesBeforeGarbage) {
  errors.push('a zero-track import wiped the current library')
}

// theme switch: from the emulated dark system preference, the first
// toggle must land on light and stamp data-theme
await page.locator('button.theme-toggle').click()
await page.waitForTimeout(300)
const theme = await page.evaluate(() => document.documentElement.dataset.theme)
if (theme !== 'light') {
  errors.push(`first toggle from the dark system theme should land on light, got "${theme}"`)
}
await page.screenshot({ path: `${scratch}/15c-theme-light.png` })
await page.locator('button.theme-toggle').click()
await page.waitForTimeout(200)

// reset with confirmation dialog
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await page.getByText('Reset everything?').waitFor()
await page.screenshot({ path: `${scratch}/16-reset-dialog.png` })
await page.getByRole('button', { name: 'Reset everything' }).click()
await page.getByText('Your library as a web of combos').waitFor()
if ((await page.locator('header .status .report').count()) !== 0) {
  errors.push('reset left a stale import report in the top bar')
}
await page.screenshot({ path: `${scratch}/17-after-reset.png` })

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
