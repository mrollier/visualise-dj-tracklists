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

/** The ⓘ import-report tooltip (design-v6 §E): reveal it and return its text. */
async function importReportText() {
  await page.locator('.status .info').hover()
  await page.waitForTimeout(150)
  const text = await page.locator('.status .tooltip').textContent()
  await page.locator('h1').hover() // put the tooltip away again
  return text?.replace(/\s+/g, ' ').trim() ?? ''
}

await page.goto('http://localhost:5173')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.getByText('Your library as a web of combos').waitFor()
await page.screenshot({ path: `${scratch}/01-empty.png` })

// Load sample: ONE collection, behaving like an XML import — empty wheel,
// playlists panel, hint centred on the wheel (design-v6 §D)
await page.getByRole('button', { name: 'Load sample' }).click()
await page.getByText('Nothing to show yet.').waitFor()
if ((await page.locator('g.node').count()) !== 0) {
  errors.push('the sample collection did not start with an empty wheel')
}
const statusName = await page.locator('.status .name').textContent()
if (statusName !== 'Sample collection') {
  errors.push(`expected status name "Sample collection", got "${statusName}"`)
}
// the empty hint sits on the wheel's true centre (CX/WIDTH = 410/900), not
// the wrap centre (ISSUES.md #8)
{
  const hint = await page.locator('.no-visible').boundingBox()
  const svg = await page.locator('.wheel-wrap > svg').boundingBox()
  if (hint && svg) {
    const relX = (hint.x + hint.width / 2 - svg.x) / svg.width
    if (Math.abs(relX - 410 / 900) > 0.02) {
      errors.push(`empty hint not centred on the wheel: relX=${relX.toFixed(3)}`)
    }
  } else {
    errors.push('empty hint or svg not found for the centring check')
  }
}
await page.screenshot({ path: `${scratch}/02a-sample-collection.png` })

// toggle every sample playlist on and work from the full collection
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.getByText('combo suggestions').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${scratch}/02-wheel.png` })

// genre-class shapes: the legend must carry shape chips for the collection
if ((await page.locator('.shape-chip').count()) === 0) {
  errors.push('no genre-class shape chips in the legend')
}

// static angles (ISSUES.md #9): a non-radial filter removes nodes without
// moving any survivor; the radial (BPM) ticks stay put too
await page.locator('summary', { hasText: 'Filters' }).click()
const probe = await page.$$eval('g.node', (gs) =>
  gs.map((g) => ({
    label: g.getAttribute('aria-label'),
    d: g.querySelector('path')?.getAttribute('transform'),
  })),
)
const ticksBefore = await page.locator('text.tick-label').allTextContents()
const ratingMin = page.locator('.filter-row', { hasText: 'Rating' }).locator('input').first()
await ratingMin.fill('4')
await page.waitForTimeout(600)
const after = await page.$$eval('g.node', (gs) =>
  gs.map((g) => ({
    label: g.getAttribute('aria-label'),
    d: g.querySelector('path')?.getAttribute('transform'),
  })),
)
if (after.length >= probe.length) errors.push('rating filter did not remove any nodes')
const moved = after.filter((a) => {
  const b = probe.find((p) => p.label === a.label)
  return b && b.d !== a.d
})
if (moved.length > 0) {
  errors.push(`${moved.length} nodes moved under a non-radial filter (should be 0)`)
}
const ticksFiltered = await page.locator('text.tick-label').allTextContents()
if (ticksFiltered.join() !== ticksBefore.join()) {
  errors.push(`a rating filter rescaled the radial ticks: ${ticksBefore} -> ${ticksFiltered}`)
}
await page.screenshot({ path: `${scratch}/03a-gapped-fans.png` })
await page.getByRole('button', { name: 'Reset Rating range' }).click()
await page.waitForTimeout(400)

// min can never exceed max (ISSUES.md #1): typing an absurd min clamps
const bpmRow = page.locator('.filter-row', { hasText: 'BPM' })
await bpmRow.locator('input').first().fill('999')
await bpmRow.locator('input').first().blur()
await page.waitForTimeout(200)
const bpmVals = await bpmRow.locator('input').evaluateAll((els) => els.map((e) => e.value))
if (Number(bpmVals[0]) > Number(bpmVals[1])) {
  errors.push(`BPM min ${bpmVals[0]} ended above max ${bpmVals[1]}`)
}
await page.getByRole('button', { name: 'Reset BPM range' }).click()
await page.waitForTimeout(400)

// the RADIAL axis follows its filter (ISSUES.md #2): a narrow BPM range
// rescales the rings; the reset button restores whole-number extremes (#3)
const ticksWide = await page.locator('text.tick-label').allTextContents()
await bpmRow.locator('input').first().fill('124')
await bpmRow.locator('input').nth(1).fill('128')
await page.waitForTimeout(900)
const ticksNarrow = await page.locator('text.tick-label').allTextContents()
if (ticksNarrow.join() === ticksWide.join()) {
  errors.push('a narrow BPM filter did not rescale the radial ticks')
}
await page.screenshot({ path: `${scratch}/03b-radial-rescale.png` })
await page.getByRole('button', { name: 'Reset BPM range' }).click()
await page.waitForTimeout(900)
const ticksReset = await page.locator('text.tick-label').allTextContents()
if (ticksReset.join() !== ticksWide.join()) {
  errors.push(`↺ did not restore the radial ticks: ${ticksWide} -> ${ticksReset}`)
}
await page.locator('summary', { hasText: 'Filters' }).click()

// hover a node to show the tooltip (dispatched: dense fans may overlap
// hit circles at the full collection size — occlusion is not under test)
const node = page.locator('g.node[aria-label*="Seven Bridges"]')
await node.dispatchEvent('mouseenter')
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/03-tooltip.png` })

