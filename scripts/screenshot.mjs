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

// The flow below is top-level await, so a single rejected step used to skip
// the summary AND browser.close() at the tail — a stale selector became a
// silent hang with a leaked Chrome, which is how the drift below went
// unnoticed for eighteen releases. render-icons.mjs uses try/finally for the
// same reason; wrapping 1,700 lines is not worth it, so catch it here.
const abort = (reason) => {
  errors.push(`the run aborted: ${String(reason)}`)
  console.error('CONSOLE ERRORS:', errors)
  void browser.close().finally(() => process.exit(1))
}
process.on('unhandledRejection', abort)
process.on('uncaughtException', abort) // a rejected top-level await lands here

/** Open an advanced section if it is not already open. A blind summary click
 *  is not idempotent, and settings.advancedOpen persists across the reload
 *  below, so a section the app remembers open would be CLOSED instead. */
const ensureSectionOpen = async (name) => {
  const details = page.locator('.panel details.section', { hasText: name }).first()
  if (!(await details.evaluate((d) => d.open))) {
    await page.locator('.panel details.section > summary', { hasText: name }).click()
  }
}

/** Wait out the walk-reveal cascade. Since v31 the hub is inert (and the ⚡
 *  force offer withheld) until the constellation stands still, so a click or
 *  an assertion that lands during the cascade sees the previous state. */
const settleWalk = async () => {
  await page.waitForTimeout(200)
  await page
    .locator('g.hub:not(.disabled)')
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {})
  await page.waitForTimeout(300)
}

/** Wait until the wheel's node transforms stop changing. The domain tween,
 *  the radial morph and the displaced-scalar morph can all still be in flight
 *  well past a fixed timeout, and comparing positions mid-animation reads as
 *  drift that settles to zero a second later. */
const settleWheel = async (timeout = 6000) => {
  const read = () =>
    page.$$eval('g.node', (gs) =>
      gs.map((g) => g.querySelector('path')?.getAttribute('transform')).join('|'),
    )
  let last = await read()
  const until = Date.now() + timeout
  while (Date.now() < until) {
    await page.waitForTimeout(200)
    const now = await read()
    if (now === last) return
    last = now
  }
}

/** 1-based nth-child index of a Tracks-view data column, by header label. The
 *  leading tags/pos/manual cells are conditional, so counting them by hand has
 *  silently pointed two assertions at the wrong column since v18. */
const columnIndex = async (label) => {
  const heads = await page.locator('.tracks-view thead th').allTextContents()
  const i = heads.findIndex((t) => t.trim().toLowerCase().startsWith(label.toLowerCase()))
  if (i === -1) errors.push(`no Tracks-view column headed "${label}"`)
  return i + 1
}

/** The ⓘ import-report tooltip (design-v6 §E): reveal it and return its text. */
async function importReportText() {
  await page.locator('.status .info').hover()
  await page.waitForTimeout(150)
  const text = await page.locator('.status .tooltip').textContent()
  await page.locator('h1').hover() // put the tooltip away again
  return text?.replace(/\s+/g, ' ').trim() ?? ''
}

// A missing dev server otherwise surfaces as ERR_CONNECTION_REFUSED buried in
// the error list, which reads like an app failure. Say what it is.
try {
  await page.goto('http://localhost:5173')
} catch {
  console.error('No dev server on http://localhost:5173 — start `npm run dev` first.')
  await browser.close()
  process.exit(2)
}
// Vite's first-visit dependency optimisation triggers a full reload, which
// destroys the execution context mid-evaluate. Settle, then clear and reload
// so the flow below always starts from a fresh profile.
await page.waitForLoadState('networkidle')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.reload()
await page.getByText('Your library as a web of combos').waitFor()
await page.screenshot({ path: `${scratch}/01-empty.png` })

// Load sample: ONE collection, behaving like an XML import — except the
// Classic demo pack starts pre-selected (v14 WS3 D2), so the wheel is
// populated immediately instead of showing the empty-wheel hint.
await page.getByRole('button', { name: 'Load sample' }).click()
await page.locator('g.node').first().waitFor()
// v12 WS12: the first-ever sample load opens the guided tour — capture it,
// then close it so the flows below run uncluttered (the seen-flag persists).
await page.getByRole('dialog', { name: 'Guided tour' }).waitFor()
await page.screenshot({ path: `${scratch}/01b-tour.png` })
await page.locator('button[aria-label="Skip the tour"]').dispatchEvent('click') // the card animates in; a real click never settles
if ((await page.locator('g.node').count()) === 0) {
  errors.push('the sample collection did not start with the Classic demo pack populating the wheel')
}
// The tour's demo view (tour.ts enterDemoView) leaves the criteria at EASY —
// Key + BPM only — and skipping the tour keeps that state by design. Every
// flow below is written against the five-criterion default, so put the three
// the demo view switched off back on.
for (const name of ['Energy within', 'Genre', 'Year within']) {
  const box = page
    .locator('.criterion-head label', { hasText: name })
    .locator('input[type="checkbox"]')
    .first()
  if (!(await box.isChecked())) await box.check()
}
{
  const head = (await page.locator('.threshold-head').textContent())?.replace(/\s+/g, ' ')
  if (!head?.includes('of 5')) {
    errors.push(`restoring the default criteria should give five of them, got "${head}"`)
  }
}
const statusName = await page.locator('.status .name').textContent()
if (statusName !== 'Sample collection') {
  errors.push(`expected status name "Sample collection", got "${statusName}"`)
}
if (!(await page.getByRole('checkbox', { name: 'Classic demo' }).isChecked())) {
  errors.push('the Classic demo playlist did not start toggled on')
}
await page.screenshot({ path: `${scratch}/02a-sample-collection.png` })

// v14 WS3 (re-homed empty-state check): D2 auto-selects the Classic demo, so
// the genuine empty state now only appears when the user deselects it — the
// "Nothing to show yet" hint returns and the wheel empties. Re-select after.
await page.getByRole('checkbox', { name: 'Classic demo' }).uncheck()
await page.getByText('Nothing to show yet.').waitFor()
// The stars fade out rather than vanish, so count once the exit transition
// has actually finished — the hint appears before the last node unmounts.
await page
  .waitForFunction(() => document.querySelectorAll('g.node').length === 0, null, { timeout: 5000 })
  .catch(() => errors.push('deselecting the only active playlist did not empty the wheel'))
await page.getByRole('checkbox', { name: 'Classic demo' }).check()
await page.locator('g.node').first().waitFor()

// toggle every sample playlist on and work from the full collection
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.getByText('combo suggestions').waitFor()
await page.waitForTimeout(900) // let the radial tween fully settle before probing
await page.screenshot({ path: `${scratch}/02-wheel.png` })

// v11 issue 1: BPM/Year/Rating filters are the default again (the v10
// Date-added default is reverted), so the filter-driven checks below need no
// advanced-menu setup. v11 issue 4: the sample's info moved to the status ⓘ.
{
  const filterLabels = await page.locator('.filter-row .filter-label').allTextContents()
  for (const expected of ['BPM', 'Year', 'Rating', 'Keys']) {
    if (!filterLabels.some((l) => l.trim() === expected)) {
      errors.push(`default filters should include ${expected}, got [${filterLabels}]`)
    }
  }
  if (filterLabels.some((l) => l.includes('Added'))) {
    errors.push('Date-added should be opt-in again, not a default filter (v11)')
  }
  if ((await page.locator('.sample-load').count()) !== 0) {
    errors.push('the Load-sample button should no longer carry its own info icon')
  }
  const statusInfo = await importReportText()
  if (!/themed playlists/.test(statusInfo)) {
    errors.push(`the status ⓘ should report the sample's playlists, got "${statusInfo}"`)
  }
}
// v11 issue 2a: the require-boxes reach zero — every pair becomes a combo,
// and the stat line computes the complete graph arithmetically.
{
  const visibleCount = Number.parseInt(
    (await page.locator('.stat .value').first().textContent()) ?? '0',
    10,
  )
  // The count of enabled criteria is whatever the current view has (the tour's
  // demo view leaves Key + BPM only), so read it rather than hard-coding it —
  // the assertion is about reaching zero, not about how many criteria exist.
  const headBefore = (await page.locator('.threshold-head').textContent())?.replace(/\s+/g, ' ')
  const enabledCount = Number(/of (\d+)/.exec(headBefore ?? '')?.[1] ?? '0')
  const firstBox = page.locator('.boxes .box').first()
  await firstBox.click() // fill down to 1
  await firstBox.click() // …and clear to 0
  const thresholdText = (await page.locator('.threshold-head').textContent())?.replace(/\s+/g, ' ')
  if (!thresholdText?.includes(`0 of ${enabledCount}`)) {
    errors.push(
      `clicking the last filled box should read "require 0 of ${enabledCount}", got "${thresholdText}"`,
    )
  }
  const comboStat = Number.parseInt(
    (await page.locator('.stat .value').nth(1).textContent()) ?? '0',
    10,
  )
  const completePairs = (visibleCount * (visibleCount - 1)) / 2
  if (comboStat !== completePairs) {
    errors.push(`threshold 0 should count ${completePairs} combos (complete), got ${comboStat}`)
  }
  await page.locator('.boxes .box').last().click() // restore require-all
}

// ---- v14: demanded locks (C2) + the new filter kinds (WS2) ----
{
  const visibleCount = async () =>
    Number.parseInt((await page.locator('.stat .value').first().textContent()) ?? '0', 10)

  // C2: locking a criterion (🔒) makes it demanded and FLOORS the require row —
  // the boxes can never drop below the count of locked criteria.
  const keyCriterion = page.locator('.criterion', { hasText: 'Key' }).first()
  await keyCriterion.locator('.lock').click()
  await page.waitForTimeout(150)
  if ((await page.locator('.criterion.threshold .box.locked').count()) !== 1) {
    errors.push('locking a criterion did not floor the require row with one locked box')
  }
  // step the requirement all the way down: it stops at the locked floor (1)
  await page.locator('.criterion.threshold .box').nth(1).click() // require 3 → 2
  await page.locator('.criterion.threshold .box').nth(1).click() // require 2 → floor 1
  const flooredText = (await page.locator('.threshold-head').textContent())?.replace(/\s+/g, ' ')
  if (!/Require 1 of \d+/.test(flooredText ?? '')) {
    errors.push(`a demanded criterion should floor the require row at 1, got "${flooredText}"`)
  }
  await keyCriterion.locator('.lock').click() // unlock (floor back to 0)
  await page.waitForTimeout(150)
  await page.locator('.criterion.threshold .box').nth(2).click() // restore require 3

  // WS2: surface the Artist (alpha) and Kind (quality) filters via the
  // Track-properties table, then exercise the new controls.
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.getByRole('checkbox', { name: 'Artist filter', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Kind filter', exact: true }).check()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.keyboard.press('Escape')
  await page.locator('summary', { hasText: 'Filters' }).click()

  const beforeNarrow = await visibleCount()

  // alpha range (F2): narrowing the Artist first-letter buckets to A–C prunes
  // every artist outside that range; the ↺ reset restores the full set.
  const artistRow = page.locator('.filter-row', { hasText: 'Artist' })
  await artistRow.locator('.alpha-select').nth(1).selectOption({ label: 'C' })
  await page.waitForTimeout(400)
  const afterAlpha = await visibleCount()
  if (!(afterAlpha < beforeNarrow)) {
    errors.push(`an A–C artist range should narrow the set (${beforeNarrow} → ${afterAlpha})`)
  }
  await page.getByRole('button', { name: 'Reset Artist filter' }).click()
  await page.waitForTimeout(400)
  if ((await visibleCount()) !== beforeNarrow) {
    errors.push('resetting the artist range did not restore the full set')
  }

  // quality tri-state (F3): choosing "lossy" hides every lossless-file track.
  const kindRow = page.locator('.filter-row', { hasText: 'Kind' })
  await kindRow.locator('.ring-switch button', { hasText: 'lossy' }).click()
  await page.waitForTimeout(400)
  const afterLossy = await visibleCount()
  if (!(afterLossy < beforeNarrow)) {
    errors.push(
      `the lossy quality filter should hide lossless tracks (${beforeNarrow} → ${afterLossy})`,
    )
  }
  // The quality switch is a two-button multi-select now (lossy / lossless);
  // the old tri-state "both" button is gone, so clearing means un-pressing.
  await kindRow.locator('.ring-switch button', { hasText: 'lossy' }).click()
  await page.waitForTimeout(400)
  if ((await visibleCount()) !== beforeNarrow) {
    errors.push('clearing the quality filter did not restore the full set')
  }
  await page.screenshot({ path: `${scratch}/02b-filter-kinds.png` })

  // restore the default filter set (hiding a filter also clears it)
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.getByRole('checkbox', { name: 'Artist filter', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Kind filter', exact: true }).uncheck()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.keyboard.press('Escape')
  await page.locator('summary', { hasText: 'Filters' }).click()
}

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
// The stars leave on a transition, and an axis morph may still be in flight,
// so 600ms was not always enough for the DOM to settle at the new count.
await page
  .waitForFunction((n) => document.querySelectorAll('g.node').length < n, probe.length, {
    timeout: 5000,
  })
  .catch(() => {})
await page.waitForTimeout(400)
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
await page.getByRole('button', { name: 'Reset Rating filter' }).click()
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
await page.getByRole('button', { name: 'Reset BPM filter' }).click()
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
await page.getByRole('button', { name: 'Reset BPM filter' }).click()
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
// dispatched, like the hover above: in a dense 11A slot a neighbour's hit
// circle can sit on top — which node wins a raw click is not under test
await node.dispatchEvent('click')
await page.waitForTimeout(200)
if ((await page.locator('.selected-card').count()) !== 1) {
  errors.push('selecting a node did not show the selected-track card')
}
// the card lives bottom-RIGHT, clear of the bottom-left legend (v8 issue 9)
const cardBox = await page.locator('.selected-card').boundingBox()
const wheelBox = await page.locator('main').boundingBox()
if (cardBox && wheelBox && cardBox.x + cardBox.width / 2 < wheelBox.x + wheelBox.width / 2) {
  errors.push('the selected-track card should sit on the right half of the view')
}
const legendBox = await page.locator('.legend').boundingBox()
if (cardBox && legendBox && cardBox.x < legendBox.x + legendBox.width) {
  errors.push('the selected-track card overlaps the legend')
}
// v11 issue 15 + v12 WS9 (v14 WS1 dropped the ✎ hand editor): the card's
// marks are a compact icon row — ★ ⏮ ⏭ plus the 🔗 link mode, with the ⓘ at
// the end.
await page.locator('.marks .mark-toggle').first().click()
if ((await page.locator('.marks .mark-toggle[aria-pressed="true"]').count()) !== 1) {
  errors.push('the must-include mark did not switch on')
}
if ((await page.locator('.marks .mark-toggle').count()) !== 4) {
  errors.push('the selected-track card should show exactly four mark icons')
}
await page.screenshot({ path: `${scratch}/04-selected.png` })

// shorter walks (8) keep unused neighbours around for the hub step below;
// View sits LAST (v30 added it after Constellation & suggestions)
await page.getByRole('button', { name: /Advanced/ }).click()
const lastSectionName = await page.locator('.panel details.section > summary').last().textContent()
if (lastSectionName?.trim() !== 'View') {
  errors.push(`the last advanced section should be View, got "${lastSectionName}"`)
}
const openAtFirst = await page
  .locator('.panel details.section')
  .evaluateAll((ds) => ds.filter((d) => d.open).length)
if (openAtFirst !== 0) {
  errors.push(`all advanced sections should start folded on first open (${openAtFirst} open)`)
}
await ensureSectionOpen('Constellation & suggestions')
// the must-include mark shows up as a removable row in Set & suggestions
if ((await page.locator('.must-list li').count()) !== 1) {
  errors.push('the must-include mark did not appear in the Set & suggestions section')
}
await page.getByRole('spinbutton', { name: 'Suggested set length' }).fill('8')
// v11 issue 14: resetting to defaults asks first — cancel leaves everything.
await page.getByRole('button', { name: /Return to default settings/ }).click()
if (
  (await page.locator('dialog[open]').getByRole('button', { name: 'Reset settings' }).count()) !== 1
) {
  errors.push('Return to default settings should open a confirmation dialog')
}
await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click()
if ((await page.getByRole('spinbutton', { name: 'Suggested set length' }).inputValue()) !== '8') {
  errors.push('cancelling the reset dialog should keep the settings untouched')
}
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Suggest a constellation/ }).click()
await settleWalk()
await page.waitForTimeout(300)
// v14 S1: a starred essential (★) is now a HARD guarantee — ✨ must place it,
// forcing an edge if that is the only way in (no longer a soft bias).
const setTitles = await page.locator('aside ol li.track .names strong').allTextContents()
if (!setTitles.includes('Seven Bridges')) {
  errors.push('the suggested set skipped the ★ essential track (v14 S1 guarantee)')
}
await page.keyboard.press('Escape') // clear the selection
await page.screenshot({ path: `${scratch}/05-suggested-set.png` })

// the sets ARE the suggestion browser (v8 issue 18): ✨ regenerates an
// UNTOUCHED set in place (same set, fresh content, no set spam), and Cmd+Z
// steps back through regenerations — the old ◀ history, for free
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
const walkBeforeRegen = await page.locator('aside ol li.track .names strong').allTextContents()
await page.getByRole('button', { name: /Suggest a constellation/ }).click()
await settleWalk()
await page.waitForTimeout(250)
const walkAfterRegen = await page.locator('aside ol li.track .names strong').allTextContents()
if (walkAfterRegen.join() === walkBeforeRegen.join()) {
  errors.push('✨ on an untouched generated set did not regenerate its content')
}
if ((await page.locator('aside .head select option').count()) !== 1) {
  errors.push('✨ on an untouched generated set should NOT create a new set')
}
await page.keyboard.press(undoKey)
await page.waitForTimeout(200)
if (
  (await page.locator('aside ol li.track .names strong').allTextContents()).join() !==
  walkBeforeRegen.join()
) {
  errors.push('Cmd+Z did not step back to the previous regeneration')
}
await page.getByRole('button', { name: /Suggest a constellation/ }).click()
await settleWalk()
await page.waitForTimeout(250)
await page.screenshot({ path: `${scratch}/06-suggestion-arrows.png` })

// named sets (ISSUES.md v7 #18): a shown suggestion wears the ✨ generated
// badge until the first manual edit; ＋ starts an empty "Second Set" and
// switching back restores the walk
if ((await page.locator('aside .head .badge').count()) !== 1) {
  errors.push('a freshly shown suggestion did not wear the generated badge')
}
const firstSetCount = await page.locator('aside ol li.track').count()
await page.locator('aside ol li.track').first().hover()
// On a fine pointer the ▲▼ arrows are display: none until the row has focus
// INSIDE it (v18 #5: mouse users drag instead), so hovering is not enough —
// focus a button in the row first.
{
  const firstRow = page.locator('aside ol li.track').first()
  await firstRow.hover()
  await firstRow.locator('button').first().focus()
  await firstRow.getByRole('button', { name: 'Move down' }).click()
}
await page.waitForTimeout(150)
if ((await page.locator('aside .head .badge').count()) !== 0) {
  errors.push('a manual edit did not clear the generated badge')
}
await page.getByRole('button', { name: 'New constellation' }).click()
await page.waitForTimeout(150)
const activeSetName = await page
  .locator('aside .head select')
  .evaluate((s) => s.selectedOptions[0]?.textContent)
if (activeSetName !== 'Second') {
  errors.push(`the new set should be called "Second", got "${activeSetName}"`)
}
if ((await page.locator('aside ol li.track').count()) !== 0) {
  errors.push('a new set did not start empty')
}
if ((await page.locator('g.node .dot.in-walk').count()) !== 0) {
  errors.push('the wheel still shows the previous set as the walk')
}
// the dropdown browses the sets (v8 issue 18; the ◀/▶ arrows retired in v9)
const setOptionValues = await page
  .locator('aside .head select option')
  .evaluateAll((os) => os.map((o) => o.value))
await page.locator('aside .head select').selectOption(setOptionValues[0])
await page.waitForTimeout(150)
if ((await page.locator('aside ol li.track').count()) !== firstSetCount) {
  errors.push('selecting the first set did not restore its walk')
}
await page.locator('aside .head select').selectOption(setOptionValues[1])
await page.waitForTimeout(150)
if ((await page.locator('aside ol li.track').count()) !== 0) {
  errors.push('selecting the second set did not show it empty')
}
await page.getByRole('button', { name: 'Delete constellation' }).click()
await page.waitForTimeout(150)
if ((await page.locator('aside .head select option').count()) !== 1) {
  errors.push('deleting the second set did not remove it')
}

// the cap (v8 issue 18): ＋ disables at eight sets; an empty eighth still
// takes a ✨ fill, a hand-edited one blocks it once the shelf is full
for (let i = 0; i < 7; i++) {
  await page.getByRole('button', { name: 'New constellation' }).click()
}
await page.waitForTimeout(200)
if (!(await page.getByRole('button', { name: 'New constellation' }).isDisabled())) {
  errors.push('＋ should disable at eight sets')
}
if (await page.locator('.suggest-row .primary').isDisabled()) {
  errors.push('✨ should still fill an EMPTY eighth set in place')
}
await page.locator('g.node').first().dblclick({ force: true }) // hand-edit it
await page.waitForTimeout(200)
if (!(await page.locator('.suggest-row .primary').isDisabled())) {
  errors.push('✨ should disable: all eight sets exist and this one is hand-edited')
}
while ((await page.locator('aside .head select option').count()) > 1) {
  await page.getByRole('button', { name: 'Delete constellation' }).click()
  await page.waitForTimeout(100)
}

// undo (ISSUES.md v7 #2): Cmd+Z takes back the last set edit, Cmd+Shift+Z
// re-applies it
const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z'
const undoCountBefore = await page.locator('aside ol li.track').count()
await page.locator('aside ol li.track').first().hover()
await page.locator('aside ol li.track').first().getByRole('button', { name: 'Remove' }).click()
await page.waitForTimeout(150)
await page.keyboard.press(undoKey)
await page.waitForTimeout(150)
if ((await page.locator('aside ol li.track').count()) !== undoCountBefore) {
  errors.push('Cmd+Z did not restore the removed track')
}
await page.keyboard.press(redoKey)
await page.waitForTimeout(150)
if ((await page.locator('aside ol li.track').count()) !== undoCountBefore - 1) {
  errors.push('Cmd+Shift+Z did not redo the removal')
}
await page.keyboard.press(undoKey) // back to the full set
await page.waitForTimeout(150)

// ✨ on a HAND-EDITED set never overwrites it: a new set appears alongside
// (v8 issue 18), and the dropdown still finds the edited one intact
const editedTitles = await page.locator('aside ol li.track .names strong').allTextContents()
await page.locator('.suggest-row .primary').click()
await settleWalk()
await page.waitForTimeout(250)
if ((await page.locator('aside .head select option').count()) !== 2) {
  errors.push('✨ on a hand-edited set should create a new set alongside it')
}
if ((await page.locator('aside .head .badge').count()) !== 1) {
  errors.push('the freshly generated set should wear the ✨ badge')
}
const twoSetValues = await page
  .locator('aside .head select option')
  .evaluateAll((os) => os.map((o) => o.value))
await page.locator('aside .head select').selectOption(twoSetValues[0])
await page.waitForTimeout(150)
if (
  (await page.locator('aside ol li.track .names strong').allTextContents()).join() !==
  editedTitles.join()
) {
  errors.push('the hand-edited set was not left intact by ✨')
}
await page.locator('aside .head select').selectOption(twoSetValues[1])
await page.waitForTimeout(150)

// pinned closer: pin the last track of the generated set (pins are session
// state, not an edit — the set stays untouched) and regenerate in place
const lastTitle = await page.locator('aside ol li.track .names strong').last().textContent()
await page.locator('aside ol li.track').last().hover()
await page.locator('aside ol li.track .pin').last().click()
await page.locator('.suggest-row .primary').click()
await settleWalk()
await page.waitForTimeout(300)
const lastAfter = await page.locator('aside ol li.track .names strong').last().textContent()
if (lastAfter !== lastTitle) {
  errors.push(`pinned closer not honoured: "${lastTitle}" -> "${lastAfter}"`)
}
if ((await page.locator('aside .head select option').count()) !== 2) {
  errors.push('regenerating the untouched generated set should not add another set')
}
// the Tracks view (v7 #7/#10): a sortable table over the selected
// playlists; the 📌 closer pin from the set row shows as an active ⏭
// toggle; row toggles pick the opener and mark essentials; the wheel wears
// subtle rings for tagged tracks; Set & suggestions lists it all read-only
await page.getByRole('button', { name: 'Tracks', exact: true }).click()
await page.locator('.tracks-view table').waitFor()
// v10 issue 13: one click-cycle star per row; the closer pinned from the set
// row shows here as a single star in its ⏭ (closer) state.
if ((await page.locator('.tracks-view .tag.star', { hasText: '⏭' }).count()) !== 1) {
  errors.push('the 📌 closer pin is not reflected as a ⏭ star in the Tracks view')
}
// sorting: BPM ascending then descending, missing values at the bottom
const bpmHeader = page.locator('.tracks-view th button', { hasText: 'BPM' })
await bpmHeader.click()
const bpmCell = `.tracks-view tbody td:nth-child(${await columnIndex('BPM')})`
const bpmColumn = () =>
  page
    .locator(bpmCell)
    .allTextContents()
    .then((cells) => cells.filter((c) => c !== '—').map(Number))
const asc = await bpmColumn()
if (asc[0] > asc[asc.length - 1]) errors.push('BPM ascending sort is not ascending')
await bpmHeader.click()
const desc = await bpmColumn()
if (desc[0] < desc[desc.length - 1]) errors.push('BPM descending sort is not descending')
// v8 issue 15: ratings render as stars, and the Album/Length columns can be
// enabled from the advanced menu (order = the settings list)
if ((await page.locator('.tracks-view td.rating .stars').count()) === 0) {
  errors.push('ratings should render as stars in the Tracks view')
}
// v11 issue 1: columns live in the unified "Track properties" table now,
// one row per property with a Column and a Filter checkbox.
await page.getByRole('button', { name: /Advanced/ }).click()
await ensureSectionOpen('Track properties')
// One row per track property (32 since v35, which added the four analysis
// descriptors) plus one .pseudo row per permanent panel filter (4 since v25:
// starred, constellation, combos, keys).
if ((await page.locator('.prop-row').count()) !== 36) {
  errors.push(
    `the Track properties table should list 36 rows, got ${await page.locator('.prop-row').count()}`,
  )
}
await page.getByRole('checkbox', { name: 'Length column', exact: true }).check()
await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
await page.keyboard.press('Escape')
if ((await page.locator('.tracks-view th button', { hasText: 'Length' }).count()) !== 1) {
  errors.push('enabling the Length column did not add its header')
}
// selection is shared: clicking a row highlights its combo neighbours
await page.locator('.tracks-view tbody tr').first().click()
if ((await page.locator('.tracks-view tbody tr.connected').count()) === 0) {
  errors.push('selecting a table row highlighted no connected tracks')
}
await page.locator('.tracks-view tbody tr').first().click() // deselect again
// v10 issue 13: the single star cycles none → must → first → last → none.
// Tag a row as opener (⏮) by cycling twice (none→must→first, first is free),
// and another as essential (★) with one click.
const starOf = (row) => row.locator('.tag.star')
let openerRow = page.locator('.tracks-view tbody tr').first()
const titleCell = `td:nth-child(${await columnIndex('Title')})`
let openerTitle = await openerRow.locator(titleCell).textContent()
if (openerTitle === lastTitle) {
  openerRow = page.locator('.tracks-view tbody tr').nth(2)
  openerTitle = await openerRow.locator(titleCell).textContent()
}
await starOf(openerRow).click()
await starOf(openerRow).click()
if ((await starOf(openerRow).textContent())?.trim() !== '⏮') {
  errors.push('cycling the star twice did not make the row the opener (⏮)')
}
// mark the first still-unmarked row essential (one click → ★)
{
  const rows = page.locator('.tracks-view tbody tr')
  const total = Math.min(await rows.count(), 8)
  let marked = false
  for (let i = 0; i < total; i++) {
    if ((await starOf(rows.nth(i)).textContent())?.trim() === '☆') {
      await starOf(rows.nth(i)).click()
      if ((await starOf(rows.nth(i)).textContent())?.trim() !== '★') {
        errors.push('one click on an unmarked star did not mark it essential (★)')
      }
      marked = true
      break
    }
  }
  if (!marked) errors.push('found no unmarked row to mark essential')
}
// v8 issue 15 / v9 issue 14: the ＋ cell appends and turns into the set
// position number; clicking the number takes the track out again
{
  const setLenBefore = await page.locator('aside ol li.track').count()
  const freshBtn = await page
    .locator('.tracks-view tbody tr .pos-btn:not(.in-set)')
    .first()
    .elementHandle()
  await freshBtn.dispatchEvent('click')
  await page.waitForTimeout(200)
  if ((await page.locator('aside ol li.track').count()) !== setLenBefore + 1) {
    errors.push('the ＋ cell did not append the track to the set')
  }
  const posText = await freshBtn.$eval('.num', (el) => el.textContent)
  if (!/^\d+(,\d+)*$/.test(posText?.trim() ?? '')) {
    errors.push(`an in-set ＋ cell should read as position number(s), got "${posText}"`)
  }
  await freshBtn.dispatchEvent('click') // v9 issue 14: removes, set as it was
  await page.waitForTimeout(200)
  if ((await page.locator('aside ol li.track').count()) !== setLenBefore) {
    errors.push('clicking the position number did not remove the track from the set')
  }
}
// v11 issues 11+12: header icons align over their columns; the ☰ toggle
// shows only the set (position order), hiding the sort triangle; both
// return untouched on toggle-back.
{
  const headerStarBox = await page.locator('th.tags-col .header-toggle').boundingBox()
  const rowStarBox = await page.locator('.tag.star').first().boundingBox()
  if (!headerStarBox || !rowStarBox) {
    errors.push('the header ★ / row ★ alignment check found no elements to measure')
  } else {
    const headerMid = headerStarBox.x + headerStarBox.width / 2
    const rowMid = rowStarBox.x + rowStarBox.width / 2
    if (Math.abs(headerMid - rowMid) > 3) {
      errors.push(
        `header ★ misaligned with row stars (${headerMid.toFixed(1)} vs ${rowMid.toFixed(1)})`,
      )
    }
  }
  const setEntries = await page.locator('aside ol li.track').count()
  const dirBefore = await page.locator('.tracks-view .dir').count()
  if (dirBefore !== 1)
    errors.push('the sorted column should show its triangle before set-only mode')
  await page.locator('.pos-toggle').click()
  await page.waitForTimeout(200)
  const setOnlyRows = await page.locator('.tracks-view tbody tr').count()
  if (setOnlyRows > setEntries || setOnlyRows === 0) {
    errors.push(
      `set-only mode should list the set's tracks (≤ ${setEntries} deduped), got ${setOnlyRows}`,
    )
  }
  if ((await page.locator('.tracks-view .dir').count()) !== 0) {
    errors.push('the sort triangle should hide while set order rules (v11 issue 12b)')
  }
  await page.locator('.pos-toggle').click()
  await page.waitForTimeout(200)
  if ((await page.locator('.tracks-view .dir').count()) !== 1) {
    errors.push('the sort triangle should return when leaving set-only mode')
  }
}
// v8 issue 15: header drag reorders columns persistently
const headerOrder = () => page.locator('.tracks-view th button.sort').allTextContents()
{
  const before = await headerOrder()
  const keyHeader = page.locator('.tracks-view th', { has: page.getByText('Key', { exact: true }) })
  const artistHeader = page
    .locator('.tracks-view th', { has: page.getByText('Artist', { exact: true }) })
    .first()
  await keyHeader.dragTo(artistHeader)
  await page.waitForTimeout(300)
  const after = await headerOrder()
  if (after.join() === before.join()) {
    errors.push('dragging the Key header did not reorder the columns')
  }
  if (!after[0].startsWith('Key')) {
    errors.push(`Key should now lead the columns, got ${after[0]}`)
  }
}
// v8 issue 15: the sort survives a view switch
await page.locator('.tracks-view th button', { hasText: 'Title' }).click()
await page.getByRole('button', { name: 'Wheel', exact: true }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Tracks', exact: true }).click()
if (
  (await page.locator('.tracks-view th[aria-sort="ascending"] button').textContent())
    ?.trim()
    .startsWith('Title') !== true
) {
  errors.push('the Title sort did not survive a view round-trip')
}
await page.screenshot({ path: `${scratch}/07a-tracks-view.png` })
// the wheel shows a subtle ring on every tagged track (opener + closer + ★)
await page.getByRole('button', { name: 'Wheel', exact: true }).click()
await page.waitForTimeout(300)
if ((await page.locator('circle.tag-ring').count()) < 3) {
  errors.push(
    `expected at least 3 tag rings on the wheel, got ${await page.locator('circle.tag-ring').count()}`,
  )
}
// Set & suggestions lists the choices read-only, with remove buttons
await page.getByRole('button', { name: /Advanced/ }).click()
const orderRows = await page.locator('.must-list li .must-name').allTextContents()
if (!orderRows.some((r) => r.startsWith('Opens:') && r.includes(openerTitle ?? '@@'))) {
  errors.push(`the opener row is missing from Set & suggestions: [${orderRows}]`)
}
if (!orderRows.some((r) => r.startsWith('Closes:') && r.includes(lastTitle ?? '@@'))) {
  errors.push(`the closer row is missing from Set & suggestions: [${orderRows}]`)
}
if (!orderRows.some((r) => r.startsWith('★'))) {
  errors.push(`the essential row is missing from Set & suggestions: [${orderRows}]`)
}
await page.keyboard.press('Escape') // back to the set panel
// regenerate: both pinned ends must be honoured
await page.locator('.suggest-row .primary').click()
await settleWalk()
await page.waitForTimeout(300)
const firstNow = await page.locator('aside ol li.track .names strong').first().textContent()
if (firstNow !== openerTitle) {
  errors.push(`the tagged opener was not honoured: "${firstNow}" vs "${openerTitle}"`)
}
const lastNow = await page.locator('aside ol li.track .names strong').last().textContent()
if (lastNow !== lastTitle) {
  errors.push(`the pinned closer was lost on regenerate: "${lastNow}" vs "${lastTitle}"`)
}
// clear the pins and the essential mark for the flows below, via the ✕s
await page.getByRole('button', { name: /Advanced/ }).click()
while ((await page.locator('.must-list li .unmark').count()) > 0) {
  await page.locator('.must-list li .unmark').first().click()
  await page.waitForTimeout(100)
}
await page.keyboard.press('Escape')

// hub button: suggest the next track (appends to the set) and jump the
// selection to it, so the next press continues from the head (v7 #17)
const setCountBefore = await page.locator('aside ol li.track').count()
await settleWalk()
await page.locator('g.hub').dispatchEvent('click')
await settleWalk()
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
  await settleWalk()
  await page.locator('g.hub-retry').dispatchEvent('click')
  await settleWalk()
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
await page.getByRole('spinbutton', { name: 'Suggested set length' }).fill('99')
await page.keyboard.press('Escape')
await page.locator('.suggest-row .primary').click()
await settleWalk()
await page.waitForTimeout(400)
// v14 S2: ⚡ Force CONTINUES the short walk in place rather than restarting it
// (single-arm strict prefix — nothing is pinned here). Capture the short walk,
// force it, and confirm the leading rows are preserved; then roll a fresh short
// walk so the exhausted-hub checks below still have one to work with.
{
  const shortRows = await page.locator('aside ol li.track .names strong').allTextContents()
  const forceBtn = page.locator('.suggest-row .force')
  const forceCount = await forceBtn.count()
  // The fixture (Classic-demo-only, length 99) is deterministic, so the short
  // stall MUST manifest — if it doesn't, the walk builder changed, not the test.
  if (shortRows.length <= 1 || forceCount !== 1) {
    errors.push(
      `the short-walk stall scenario did not manifest (${shortRows.length} rows, ${forceCount} ⚡ button) — S2 continue-in-place could not be checked`,
    )
  } else {
    await forceBtn.click()
    await page.waitForTimeout(500)
    const forcedRows = await page.locator('aside ol li.track .names strong').allTextContents()
    if (forcedRows.length <= shortRows.length) {
      errors.push(
        `⚡ Force did not extend the short walk (${shortRows.length} → ${forcedRows.length})`,
      )
    }
    if (forcedRows.slice(0, shortRows.length).join() !== shortRows.join()) {
      errors.push('⚡ Force restarted the walk instead of continuing it (leading rows changed)')
    }
    await page.locator('.suggest-row .primary').click()
    await settleWalk() // fresh short walk
    await page.waitForTimeout(400)
  }
}
if ((await page.locator('g.hub.warning').count()) !== 1) {
  errors.push('an exhausted anchor did not switch the hub to its warning state')
} else {
  const forcedBefore = await page.locator('aside ol li.track').count()
  await page.screenshot({ path: `${scratch}/07c-hub-force.png` })
  await settleWalk()
  await page.locator('g.hub').dispatchEvent('click')
  await settleWalk()
  await page.waitForTimeout(300)
  const forcedAfter = await page.locator('aside ol li.track').count()
  if (forcedAfter !== forcedBefore + 1) {
    errors.push(`the forced hub click did not append: ${forcedBefore} -> ${forcedAfter}`)
  }
  // v8 issues 2+3: the ring is present in force state, morphs to "force
  // retry", degrades to reset-only instead of vanishing, and ⟲ restores
  // the original pick
  if ((await page.locator('g.hub-retry.force').count()) !== 1) {
    errors.push('a forced pick should show the force-retry ring (v8 issue 2)')
  }
  const originalPickRow = await page.locator('aside ol li.track').last().textContent()
  let spentReached = false
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('g.hub-retry.spent').count()) === 1) {
      spentReached = true
      break
    }
    await settleWalk()
    await page.locator('g.hub-retry').dispatchEvent('click')
    await settleWalk()
    await page.waitForTimeout(250)
  }
  if (!spentReached) {
    errors.push('cycling force-retry never reached the reset-only state')
  } else if ((await page.locator('g.hub-reset').count()) !== 1) {
    errors.push('reset-only state is missing its ⟲ button')
  } else {
    await page.screenshot({ path: `${scratch}/07d-retry-spent.png` })
    await settleWalk()
    await page.locator('g.hub-reset').dispatchEvent('click')
    await settleWalk()
    await page.waitForTimeout(250)
    const afterReset = await page.locator('aside ol li.track').last().textContent()
    if (afterReset !== originalPickRow) {
      errors.push(`⟲ should restore the original pick ("${originalPickRow}" vs "${afterReset}")`)
    }
    if ((await page.locator('aside ol li.track').count()) !== forcedAfter) {
      errors.push('⟲ changed the set length instead of swapping the pick back')
    }
  }
}
// v11 issue 16b: after that short suggestion the SET button also offers a
// force mode — it fills the walk with rule-breaking picks and reports how
// many transitions were forced.
{
  // The ⟲ block above hand-edits the active set, and a hand-edit closes the ⚡
  // window on purpose (v14.1 WS8), so roll a fresh short walk first.
  await page.locator('.suggest-row .primary').click()
  await settleWalk()
  const forceButton = page.locator('.suggest-row .force')
  if ((await forceButton.count()) !== 1) {
    errors.push('a short suggestion should morph the button into ⚡ Force to N')
  } else {
    if (!/⚡ Force to 99/.test((await forceButton.textContent()) ?? '')) {
      errors.push('the force button should name the target length')
    }
    await page.screenshot({ path: `${scratch}/07e-force-set.png` })
    await forceButton.click()
    await page.waitForTimeout(400)
    const forcedNote = await page.locator('.forced-note', { hasText: '⚡' }).textContent()
    if (!/forced/.test(forcedNote ?? '')) {
      errors.push('a forced set should report its forced transitions')
    }
    // The pool (Classic demo) is smaller than 99: force uses every track.
    const visibleNodes = await page.locator('g.node').count()
    if ((await page.locator('aside ol li.track').count()) !== visibleNodes) {
      errors.push('force should walk through the entire remaining pool')
    }
    if ((await page.locator('.suggest-row .force').count()) !== 0) {
      errors.push('after forcing, the button should return to its normal state')
    }
  }
}
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.waitForTimeout(400)