// click to select → focus dimming + the selected-track card with the
// must-include toggle (design-v6 §C)
await node.dispatchEvent('mouseleave')
await node.click({ force: true })
await page.waitForTimeout(200)
if ((await page.locator('.selected-card').count()) !== 1) {
  errors.push('selecting a node did not show the selected-track card')
}
await page.locator('.must-toggle').click()
if ((await page.locator('.must-toggle[aria-pressed="true"]').count()) !== 1) {
  errors.push('the must-include toggle did not switch on')
}
await page.screenshot({ path: `${scratch}/04-selected.png` })

// shorter walks (8) keep unused neighbours around for the hub step below;
// the Suggestions section starts folded (ISSUES.md #16)
await page.getByRole('button', { name: /Advanced/ }).click()
const setOrderOpen = await page
  .locator('.panel details.section', { hasText: 'Set order' })
  .evaluate((d) => d.open)
const suggestionsOpen = await page
  .locator('.panel details.section', { hasText: 'Suggestions' })
  .evaluate((d) => d.open)
if (!setOrderOpen) errors.push('the Set order section should start open')
if (suggestionsOpen) errors.push('the Suggestions section should start folded')
// the must-include mark shows up as a removable row in Set order
if ((await page.locator('.must-list li').count()) !== 1) {
  errors.push('the must-include mark did not appear in the Set order section')
}
await page.locator('.panel details.section > summary', { hasText: 'Suggestions' }).click()
await page.locator('.panel input[type=number]').fill('8')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Suggest a set/ }).click()
await page.waitForTimeout(300)
// the suggested walk must include the must-include track
const setTitles = await page.locator('aside ol li.track .names strong').allTextContents()
if (!setTitles.includes('Seven Bridges')) {
  errors.push('the suggested set skipped the must-include track')
}
await page.keyboard.press('Escape') // clear the selection
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
// closer must survive; the pin also prefills the Set order picker
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
// Set order pickers mirror the pins (design-v6 §C): the closer select must
// show the pinned track, and picking an opener there must stick
await page.getByRole('button', { name: /Advanced/ }).click()
const closerLabel = await page
  .locator('.panel details.section', { hasText: 'Set order' })
  .locator('select')
  .nth(1)
  .evaluate((s) => s.selectedOptions[0]?.textContent)
if (!closerLabel?.includes(lastTitle ?? '@@')) {
  errors.push(`the closer picker does not show the pinned track: "${closerLabel}"`)
}
// pick an opener while nothing pins the first row: it must persist
const openerSelect = page
  .locator('.panel details.section', { hasText: 'Set order' })
  .locator('select')
  .first()