// genre map view: overlays, all-method edge tooltip data, nearby ghosts,
// and containment — no node may drift out of the frame (ISSUES.md #12)
await page.getByRole('button', { name: 'Genres', exact: true }).click()
await page.waitForTimeout(1200)
// wheel-only controls DIM off-wheel but stay adjustable (v11 issue 13)
if ((await page.locator('header select:disabled').count()) !== 0) {
  errors.push('Radius/Colour should dim, not disable, in the Genres view (v11)')
}
if ((await page.locator('header label.off-view').count()) !== 2) {
  errors.push('Radius/Colour labels should carry the off-view dim in the Genres view')
}
// v8 issues 12+13: no 'exact' chip (it can never draw an edge), and the five
// remaining chips sit on ONE line
const chipCount = await page.locator('.method-chip').count()
if (chipCount !== 5) errors.push(`expected 5 method chips (no exact), got ${chipCount}`)
if ((await page.locator('.method-chip', { hasText: 'exact' }).count()) !== 0) {
  errors.push("the 'exact' overlay chip should be gone")
}
const chipTops = await page.$$eval('.method-chip', (chips) =>
  chips.map((c) => c.getBoundingClientRect().top),
)
if (new Set(chipTops.map((t) => Math.round(t))).size !== 1) {
  errors.push(`method chips wrap onto multiple lines (tops: ${chipTops})`)
}
// v13 issue 3: the map rests on a faint skeleton, not the full hairball
{
  const restNodes = await page.locator('.genre-node').count()
  const restEdges = await page.locator('line.edge').count()
  if (restEdges === 0) errors.push('genre map rests with no skeleton edges at all')
  if (restEdges > restNodes) {
    errors.push(`resting genre map too dense: ${restEdges} edges for ${restNodes} nodes`)
  }
}
// v8 issue 11, tightened v13 issue 1: grab ONE node — it must pin exactly
// under the pointer (the tow is gone), then be put roughly back so the
// containment check below tests the PHYSICS, not the deliberate shove.
// Grab at the node's ANCHOR via the layer CTM: the <g> bounding box centre
// includes the label and can miss the hit circle.
const nodeAnchor = (index) =>
  page.evaluate((i) => {
    const m = document.querySelector('.zoom-layer').getScreenCTM()
    const t = document.querySelectorAll('.genre-node')[i].transform.baseVal.consolidate().matrix
    return { x: m.a * t.e + m.c * t.f + m.e, y: m.b * t.e + m.d * t.f + m.f }
  }, index)
{
  const grab = await nodeAnchor(0)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  const dest = { x: grab.x + 60, y: grab.y + 40 }
  await page.mouse.move(dest.x, dest.y, { steps: 6 })
  await page.waitForTimeout(150)
  const held = await nodeAnchor(0)
  const pinError = Math.hypot(held.x - dest.x, held.y - dest.y)
  if (pinError > 5) {
    errors.push(`dragged genre node not pinned under the pointer (${pinError.toFixed(1)}px off)`)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  const back = await nodeAnchor(0)
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y, { steps: 6 })
  await page.mouse.up()
}
await page.waitForTimeout(600)
// v8 issue 14: the pair inspector — click two genres, read every method's
// score in a locked card; ✕ clears
await page.waitForTimeout(300)
await page.locator('.genre-node').nth(0).dispatchEvent('click')
if ((await page.locator('.inspector.slim').count()) !== 1) {
  errors.push('selecting one genre should show the "pick a second" hint card')
}
await page.locator('.genre-node').nth(1).dispatchEvent('click')
const inspectorRows = await page.locator('.inspector dt').count()
if (inspectorRows !== 5) {
  errors.push(`the pair inspector should list 5 method scores, got ${inspectorRows}`)
}
// v13 issue 3: comparing shows at most the pair's own link at full opacity
{
  const bold = await page.$$eval(
    'line.edge',
    (ls) => ls.filter((l) => l.getAttribute('opacity') === '1').length,
  )
  if (bold > 1) errors.push(`${bold} full-opacity edges while comparing (want at most 1)`)
}
await page.screenshot({ path: `${scratch}/07b2-pair-inspector.png` })
await page.locator('.inspector .close').click()
if ((await page.locator('.inspector').count()) !== 0) {
  errors.push('✕ did not close the pair inspector')
}
await page.getByRole('button', { name: 'hybrid' }).click()
await page.getByRole('button', { name: 'taxonomy' }).click()
const edgesPreGhost = await page.locator('line.edge').count()
await page.getByRole('checkbox', { name: 'show nearby genres' }).check()
// The cooling is deliberately slow (v10 issue 9, v11 issue 10) and the
// atlas pack (v12) roughly doubled the node count — give the layout time.
await page.waitForTimeout(5200)
const mapNodes = await page.locator('.genre-node').count()
const ghostNodes = await page.locator('.genre-node.ghost').count()
if (mapNodes === 0) errors.push('genre map rendered no nodes')
if (ghostNodes === 0) errors.push('genre map rendered no ghost neighbours')
// v13: ghosts only tether to their summoners — every ghost gets ≥1 anchor
// link, and the total can never exceed the summoners' neighbour budget
{
  const ghostGrowth = (await page.locator('line.edge').count()) - edgesPreGhost
  const realNodes = mapNodes - ghostNodes
  if (ghostGrowth < ghostNodes || ghostGrowth > realNodes * 3) {
    errors.push(
      `ghost tethers out of bounds: +${ghostGrowth} edges for ${ghostNodes} ghosts (${realNodes} real)`,
    )
  }
}
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

// v10 issue 2: the genre method is chosen in the advanced menu now; the combo
// panel shows only a subtle note of the active method.
await page.locator('.criterion button', { hasText: 'ⓘ' }).first().waitFor()
await page.getByRole('button', { name: 'How genre matching works' }).hover()
await page.waitForTimeout(200)
const methodNote = await page.locator('.criterion .tooltip').first().textContent()
if (!methodNote?.includes('Method:')) {
  errors.push(`the criteria-panel method note is missing, got "${methodNote}"`)
}
await page.locator('h1').hover()

// advanced menu (collapsible sections): hybrid explainer with sources,
// top-k controls, split +2/+7 checkboxes, vinyl mode
await page.getByRole('button', { name: /Advanced/ }).click()
if ((await page.locator('aside.panel').count()) === 0) {
  errors.push('advanced settings did not open in the right aside')
}
await ensureSectionOpen('Genre matching')
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
// v10 issue 17: k is a 1–8 number stepper now, not a slider
const kInput = page.getByText('Link each genre to its').locator('input[type=number]')
await kInput.fill('8')
await page.waitForTimeout(200)
const pairsWide = await pairCountText()
await kInput.fill('1')
await page.waitForTimeout(200)
const pairsNarrow = await pairCountText()
if (!(pairsNarrow < pairsWide)) {
  errors.push(`k=1 should match fewer genre pairs than k=8 (${pairsNarrow} vs ${pairsWide})`)
}
await kInput.fill('5')
await page.getByRole('radio').nth(1).check() // switch to threshold mode…
await page.getByText('Similarity ≥').waitFor()
await page.getByRole('radio').first().check() // …and back to mutual top-k
await ensureSectionOpen('Key')
await page.getByRole('checkbox', { name: 'allow +2 moves', exact: false }).check()
await page.getByRole('checkbox', { name: 'allow +2 moves', exact: false }).uncheck()
// Vinyl mode and unit-time both tighten ONE criterion, so each is only
// observable while that criterion is the binding one. Earlier blocks leave the
// criteria in whatever state they needed, and the hub seeds its PRNG from
// Math.random() (WheelView.svelte:795), so the set — and with it the visible
// graph — differs run to run. Pin both: scope to the Classic demo, then enable
// exactly the criterion under test.
// Return to default settings first: it is what resets the key moves and the
// BPM metric ratios (reset.ts:30), and vinyl mode reads the BPM settings even
// while the BPM criterion is off (combos.ts:222 calls bpmCompatibleRatio), so
// leaving half/double or unit time wherever an earlier block left them is what
// made these two checks flaky.
await page.getByRole('button', { name: /Return to default settings/ }).click()
await page.locator('dialog[open]').getByRole('button', { name: 'Reset settings' }).click()
await page.waitForTimeout(600)
await page.keyboard.press('Escape')
await page
  .locator('aside details:has(> summary:has-text("Playlists"))')
  .getByRole('button', { name: 'None' })
  .click()