const openerValue = await openerSelect.locator('option').nth(3).getAttribute('value')
await openerSelect.selectOption(openerValue)
await page.waitForTimeout(200)
if ((await openerSelect.inputValue()) !== openerValue) {
  errors.push('an opener picked in Set order did not stick')
}
const openerTitle = await openerSelect.evaluate((s) => s.selectedOptions[0]?.textContent)
await page.screenshot({ path: `${scratch}/07a-set-order.png` })
await page.keyboard.press('Escape') // back to the set panel
// regenerate: both pinned ends must be honoured
await page.locator('.suggest-row .primary').click()
await page.waitForTimeout(300)
const firstNow = await page.locator('aside ol li.track .names strong').first().textContent()
if (!openerTitle?.includes(firstNow ?? '@@')) {
  errors.push(`the picked opener was not honoured: "${firstNow}" vs "${openerTitle}"`)
}
// clear both pins and the must-include mark for the flows below
await page.getByRole('button', { name: /Advanced/ }).click()
const setOrderSelects = page
  .locator('.panel details.section', { hasText: 'Set order' })
  .locator('select')
await setOrderSelects.first().selectOption('')
await setOrderSelects.nth(1).selectOption('')
await page.locator('.must-list li .unmark').click()
await page.keyboard.press('Escape')

// hub button: suggest the next track (appends to the set) and jump the
// selection to it, so the next press continues from the head (v7 #17)
const setCountBefore = await page.locator('aside ol li.track').count()
await page.locator('g.hub').dispatchEvent('click')
await page.waitForTimeout(200)
const setCountAfter = await page.locator('aside ol li.track').count()
if (setCountAfter !== setCountBefore + 1) {
  errors.push(`hub button did not append: ${setCountBefore} -> ${setCountAfter}`)
}
if ((await page.locator('.selected-card').count()) !== 1) {
  errors.push('the hub pick did not become the selected track')
}
// the retry ring swaps the pick for a different one, keeping the count
if ((await page.locator('g.hub-retry').count()) !== 1) {
  errors.push('no retry ring after a hub pick with alternatives around')
} else {
  const lastRowBefore = await page.locator('aside ol li.track').last().textContent()
  await page.locator('g.hub-retry').dispatchEvent('click')
  await page.waitForTimeout(200)
  const lastRowAfter = await page.locator('aside ol li.track').last().textContent()
  if ((await page.locator('aside ol li.track').count()) !== setCountAfter) {
    errors.push('retry changed the set length instead of swapping the pick')
  }
  if (lastRowBefore === lastRowAfter) {
    errors.push('retry did not swap the last pick for a different track')
  }
}
await page.screenshot({ path: `${scratch}/07-hub-next.png` })

// duplicate tracks: adding a track that is already in the set must work
// (it opens the set, so a second non-consecutive add is a duplicate)
const dupBefore = await page.locator('aside ol li.track').count()
await page.locator('g.node[aria-label*="Seven Bridges"]').dblclick({ force: true })
await page.waitForTimeout(300)
const dupAfter = await page.locator('aside ol li.track').count()
if (dupAfter !== dupBefore + 1) {
  errors.push(`duplicate append failed: ${dupBefore} -> ${dupAfter}`)
}

// exhausted hub (ISSUES.md #11): on a small playlist a max-length walk stops
// only when the anchor runs out of unused neighbours — the hub then turns
// into a warning-coloured "force" button, and clicking it still grows the
// set (rule-breaking pick; the classic pack keeps isolated tracks around)
await page.locator('aside').first().getByRole('button', { name: 'None' }).first().click()
await page.getByRole('checkbox', { name: 'Classic demo' }).check()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Advanced/ }).click()
await page.locator('.panel details.section > summary', { hasText: 'Suggestions' }).click()
await page.locator('.panel input[type=number]').fill('99')
await page.keyboard.press('Escape')
await page
  .getByRole('button', { name: /Suggest a set|new/ })
  .last()
  .click()
await page.waitForTimeout(400)
if ((await page.locator('g.hub.warning').count()) !== 1) {
  errors.push('an exhausted anchor did not switch the hub to its warning state')
} else {
  const forcedBefore = await page.locator('aside ol li.track').count()
  await page.screenshot({ path: `${scratch}/07c-hub-force.png` })
  await page.locator('g.hub').dispatchEvent('click')
  await page.waitForTimeout(300)
  const forcedAfter = await page.locator('aside ol li.track').count()
  if (forcedAfter !== forcedBefore + 1) {
    errors.push(`the forced hub click did not append: ${forcedBefore} -> ${forcedAfter}`)
  }
}
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.waitForTimeout(400)