await page.getByRole('checkbox', { name: 'Classic demo' }).check()
await page.waitForTimeout(600)
// Earlier blocks leave property ranges and mark quick-filters set, which
// narrows the visible library and with it the graph. Put every filter row back
// through its own ↺ and every pseudo row back to "all".
const clearAllFilters = async () => {
  for (const reset of await page.locator('.filter-row .range-reset').all()) {
    await reset.click()
  }
  for (const all of await page
    .locator('.filter-row.pseudo .ring-switch button', { hasText: 'all' })
    .all()) {
    await all.click()
  }
  // Both key rings back on — the Keys row is a pair of independent toggles
  // with no "all", so an earlier minor-only check can leave half the library
  // hidden.
  for (const ring of ['minor', 'major']) {
    const button = page.locator('.ring-switch button', { hasText: ring }).first()
    if ((await button.count()) > 0 && (await button.getAttribute('aria-pressed')) !== 'true') {
      await button.click()
    }
  }
  // And every genre back on (all selected = no genre filter).
  const allGenres = page.locator('aside').first().getByRole('button', { name: 'All' }).first()
  if ((await allGenres.count()) > 0) await allGenres.click()
  await page.waitForTimeout(500)
}
await clearAllFilters()
const CRITERIA = ['Key', 'BPM within', 'Energy within', 'Genre', 'Year within']
const criterionBox = (name) =>
  page.locator('.criterion-head label', { hasText: name }).locator('input[type="checkbox"]').first()
// Enable the one we want FIRST, then switch the others off: going through a
// zero-enabled state leaves the threshold at 1 with nothing that can satisfy
// it (toggleCriterion only clamps while something is still enabled), and the
// graph comes back empty.
const onlyCriterion = async (keep) => {
  const keepBox = criterionBox(keep)
  if (!(await keepBox.isChecked())) await keepBox.setChecked(true)
  for (const name of CRITERIA) {
    if (name === keep) continue
    const box = criterionBox(name)
    if (await box.isChecked()) await box.setChecked(false)
  }
  await page.waitForTimeout(600)
}

await onlyCriterion('Key')
await page.getByRole('button', { name: /Advanced/ }).click()
await ensureSectionOpen('Key')
// Vinyl mode re-compares keys AFTER the pitch shift beatmatching implies
// (combos.ts:216), so it re-wires the graph rather than strictly shrinking it —
// the edge COUNT can land on the same number while the edges themselves differ.
// Fingerprint the geometry instead.
const edgeFingerprint = () =>
  page.$$eval('.combo-edge', (es) =>
    es
      .map(
        (e) =>
          `${e.getAttribute('x1')},${e.getAttribute('y1')},${e.getAttribute('x2')},${e.getAttribute('y2')}`,
      )
      .sort()
      .join('|'),
  )
// .combo-edge draws the suggestion edges around the SELECTED track only
// (v9 issue 8), so the count is meaningless until a known track is selected —
// and the hub's random seed means whatever was selected before differs run to
// run. Pick the first star by label, deterministically.
const anchorLabel = (
  await page.$$eval('g.node', (gs) => gs.map((g) => g.getAttribute('aria-label')))
).sort()[0]
await page.locator(`g.node[aria-label="${anchorLabel}"]`).dispatchEvent('click')
await page.waitForTimeout(500)
const edgesBefore = await page.locator('.combo-edge').count()
const fingerprintBefore = await edgeFingerprint()
// Key-only over the Classic demo is 9 edges; the guard is here to catch the
// graph collapsing entirely, not to pin that number.
if (edgesBefore < 5) {
  errors.push(`the vinyl-mode check needs a graph to rewire, got ${edgesBefore} edges`)
}
await page.getByRole('checkbox', { name: 'vinyl mode' }).check()
await page.waitForTimeout(400)
const edgesVinyl = await page.locator('.combo-edge').count()
if ((await edgeFingerprint()) === fingerprintBefore) {
  errors.push(`vinyl mode changed no edges (${edgesBefore} → ${edgesVinyl}, same geometry)`)
}
await page.getByRole('checkbox', { name: 'vinyl mode' }).uncheck()
await page.waitForTimeout(300)

// BPM metric ratios (v8 issue 6): unit time off shows a warning hint in the
// combo panel and strips the ordinary 1:1 edges
await onlyCriterion('BPM within')
const edgesBpm = await page.locator('.combo-edge').count()
await page.getByRole('checkbox', { name: '± unit time', exact: false }).uncheck()
await page.waitForTimeout(400)
await page.locator('.ratio-note.warn', { hasText: 'unit time off' }).waitFor()
const edgesNoUnit = await page.locator('.combo-edge').count()
if (edgesNoUnit >= edgesBpm) {
  errors.push(`unit time off should strip edges (${edgesBpm} → ${edgesNoUnit})`)
}
await page.getByRole('checkbox', { name: '± unit time', exact: false }).check()
await page.waitForTimeout(300)
// put every criterion back so the rest of the flow sees the default shape
for (const name of CRITERIA) {
  const box = criterionBox(name)
  if (!(await box.isChecked())) await box.setChecked(true)
}
await page.waitForTimeout(500)
// half/double moved here from the combo panel (v8 issue 6); leave it on for
// the rest of the flow, as before
await page.getByRole('checkbox', { name: /half\/double/ }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/09-advanced.png` })
// the same-key spread bounds the deterministic relaxation (v9 issues 1+17):
// 0 collapses the fans, and restoring 1 reproduces the EXACT layout — no
// randomness (the ↻ re-jitter button is gone)
await ensureSectionOpen('Display')
if ((await page.getByRole('button', { name: 'Re-jitter same-key fans' }).count()) !== 0) {
  errors.push('the ↻ re-jitter button should be gone (v9 issue 1)')
}
const fanProbe = () =>
  page.$$eval('g.node', (gs) =>
    gs.map((g) => ({
      label: g.getAttribute('aria-label'),
      d: g.querySelector('path')?.getAttribute('transform'),
    })),
  )
const setSpread = (value) =>
  page
    .locator('.panel label', { hasText: 'Same-key spread' })
    .locator('input[type=range]')
    .evaluate((el, v) => {
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
await settleWheel()
const beforeSpread = await fanProbe()
await setSpread('0')
await settleWheel()
const collapsed = await fanProbe()
if (!collapsed.some((a) => beforeSpread.find((b) => b.label === a.label)?.d !== a.d)) {
  errors.push('spread 0 moved no same-key fan nodes')
}
await setSpread('1')
await settleWheel()
const restored = await fanProbe()
const drifted = restored.filter((a) => beforeSpread.find((b) => b.label === a.label)?.d !== a.d)
if (drifted.length > 0) {
  errors.push(`the relaxation is not deterministic: ${drifted.length} nodes drifted after 0→1`)
}
// the colour scheme tints the whole app: --accent follows the scheme in
// both themes (ISSUES.md v7 #13)
const readAccent = () =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  )
const accentBlue = await readAccent()
await page
  .locator('.panel label', { hasText: 'Colour scheme' })
  .locator('select')
  .selectOption('violet')
const accentViolet = await readAccent()
if (accentViolet === accentBlue) {
  errors.push('selecting the violet scheme did not change --accent')
}
await page.locator('button.theme-toggle').click()
await page.waitForTimeout(200)
const accentVioletLight = await readAccent()
if (accentVioletLight === accentViolet || accentVioletLight === accentBlue) {
  errors.push('the light theme did not keep its own violet accent')
}
await page.screenshot({ path: `${scratch}/09b-violet-scheme.png` })
await page.locator('button.theme-toggle').click()
await page.waitForTimeout(200)
await page
  .locator('.panel label', { hasText: 'Colour scheme' })
  .locator('select')
  .selectOption('blue')
await ensureSectionOpen('Display')
await page.keyboard.press('Escape')
if ((await page.locator('aside.panel').count()) !== 0) {
  errors.push('Escape did not close the advanced aside')
}

// icon modes (v8 issues 4+5): changing the combo criterion's method no
// longer reshuffles the node shapes, and the playlists mode swaps the
// legend over to playlist names
const shapeFingerprint = () =>
  page.$$eval('g.node path', (ps) =>
    ps
      .slice(0, 80)
      .map((p) => p.getAttribute('d'))
      .join('|'),
  )
const shapesHybrid = await shapeFingerprint()
// v10 issue 2: the genre method lives in the advanced menu now. Changing it
// must NOT reshuffle the wheel's node shapes (v8 issue 4).
await page.getByRole('button', { name: /Advanced/ }).click()
await ensureSectionOpen('Genre matching')
const advMethodSelect = page
  .locator('.panel details.section', { hasText: 'Genre matching' })
  .locator('select')
  .first()
await advMethodSelect.selectOption('graph')
await page.waitForTimeout(500)
if ((await shapeFingerprint()) !== shapesHybrid) {
  errors.push('changing the genre method still reshuffles node shapes (v8 issue 4)')
}
await advMethodSelect.selectOption('hybrid')
await page.waitForTimeout(300)
// v11 issue 6: the method explainer's ⓘ pins open on click, so its citation
// links are reachable; an outside click dismisses it.
{
  const methodInfo = page
    .locator('.panel details.section', { hasText: 'Genre matching' })
    .locator('.info')
    .first()
  await methodInfo.click()
  await page.locator('h1').hover() // move the pointer well away
  await page.waitForTimeout(200)
  if ((await page.locator('.info-wrap .tooltip').count()) !== 1) {
    errors.push('a clicked ⓘ should stay pinned open after the pointer leaves')
  }
  if ((await page.locator('.info-wrap .tooltip a').count()) === 0) {
    errors.push('the pinned method explainer should expose its citation links')
  }
  await page.locator('.panel .head h2').click()
  await page.waitForTimeout(200)
  if ((await page.locator('.info-wrap .tooltip').count()) !== 0) {
    errors.push('an outside click should dismiss the pinned tooltip')
  }
}
await ensureSectionOpen('Display')
await page
  .locator('.panel label', { hasText: 'Node icons' })
  .locator('select')
  .selectOption('playlists')
await page.waitForTimeout(500)
// v11 issue 7: ALL sample playlists are selected here — more than the class
// cap — so the playlists mode must drop distinction entirely (no chips)…
if ((await page.locator('.shape-chip').count()) !== 0) {
  errors.push('a class cap below the playlist count should drop every shape chip (v11 issue 7)')
}
// …until the selection narrows to within the cap.
await page.locator('aside').first().getByRole('button', { name: 'None' }).first().click()
for (const name of ['Classic demo', 'Peak-Time Techno', 'Trance Journey']) {
  await page.getByRole('checkbox', { name }).check()
}
await page.waitForTimeout(600)
const chipLabels = await page.$$eval('.shape-chip', (chips) => chips.map((c) => c.textContent))
if (!chipLabels.some((label) => label?.includes('Classic demo'))) {
  errors.push(`playlists icon mode should list playlist names within the cap (${chipLabels})`)
}
await page.screenshot({ path: `${scratch}/08b-playlist-icons.png` })
await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
await page.waitForTimeout(400)
await page
  .locator('.panel label', { hasText: 'Node icons' })
  .locator('select')
  .selectOption('families')
await page.waitForTimeout(300)
await ensureSectionOpen('Display')
await page.keyboard.press('Escape')

// minor/major key filter (v8 issue 10; the switch moved to Filters in v9
// issue 6): minor-only hides the B ring's nodes and fades its sector tint;
// "both" restores everything
await page
  .locator('aside details:has(> summary:has-text("Filters"))')
  .evaluate((d) => (d.open = true))
const nodesBothRings = await page.locator('g.node').count()
await page.locator('.ring-switch button', { hasText: 'minor' }).click()
await page
  .waitForFunction((n) => document.querySelectorAll('g.node').length < n, nodesBothRings, {
    timeout: 5000,
  })
  .catch(() => {})
const nodesMinor = await page.locator('g.node').count()
if (!(nodesMinor < nodesBothRings)) {
  errors.push(`minor-only should hide B-ring nodes (${nodesBothRings} → ${nodesMinor})`)
}
if ((await page.locator('path.sector.excluded').count()) !== 12) {
  errors.push('minor-only should fade exactly the 12 major sectors')
}
await page.screenshot({ path: `${scratch}/09c-minor-only.png` })
// The key rings are two independent toggles now (minor / major), not a
// tri-state with a "both" button: re-pressing 'minor' restores both rings.
await page.locator('.ring-switch button', { hasText: 'minor' }).click()
await page.waitForTimeout(600)
if ((await page.locator('g.node').count()) !== nodesBothRings) {
  errors.push('switching back to both rings did not restore the nodes')
}

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

// reload → autosave restores everything, the set's custom name included
// (give the debounced save time to flush)
await page.getByRole('button', { name: 'Rename constellation' }).click()
await page.locator('aside .head input.rename').fill('Sunrise closing')
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
await page.reload()
await page.getByText('combo suggestions').waitFor()
await page.getByText('4 tracks', { exact: true }).waitFor()
const restoredSetName = await page
  .locator('aside .head select')
  .evaluate((s) => s.selectedOptions[0]?.textContent)
if (restoredSetName !== 'Sunrise closing') {
  errors.push(`the set name did not survive the reload: "${restoredSetName}"`)
}
// v8 issue 17: the advanced menu remembers its open sections across reloads
// (Set & suggestions was opened early in this flow; the others never were)
await page.getByRole('button', { name: /Advanced/ }).click()
const rememberedOpen = await page
  .locator('.panel details.section')
  .evaluateAll((ds) => ds.filter((d) => d.open).map((d) => d.querySelector('summary')?.textContent))
if (rememberedOpen.length === 0) {
  errors.push('the advanced menu forgot its open sections across the reload')
}
if (!rememberedOpen.includes('Constellation & suggestions')) {
  errors.push(`Constellation & suggestions should be remembered open, got [${rememberedOpen}]`)
}
await page.keyboard.press('Escape')
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
// The outgoing stars fade rather than vanish, so count once they are gone.
await page
  .waitForFunction(() => document.querySelectorAll('g.node').length === 0, null, { timeout: 5000 })
  .catch(() => {})
if ((await page.locator('g.node').count()) !== 0) {
  errors.push('collection with playlists did not start with an empty wheel')
}
await page.getByRole('checkbox', { name: 'Warm-up & After' }).check()
await page
  .waitForFunction(() => document.querySelectorAll('g.node').length === 2, null, { timeout: 5000 })
  .catch(() => {})
if ((await page.locator('g.node').count()) !== 2) {
  errors.push('toggling a playlist did not reveal exactly its tracks')
}
// with every visible track in the set, the hub greys out (v7 #17).
// Re-locate each node by its label rather than reusing handles from .all():
// paintedNodes re-ranks the group on every selection, so a handle captured
// before the first append points at a different star afterwards and the
// second dblclick lands on the track that is already in the set.
{
  const labels = await page.$$eval('g.node', (gs) => gs.map((g) => g.getAttribute('aria-label')))
  let expected = await page.locator('aside ol li.track').count()
  for (const label of labels) {
    await page.locator(`g.node[aria-label="${label}"]`).dblclick({ force: true })
    expected += 1
    // Wait for the append itself, not for a proxy: the hub's class settles
    // only after the reveal window, and a dblclick that lands mid-cascade
    // takes a moment to show up in the list.
    await page
      .waitForFunction(
        (n) => document.querySelectorAll('aside ol li.track').length >= n,
        expected,
        { timeout: 8000 },
      )
      .catch(() => errors.push(`double-clicking "${label}" did not append it to the set`))
    await settleWalk()
  }
}
// The last append still has to flow through the reveal window before the hub
// settles into its all-used state, so wait for the condition rather than
// sampling it.
await page
  .locator('g.hub.disabled')
  .waitFor({ timeout: 8000 })
  .catch(() => {})
if ((await page.locator('g.hub.disabled').count()) !== 1) {
  errors.push('the hub did not disable once every visible track was in the set')
}
await page.locator('aside').last().getByRole('button', { name: 'Clear' }).click()
// v10: Clear now asks to confirm; v11 issue 17: the dialog no longer claims
// the clear "cannot be undone" (Cmd+Z restores it).
{
  const dialogBody = await page.locator('dialog[open] p').textContent()
  if (/cannot be undone/i.test(dialogBody ?? '')) {
    errors.push('the clear-set dialog still claims it cannot be undone (v11 issue 17)')
  }
}
await page.getByRole('button', { name: 'Clear constellation' }).click()
await page.waitForTimeout(150)
// v11 issue 12a: with the set now empty, the tracks-view ☰ toggle disables.
await page.getByRole('button', { name: 'Tracks', exact: true }).click()
if (!(await page.locator('.pos-toggle').isDisabled())) {
  errors.push('the ☰ set-only toggle should disable while the set is empty')
}
await page.getByRole('button', { name: 'Wheel', exact: true }).click()
await page.waitForTimeout(200)
// the genre checklist follows the playlist selection (ISSUES.md v7 #14):
// Warm-up & After holds only a Melodic House track (plus one without genre),
// so the collection's other genres must not clutter the list
// (the checklist is its own top-level Genres section since v9 issue 7)
const genresDetails = page.locator('aside details:has(> summary:has-text("Genres"))')
await genresDetails.evaluate((d) => (d.open = true))
const scopedGenreList = await genresDetails.locator('li').allTextContents()
const scopedTrimmed = scopedGenreList.map((s) => s.trim())
if (scopedTrimmed.join() !== 'Melodic House') {
  errors.push(`genre checklist not scoped to the selected playlist: [${scopedTrimmed}]`)
}
await genresDetails.evaluate((d) => (d.open = false))
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

// ---- v12: fun & substance ----

// Walk-draw reveal via the s hotkey (WS1 + WS14): mid-flight some edges are
// still hidden by their stagger; settled, none are.
// Every visible track may already be in the active set here, in which case
// `s` has nothing to add and there is no cascade to catch mid-flight. Clear
// it first — Clear only renders while the set has rows, so this is optional.
const clearBtn = page.locator('aside').last().getByRole('button', { name: 'Clear' })
if ((await clearBtn.count()) > 0) {
  await clearBtn.click()
  await page.getByRole('button', { name: 'Clear constellation' }).click()
  await page.waitForTimeout(300)
}
await page.locator('h1').click()
await page.keyboard.press('s')
await page.waitForTimeout(320)
{
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll('polyline.walk-edge')].filter(
        (e) => Number(getComputedStyle(e).opacity) < 0.5,
      ).length,
  )
  if (hidden === 0) errors.push('walk reveal: no staggered edges mid-flight after s')
}
await page.screenshot({ path: `${scratch}/18-walk-reveal.png` })
await page.waitForTimeout(3600)
{
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll('polyline.walk-edge')].filter(
        (e) => Number(getComputedStyle(e).opacity) < 0.5,
      ).length,
  )
  if (hidden !== 0) errors.push('walk reveal did not settle')
}

// Manual edges (WS9): 🔗 link mode marks a dashed always-visible road.
await page.locator('g.node').first().dispatchEvent('click')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Mark a combo with another track' }).click()
await page.locator('g.node').nth(60).dispatchEvent('click')
await page.waitForTimeout(200)
if ((await page.locator('line.manual-edge').count()) !== 1) {
  errors.push('the 🔗 link mode did not draw a manual edge')
}
await page.screenshot({ path: `${scratch}/19-manual-edge.png` })
await page.locator('g.node').nth(60).dispatchEvent('click') // unmark again
if ((await page.locator('line.manual-edge').count()) !== 0) {
  errors.push('clicking the marked partner again did not unmark it')
}
// v14 WS1: the hand-edit affordance (✎) was removed — this app never edits
// track metadata.
if ((await page.getByRole('button', { name: 'Edit key, BPM and genre by hand' }).count()) !== 0) {
  errors.push('the ✎ hand-edit affordance should be gone from the selected-track card (v14 WS1)')
}
await page.keyboard.press('Escape') // deselect

// Energy as the radial axis (WS8): the Genre Atlas pack carries MIK comments.
await page.locator('header select').first().selectOption('energy')
await page.waitForTimeout(900)
await page.screenshot({ path: `${scratch}/20-energy-radius.png` })
await page.locator('header select').first().selectOption('bpm')
await page.waitForTimeout(400)

// The set portrait (WS3) downloads as a PNG poster.
page.once('dialog', (d) => d.accept(d.defaultValue()))
{
  const [portrait] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Portrait', exact: true }).click(),
  ])
  if (!portrait.suggestedFilename().endsWith('.png')) {
    errors.push(`portrait download name: ${portrait.suggestedFilename()}`)
  }
}

// Easy mode (v14 E1): easy must COMPUTE WITH independent defaults, not merely
// display whatever the advanced side holds. Prove it against a deliberately
// DIRTY advanced state — a narrowing filter and a locked (demanded) criterion —
// so a broken effective-store layer that leaked the stored state through would
// be caught here (a default-vs-default comparison could not tell them apart).
const visTracks = async () =>
  Number.parseInt((await page.locator('.stat .value').first().textContent()) ?? '0', 10)
const comboStat = async () =>
  Number.parseInt((await page.locator('.stat .value').nth(1).textContent()) ?? '0', 10)
// Normalise the one criteria residue this long flow left non-default (half/double
// was deliberately kept on earlier) so the baseline below IS the default state,
// and easy's default-computed combo count can be compared to it exactly.
await page.getByRole('button', { name: /Advanced/ }).click()
await ensureSectionOpen('Key & BPM')
await page.getByRole('checkbox', { name: /half\/double/ }).uncheck()
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
const baseTracks = await visTracks()
const baseCombos = await comboStat()
// dirty #1: a Rating≥5 filter measurably narrows the visible tracks
const filtersDetails = page.locator('aside details:has(> summary:has-text("Filters"))')
await filtersDetails.evaluate((d) => (d.open = true))
await page.locator('.filter-row', { hasText: 'Rating' }).locator('input').first().fill('5')
await page.waitForTimeout(700)
// dirty #2: lock the Key criterion — the demanded gate reshapes the combo count
const keyLock = page.locator('.criterion', { hasText: 'Key' }).first().locator('.lock')
await keyLock.click()
await page.waitForTimeout(800)
const dirtyTracks = await visTracks()
const dirtyCombos = await comboStat()
if (!(dirtyTracks < baseTracks)) {
  errors.push(
    `the Rating≥5 filter should narrow the visible tracks (${baseTracks} → ${dirtyTracks})`,
  )
}
if (!(dirtyCombos < baseCombos)) {
  errors.push(
    `locking Key (demanded) should reduce the combo count (${baseCombos} → ${dirtyCombos})`,
  )
}

await page.getByRole('button', { name: 'Easy mode' }).click()
await page.waitForTimeout(900)
if (await page.locator('.view-switch').isVisible()) {
  errors.push('easy mode left the view switch visible')
}
// easy computes with default criteria/filters, so their editors vanish…
if ((await page.locator('.criterion').count()) !== 0) {
  errors.push('easy mode still showed the combo-criteria controls')
}
if ((await page.locator('.filter-row').count()) !== 0) {
  errors.push('easy mode still showed the filter rows')
}
// …and the ENGINE runs on defaults INDEPENDENT of the dirty advanced state: the
// filter is bypassed (the full track count returns) and the demanded lock is
// gone (the combo count returns to its default), NOT the narrowed/locked values.
const easyTracks = await visTracks()
const easyCombos = await comboStat()
if (easyTracks !== baseTracks) {
  errors.push(
    `easy mode did not compute filters as defaults (${baseTracks} want, got ${easyTracks})`,
  )
}
if (easyCombos === dirtyCombos) {
  errors.push(
    `easy mode should bypass the demanded Key lock, but the combo count is unchanged (${easyCombos})`,
  )
}
// ★ / pins / 🔗 are hidden and inert — the selected card drops its marks.
await page.locator('g.node').first().dispatchEvent('click')
await page.waitForTimeout(200)
if ((await page.locator('.selected-card .mark-toggle').count()) !== 0) {
  errors.push('easy mode still showed the ★/pins/🔗 marks on the selected-track card')
}
await page.keyboard.press('Escape')
await page.screenshot({ path: `${scratch}/21-easy-mode.png` })
await page.getByRole('button', { name: 'All controls' }).click()
await page.waitForTimeout(900)
if (!(await page.locator('.view-switch').isVisible())) {
  errors.push('leaving easy mode did not restore the view switch')
}
// "exactly as you left it": the dirty advanced state is RESTORED untouched —
// the filter narrows again and the Key lock is still set (easy never mutated
// the stored state, it only bypassed it).
if ((await visTracks()) !== dirtyTracks) {
  errors.push('returning to All controls did not restore the narrowing filter')
}
if ((await keyLock.getAttribute('aria-pressed')) !== 'true') {
  errors.push('returning to All controls did not restore the Key criterion lock')
}
// clean up so downstream steps keep their baseline
await keyLock.click() // unlock
await filtersDetails.evaluate((d) => (d.open = true))
await page.getByRole('button', { name: 'Reset Rating filter' }).click()
await page.waitForTimeout(600)
await filtersDetails.evaluate((d) => (d.open = false))

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

// v14.1 WS8: a hand-edit of the active set closes the ⚡ force window — the
// forced-count banner and the ⚡ button must never keep describing a set the
// user has since altered by hand (removeAt / move / Clear all funnel through
// closeForceWindow). Proven here, right before the reset, because rolling a
// deliberate short walk perturbs the shared suggest seed and the selection
// chain; every selection-sensitive check above has already run, and the reset
// below wipes all of this regardless. Reproduce the force section's
// deterministic stall: Classic-demo-only pool, suggest length 99.
{
  // A clean shelf keeps the eighth-set cap out of the way when ✨ needs to
  // spawn a set to roll on (the active set here may be hand-edited).
  while ((await page.locator('aside .head select option').count()) > 1) {
    await page.getByRole('button', { name: 'Delete constellation' }).click()
    await page.waitForTimeout(100)
  }
  await page.locator('aside').first().getByRole('button', { name: 'None' }).first().click()
  await page.getByRole('checkbox', { name: 'Classic demo' }).check()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.getByRole('spinbutton', { name: 'Suggested set length' }).fill('99')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.locator('.suggest-row .primary').click()
  await settleWalk() // roll a short walk → ⚡ appears
  await page.waitForTimeout(400)
  if ((await page.locator('.suggest-row .force').count()) !== 1) {
    errors.push('WS8: the deterministic short walk did not surface the ⚡ force button to close')
  } else {
    // Hand-edit the SAME active set: remove a transition row's ✕ control.
    await page.locator('aside ol li.track').last().hover()
    await page.locator('aside ol li.track').last().getByRole('button', { name: 'Remove' }).click()
    await page.waitForTimeout(200)
    if ((await page.locator('.suggest-row .force').count()) !== 0) {
      errors.push('WS8: a hand-edit (remove row) did not close the ⚡ force button')
    }
    if ((await page.locator('.forced-note', { hasText: '⚡' }).count()) !== 0) {
      errors.push('WS8: a hand-edit (remove row) did not clear the forced-transitions banner')
    }
  }
}

// ---- v33: the analysis provenance layer ----
// The wheel places nodes from the FULL library and decides gutter-versus-ring
// on `track.key === null`, across six separate reads. Nothing in the vitest
// suite can see that — .svelte files have no coverage — so if those reads ever
// revert to the raw store, THIS is the only thing that catches it: the node
// would keep rendering an em dash for its key while the Tracks table showed
// the filled value.
{
  await page.getByRole('button', { name: 'Load sample' }).click()
  // Whatever this run left behind may or may not need confirming.
  const replaceDialog = page.getByRole('button', { name: 'Replace and load' })
  if (await replaceDialog.isVisible().catch(() => false)) await replaceDialog.click()
  await page.locator('.status .name', { hasText: 'Sample collection' }).waitFor()
  await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
  await page.waitForTimeout(600)

  const labelOf = (title) =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll('g.node[aria-label]')].find((n) =>
        n.getAttribute('aria-label').startsWith(t + ' —'),
      )
      return el ? el.getAttribute('aria-label') : null
    }, title)

  if (!/— — ·/.test((await labelOf('Untitled Dub')) ?? '')) {
    errors.push('v33: the sample library no longer offers a keyless "Untitled Dub" to fill')
  }

  await page.setInputFiles('input[type=file]', 'tests/fixtures/sample-analysis.json')
  await page.waitForTimeout(1200)

  const dub = (await labelOf('Untitled Dub')) ?? ''
  if (!/5A/.test(dub)) errors.push(`v33: an analysed key never reached the wheel node — "${dub}"`)
  const reeds = (await labelOf('Reeds')) ?? ''
  if (!/84\.11/.test(reeds)) {
    errors.push(`v33: an analysed BPM never reached the wheel node — "${reeds}"`)
  }
  // keyConf 0.18 sits below the bar, so the refusal must hold on screen too.
  const tape = (await labelOf('Found Tape')) ?? ''
  if (!/— — ·/.test(tape)) {
    errors.push(`v33: a below-confidence key was shown rather than refused — "${tape}"`)
  }
  await page.screenshot({ path: `${scratch}/18-analysis-wheel.png` })

  const info = page
    .locator('.status')
    .getByRole('button', { name: /import details/i })
    .first()
  if (await info.isVisible().catch(() => false)) {
    await info.click()
    await page.waitForTimeout(250)
    const text = await page.evaluate(() => document.body.innerText)
    if (!/BPM filled 3\/3/.test(text)) errors.push('v33: the import note lost its BPM fill count')
    if (!/1 below confidence/.test(text)) errors.push('v33: the import note hid the refusal')
    await page.keyboard.press('Escape')
  } else {
    errors.push('v33: no import-details tooltip after importing a sidecar')
  }

  await page.getByRole('button', { name: 'Tracks', exact: true }).first().click()
  await page.waitForTimeout(500)
  if ((await page.locator('td.analysed').count()) === 0) {
    errors.push('v33: no analysed value is marked in the Tracks table')
  }
  const marker = await page.locator('td.analysed').first().getAttribute('title')
  if (!/analysed locally/i.test(marker ?? '')) {
    errors.push(`v33: the provenance marker does not explain itself — "${marker}"`)
  }
  await page.screenshot({ path: `${scratch}/19-analysis-table.png` })
  await page.getByRole('button', { name: 'Wheel', exact: true }).first().click()
  await page.waitForTimeout(300)
}

// ---- v34: analysed ENERGY reaches the radial axis ----
// v33's block proves an analysed KEY moves a node between the gutter and the
// ring. WS2's payload is energy, which travels a different road: it is not in
// the node's aria-label at all, it lands on the radial scale, and a track with
// no radial value renders dimmed (WheelView.svelte:694, opacity 0.55) at the
// bottom of the wheel. So the only observable proof that an arousal in the
// sidecar became a radius is the node's own geometry. Unit tests reach
// mergeAnalysis but never the placement pass.
{
  await page.locator('select').filter({ hasText: 'Energy' }).first().selectOption('energy')
  await page.waitForTimeout(800)

  // The first child circle carries the node's position (the dot's own
  // transform is scaled by zoom, this is not).
  const nodeGeometry = (title) =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll('g.node[aria-label]')].find((n) =>
        n.getAttribute('aria-label').startsWith(t + ' —'),
      )
      if (el === undefined) return null
      const circle = el.querySelector('circle')
      return {
        opacity: Number(el.getAttribute('opacity')),
        x: Number(circle.getAttribute('cx')),
        y: Number(circle.getAttribute('cy')),
      }
    }, title)

  const dimmedCount = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('g.node[opacity]')].filter(
          (n) => Math.abs(Number(n.getAttribute('opacity')) - 0.55) < 0.01,
        ).length,
    )

  const before = await nodeGeometry('Warehouse Prayer')
  const dimmedBefore = await dimmedCount()
  if (before === null) {
    errors.push('v34: the sample library no longer offers "Warehouse Prayer" on the wheel')
  } else if (Math.abs(before.opacity - 0.55) > 0.01) {
    errors.push(
      `v34: "Warehouse Prayer" should start with no energy and render dimmed, got opacity ${before.opacity}`,
    )
  }

  await page.setInputFiles('input[type=file]', 'tests/fixtures/sample-analysis-energy.json')
  await page.waitForTimeout(1400)

  const after = await nodeGeometry('Warehouse Prayer')
  if (after === null) {
    errors.push('v34: "Warehouse Prayer" vanished from the wheel after the energy sidecar')
  } else {
    if (Math.abs(after.opacity - 1) > 0.01) {
      errors.push(
        `v34: an analysed energy never reached the radial axis — the node is still dimmed at ${after.opacity}`,
      )
    }
    // arousal 8.8 maps to energy 10, the outer edge; it started with no
    // radial value at all, parked below the wheel.
    if (before !== null && Math.abs(after.y - before.y) < 1 && Math.abs(after.x - before.x) < 1) {
      errors.push('v34: the node never moved, so the energy fill did not reach placement')
    }
  }

  const dimmedAfter = await dimmedCount()
  if (!(dimmedAfter < dimmedBefore)) {
    errors.push(
      `v34: filling five energies left the missing-radial count unchanged (${dimmedBefore} then ${dimmedAfter})`,
    )
  }

  // The five fixture tracks carry arousal only — no bpm, no key — so nothing
  // else about them may change. Rekordbox truth is still the only key source.
  const label = await page.evaluate(() => {
    const el = [...document.querySelectorAll('g.node[aria-label]')].find((n) =>
      n.getAttribute('aria-label').startsWith('Warehouse Prayer —'),
    )
    return el ? el.getAttribute('aria-label') : null
  })
  if (label !== null && !/9A/.test(label)) {
    errors.push(`v34: an energy-only sidecar disturbed the node's key — "${label}"`)
  }

  await page.screenshot({ path: `${scratch}/20-analysis-energy-radius.png` })
  await page.locator('select').filter({ hasText: 'Energy' }).first().selectOption('bpm')
  await page.waitForTimeout(300)
}