// genre map view: overlays, all-method edge tooltip data, nearby ghosts,
// and containment — no node may drift out of the frame (ISSUES.md #12)
await page.getByRole('button', { name: 'Genres', exact: true }).click()
await page.waitForTimeout(1200)
// wheel-only controls grey out off-wheel (ISSUES.md v7 #4)
if ((await page.locator('header select:disabled').count()) !== 2) {
  errors.push('Radius/Colour selects should be disabled in the Genres view')
}
await page.getByRole('button', { name: 'hybrid' }).click()
await page.getByRole('button', { name: 'taxonomy' }).click()
await page.getByRole('checkbox', { name: 'show nearby genres' }).check()
await page.waitForTimeout(2400)
const mapNodes = await page.locator('.genre-node').count()
const ghostNodes = await page.locator('.genre-node.ghost').count()
if (mapNodes === 0) errors.push('genre map rendered no nodes')
if (ghostNodes === 0) errors.push('genre map rendered no ghost neighbours')
const outOfFrame = await page.$$eval(
  '.genre-node',
  (gs) =>
    gs
      .map((g) => {
        const m = (g.getAttribute('transform') ?? '').match(/translate\(([-\d.]+)[, ]([-\d.]+)\)/)
        return m ? { x: +m[1], y: +m[2] } : null
      })
      .filter((p) => p !== null)
      .filter((p) => p.x < -60 || p.x > 960 || p.y < -60 || p.y > 880).length,
)
if (outOfFrame > 0) {
  errors.push(`${outOfFrame} genre-map nodes drifted out of the frame`)
}
await page.screenshot({ path: `${scratch}/07b-genre-map.png` })
await page.getByRole('button', { name: 'Wheel', exact: true }).click()
await page.waitForTimeout(200)

// filters: range inputs are seeded with the selection's extremes; narrowing
// the genres prunes legend classes — absent classes are OMITTED, and the
// legend disappears entirely at ≤ 1 distinct symbol (ISSUES.md #4)
await page.locator('summary', { hasText: 'Filters' }).click()
const bpmMinSeed = await page.locator('.filter-row input').first().inputValue()
if (bpmMinSeed === '') errors.push('filter inputs not seeded with the selection extremes')
const chipsAll = await page.locator('.shape-chip').count()
await page.locator('summary', { hasText: 'Genres' }).click()
await page.locator('.genre-actions button', { hasText: 'None' }).click()
await page.getByRole('checkbox', { name: 'Drum & Bass', exact: true }).check()
await page.waitForTimeout(400)
const chipsOne = await page.locator('.shape-chip').count()
if (chipsOne !== 0) {
  errors.push(`a single-class view should hide the genre legend (${chipsOne} chips remain)`)
}
if ((await page.locator('.shape-chip.dimmed').count()) !== 0) {
  errors.push('dimmed legend chips should no longer exist (omit, not dim)')
}
await page.screenshot({ path: `${scratch}/08-genre-filter.png` })
await page.locator('.genre-actions button', { hasText: 'All' }).click()
await page.waitForTimeout(300)
if ((await page.locator('.shape-chip').count()) !== chipsAll) {
  errors.push('restoring the genres did not restore the legend classes')
}

// the genre method is a first-class pick in the combo panel (ISSUES.md #10)
const methodValue = await page.locator('.criterion .method select').inputValue()
if (methodValue !== 'hybrid') {
  errors.push(`the criteria-panel method select should default to hybrid, got "${methodValue}"`)
}

// advanced menu (collapsible sections): hybrid explainer with sources,
// top-k controls, split +2/+7 checkboxes, vinyl mode
await page.getByRole('button', { name: /Advanced/ }).click()
if ((await page.locator('aside.panel').count()) === 0) {
  errors.push('advanced settings did not open in the right aside')
}
await page.locator('.panel details.section > summary', { hasText: 'Genre matching' }).click()
await page
  .locator('.panel details.section', { hasText: 'Genre matching' })
  .locator('select')
  .selectOption('hybrid')
if ((await page.locator('.panel .hint a').count()) === 0) {
  errors.push('method explainer carries no source links')
}
await page.getByText('Link each genre to its').waitFor() // top-k mode controls
// the live pair count reacts to k (ISSUES.md v7 #12)
const pairCountText = () => page.locator('.pair-count strong').textContent().then(Number)
const kSlider = page.getByText('Link each genre to its').locator('input[type=range]')
await kSlider.fill('15')
const pairsWide = await pairCountText()
await kSlider.fill('1')
const pairsNarrow = await pairCountText()
if (!(pairsNarrow < pairsWide)) {
  errors.push(`k=1 should match fewer genre pairs than k=15 (${pairsNarrow} vs ${pairsWide})`)
}
await kSlider.fill('5')
await page.getByRole('radio').nth(1).check() // switch to threshold mode…
await page.getByText('Similarity ≥').waitFor()
await page.getByRole('radio').first().check() // …and back to mutual top-k
await page.locator('.panel details.section > summary', { hasText: 'Key' }).click()
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
// re-jitter reshuffles same-key fans exactly once (ISSUES.md v7 #16): the
// ↻ button moves nodes; filtering afterwards still moves none
await page.locator('.panel details.section > summary', { hasText: 'Display' }).click()
const fanProbe = () =>
  page.$$eval('g.node', (gs) =>
    gs.map((g) => ({
      label: g.getAttribute('aria-label'),
      d: g.querySelector('path')?.getAttribute('transform'),
    })),
  )
const beforeJitter = await fanProbe()
await page.getByRole('button', { name: 'Re-jitter same-key fans' }).click()
await page.waitForTimeout(300)
const afterJitter = await fanProbe()
const jittered = afterJitter.filter((a) => {
  const b = beforeJitter.find((p) => p.label === a.label)
  return b && b.d !== a.d
})
if (jittered.length === 0) {
  errors.push('the re-jitter button moved no same-key fan nodes')
}
await page.locator('.panel details.section > summary', { hasText: 'Display' }).click()
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

// exports ask for a name first (ISSUES.md #15): accepting the prompt with a
// custom name downloads it (extension appended), cancelling aborts
page.once('dialog', (d) => d.accept('my export'))
const downloadPromise = page.waitForEvent('download')
await page.getByRole('button', { name: 'Export M3U8' }).click()
const download = await downloadPromise
if (download.suggestedFilename() !== 'my export.m3u8') {
  errors.push(`export filename should be "my export.m3u8", got "${download.suggestedFilename()}"`)
}
await download.saveAs(`${scratch}/exported.m3u8`)
let cancelledDownload = false
page.once('dialog', (d) => d.dismiss())
page.once('download', () => {
  cancelledDownload = true
})
await page.getByRole('button', { name: 'Export CSV' }).click()
await page.waitForTimeout(600)
if (cancelledDownload) errors.push('a cancelled export prompt still downloaded a file')

// reload → autosave restores everything (give the debounced save time to flush)
await page.waitForTimeout(700)
await page.reload()
await page.getByText('combo suggestions').waitFor()
await page.getByText('4 tracks', { exact: true }).waitFor()
await page.screenshot({ path: `${scratch}/13-restored.png` })

// import a real Rekordbox XML export through the UI; the report lives
// behind the ⓘ icon now (ISSUES.md #7)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox.xml')
await page.locator('.status .name', { hasText: 'rekordbox.xml' }).waitFor()
{
  const report = await importReportText()
  if (!report.includes('4 tracks imported')) {
    errors.push(`ⓘ tooltip missing the import total: "${report}"`)
  }
}
await page.screenshot({ path: `${scratch}/14-rekordbox-import.png` })