// ---- v35: the descriptors as columns and filters ----
// Everything below is invisible to vitest: .svelte files have no coverage, so
// the registry can be right in the unit suite while the column renders a bare
// number, the group never opens, or the ⓘ steals the filter boxes' width. The
// energy sidecar loaded just above carries all four descriptors already.
{
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.getByRole('checkbox', { name: 'Danceability column', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Danceability filter', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Arousal column', exact: true }).check()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Tracks', exact: true }).first().click()
  await page.waitForTimeout(500)

  // The registry's percent formatter, on the real merge path: danceability
  // 0.94 in the fixture must read 94%, not 0.94 and not 94.
  const cells = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].map((h) => h.innerText.trim())
    const col = heads.findIndex((h) => /Danceability/i.test(h))
    if (col === -1) return null
    return [...document.querySelectorAll('tbody tr')]
      .map((r) => r.children[col]?.textContent?.trim() ?? '')
      .filter((t) => t !== '' && t !== '—')
  })
  if (cells === null) {
    errors.push('v35: the Danceability column never reached the Tracks table')
  } else if (!cells.some((t) => /^\d{1,3}%$/.test(t))) {
    errors.push(`v35: a descriptor is not rendering as a whole percentage — got ${cells[0]}`)
  }

  // The provenance underline must survive on an analysis-only column. The
  // first draft exempted these and review was right that it should not.
  const underlined = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].map((h) => h.innerText.trim())
    const col = heads.findIndex((h) => /Danceability/i.test(h))
    return [...document.querySelectorAll('tbody tr')].some(
      (r) => r.children[col]?.classList.contains('analysed') === true,
    )
  })
  if (!underlined) errors.push('v35: a descriptor cell lost its analysed marker')

  // The header carries its hint as a title, not an ⓘ — the colgroup measures
  // header TEXT, so an icon would cost width the measurement cannot see.
  const headTitle = await page.evaluate(() => {
    const th = [...document.querySelectorAll('th')].find((h) => /Danceability/i.test(h.innerText))
    return th?.getAttribute('title') ?? ''
  })
  if (!/danceable/i.test(headTitle)) {
    errors.push(`v35: the Danceability header explains nothing — "${headTitle}"`)
  }
  await page.screenshot({ path: `${scratch}/21-descriptor-columns.png` })

  await page.getByRole('button', { name: 'Wheel', exact: true }).first().click()
  await page.waitForTimeout(300)

  // The Analysis caption: present now that one descriptor filter is visible,
  // and its rows must line up with BPM/Year/Rating. It nests inside the
  // Filters section, which this far into the run is closed.
  const filters = page.locator('aside').first().locator('details', { hasText: 'Filters' }).first()
  if (!(await filters.evaluate((d) => d.open))) {
    await page.locator('summary', { hasText: 'Filters' }).first().click()
    await page.waitForTimeout(200)
  }

  // v35.1: a caption, NOT a <details>. The nested collapsible read as a peer
  // of Playlists/Genres and hid rows the user had just switched on, so this
  // asserts the group is un-collapsible as much as that it exists.
  if ((await page.locator('.analysis-caption').count()) === 0) {
    errors.push('v35.1: the Analysis caption never appeared')
  }
  if ((await page.locator('details.analysis-group').count()) > 0) {
    errors.push('v35.1: the Analysis group is a collapsible again')
  }
  if ((await page.locator('.filter-label.descriptor').count()) === 0) {
    errors.push('v35.1: no descriptor filter row rendered')
  }

  // The alignment this rework exists for: every filter row's min box, max box
  // and ↺ share one left edge. A regression here is invisible to vitest and
  // to the typechecker — it is pure layout — and it is exactly what the 72px
  // descriptor label column used to break.
  const align = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.filter-row')].filter(
      (r) => r.querySelector('input[type=number]') !== null,
    )
    const edge = (r, sel) => {
      const el = r.querySelector(sel)
      return el === null ? null : Math.round(el.getBoundingClientRect().left)
    }
    return {
      n: rows.length,
      mins: [...new Set(rows.map((r) => edge(r, 'input[type=number]')))],
      resets: [...new Set(rows.map((r) => edge(r, '.range-reset')).filter((x) => x !== null))],
      boxes: rows.map((r) => Math.round(r.querySelector('input').getBoundingClientRect().width)),
    }
  })
  if (align.n < 2) {
    errors.push(`v35.1: only ${align.n} numeric filter rows on show — alignment unproven`)
  } else {
    if (align.mins.length !== 1) {
      errors.push(`v35.1: filter number boxes start at ${align.mins.join('/')}px, not one edge`)
    }
    if (align.resets.length !== 1) {
      errors.push(`v35.1: filter ↺ buttons start at ${align.resets.join('/')}px, not one edge`)
    }
    if (Math.min(...align.boxes) < 40) {
      errors.push(`v35.1: a filter's number box was squeezed to ${Math.min(...align.boxes)}px`)
    }
  }
  await page.screenshot({ path: `${scratch}/22-analysis-filter-group.png` })

  // v35.1: an emptied box must fall back to the property's OWN ceiling, never
  // a magic 9999. Deselecting every playlist is the reachable way to reach the
  // no-extent state the bug needs — with nothing in scope there are no
  // extremes to fall back to, which is what a fresh import looks like before
  // a sidecar is loaded. Danceability caps at 100, Rating at 5: the fix is
  // registry-driven, not special-cased for the descriptors.
  await page.locator('aside').first().getByRole('button', { name: 'None' }).first().click()
  await page.waitForTimeout(300)
  // The descriptor rows are labelled by ONE letter since v35.1, so they are
  // addressed by their tooltip's aria-label rather than by row text.
  for (const [label, ceiling, selector] of [
    ['Danceability', 100, '.filter-row:has(button[aria-label="About Danceability"])'],
    ['Rating', 5, null],
  ]) {
    const row =
      selector === null
        ? page.locator('.filter-row', { hasText: label }).first()
        : page.locator(selector).first()
    const [minBox, maxBox] = [row.locator('input').first(), row.locator('input').nth(1)]
    await maxBox.fill('')
    await minBox.fill('0')
    await minBox.press('Enter')
    await page.waitForTimeout(150)
    const got = Number(await maxBox.inputValue())
    if (got !== ceiling) {
      errors.push(`v35.1: an empty ${label} max fell back to ${got}, not its ceiling ${ceiling}`)
    }
    // The `max` attribute constrains the spinner, not the keyboard, so a
    // typed value has to be clamped by the same bound.
    await maxBox.fill('500')
    await maxBox.press('Enter')
    await page.waitForTimeout(150)
    const typed = Number(await maxBox.inputValue())
    if (typed !== ceiling) {
      errors.push(`v35.1: a typed ${label} max of 500 was kept as ${typed}, past its ${ceiling}`)
    }
  }
  await page.locator('aside').first().getByRole('button', { name: 'All' }).first().click()
  await page.waitForTimeout(300)

  // Put the columns back so the reset screenshot below matches its siblings.
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.getByRole('checkbox', { name: 'Danceability column', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Danceability filter', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Arousal column', exact: true }).uncheck()
  await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
  await page.keyboard.press('Escape')
}

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
if (errors.length > 0) process.exitCode = 1
await browser.close()