// Rekordbox playlist TXT (UTF-16 TSV): library AND set in file order, plus
// a playlist named after the file, toggled on (ISSUES.md #14)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/playlist-utf16.txt')
await page.locator('.status .name', { hasText: 'playlist-utf16.txt' }).waitFor()
await page.locator('aside span.count', { hasText: '5 tracks' }).waitFor() // set = playlist order
if (!(await page.getByRole('checkbox', { name: 'playlist-utf16' }).isChecked())) {
  errors.push('the TXT playlist did not start toggled on')
}
if ((await page.locator('g.node').count()) === 0) {
  errors.push('the TXT import did not show its tracks immediately')
}
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
// with every visible track in the set, the hub greys out (v7 #17)
for (const g of await page.locator('g.node').all()) {
  await g.dblclick({ force: true })
  await page.waitForTimeout(150)
}
if ((await page.locator('g.hub.disabled').count()) !== 1) {
  errors.push('the hub did not disable once every visible track was in the set')
}
await page.locator('aside').last().getByRole('button', { name: 'Clear' }).click()
await page.waitForTimeout(150)
// the genre checklist follows the playlist selection (ISSUES.md v7 #14):
// Warm-up & After holds only a Melodic House track (plus one without genre),
// so the collection's other genres must not clutter the list
await page.locator('summary', { hasText: 'Filters' }).click()
await page.locator('.genres > summary').click()
const scopedGenreList = await page.locator('.genres li').allTextContents()
const scopedTrimmed = scopedGenreList.map((s) => s.trim())
if (scopedTrimmed.join() !== 'Melodic House') {
  errors.push(`genre checklist not scoped to the selected playlist: [${scopedTrimmed}]`)
}
await page.locator('.genres > summary').click()
await page.locator('summary', { hasText: 'Filters' }).click()
await page.getByRole('checkbox', { name: 'Not in a playlist' }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/14c-playlists.png` })

// toggling playlists resets the range filters to the new selection's
// whole-number extremes (design-v6 approval caveat)
await page.locator('summary', { hasText: 'Filters' }).click()
await page.locator('.filter-row', { hasText: 'BPM' }).locator('input').first().fill('1')
await page.waitForTimeout(200)
await page.getByRole('checkbox', { name: 'Not in a playlist' }).uncheck()
await page.waitForTimeout(300)
const bpmAfterToggle = await page
  .locator('.filter-row', { hasText: 'BPM' })
  .locator('input')
  .first()
  .inputValue()
if (bpmAfterToggle === '1') {
  errors.push('toggling a playlist did not reset the range filters')
}
await page.locator('summary', { hasText: 'Filters' }).click()

// importing a new library resets stale filters from the previous one
await page.locator('summary', { hasText: 'Filters' }).click()
const yearMin = page.locator('.filter-row', { hasText: 'Year' }).locator('input').first()
await yearMin.fill('2999') // filters the current library out entirely
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles('tests/fixtures/rekordbox.xml')
await page.locator('.status .name', { hasText: 'rekordbox.xml' }).waitFor()
await page.waitForTimeout(300)
if ((await page.locator('g.node').count()) !== 4) {
  errors.push('importing a new library kept stale filters from the previous one')
}

// replacing own work with the sample collection asks once, via the
// in-app dialog (ISSUES.md v7 #6) — no native confirm() anywhere
await page.getByRole('button', { name: 'Load sample' }).click()
await page.getByRole('heading', { name: 'Replace your library?' }).waitFor()
await page.screenshot({ path: `${scratch}/15a-replace-dialog.png` })
await page.getByRole('button', { name: 'Replace and load' }).click()
await page.locator('.status .name', { hasText: 'Sample collection' }).waitFor()
// …and replacing a disposable sample library asks nothing
await page.getByRole('button', { name: 'Load sample' }).click()
await page.waitForTimeout(300)
if (await page.getByRole('heading', { name: 'Replace your library?' }).isVisible()) {
  errors.push('replacing a sample library should not ask for confirmation')
}

// an import that yields no tracks reports, but keeps the current library
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.waitForTimeout(300)
const nodesBeforeGarbage = await page.locator('g.node').count()
await page.locator('input[type=file]').setInputFiles('tests/fixtures/empty-playlist.txt')
await page.waitForTimeout(400)
{
  const report = await importReportText()
  if (!report.includes('0 tracks imported')) {
    errors.push(`a zero-track import should report 0 tracks: "${report}"`)
  }
}
if ((await page.locator('g.node').count()) !== nodesBeforeGarbage) {
  errors.push('a zero-track import wiped the current library')
}

// narrow window: the view switch must never clip (ISSUES.md #13)
await page.setViewportSize({ width: 900, height: 700 })
await page.waitForTimeout(300)
{
  const genres = await page.getByRole('button', { name: 'Genres' }).boundingBox()
  const header = await page.locator('header').boundingBox()
  if (!genres || !header || genres.x + genres.width > header.x + header.width + 1) {
    errors.push('the Genres button clips out of the header on a narrow window')
  }
}
await page.screenshot({ path: `${scratch}/15-narrow-header.png` })
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(300)

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
if ((await page.locator('.status .info').count()) !== 0) {
  errors.push('reset left a stale import-report ⓘ in the top bar')
}
await page.screenshot({ path: `${scratch}/17-after-reset.png` })

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
