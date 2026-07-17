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
  const firstBox = page.locator('.boxes .box').first()
  await firstBox.click() // fill down to 1
  await firstBox.click() // …and clear to 0
  const thresholdText = (await page.locator('.threshold-head').textContent())?.replace(/\s+/g, ' ')
  if (!thresholdText?.includes('0 of 4')) {
    errors.push(`clicking the last filled box should read "require 0 of 4", got "${thresholdText}"`)
  }
  const comboStat = Number.parseInt(
    (await page.locator('.stat .value').nth(1).textContent()) ?? '0',
    10,
  )
  const completePairs = (visibleCount * (visibleCount - 1)) / 2
  if (comboStat !== completePairs) {
    errors.push(`threshold 0 should count ${completePairs} combos (complete), got ${comboStat}`)
  }
  await page.locator('.boxes .box').nth(2).click() // restore require 3
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
// v11 issue 15: the card's marks are a compact icon row (★ ⏮ ⏭ + ⓘ).
await page.locator('.marks .mark-toggle').first().click()
if ((await page.locator('.marks .mark-toggle[aria-pressed="true"]').count()) !== 1) {
  errors.push('the must-include mark did not switch on')
}
if ((await page.locator('.marks .mark-toggle').count()) !== 3) {
  errors.push('the selected-track card should show exactly three mark icons')
}
await page.screenshot({ path: `${scratch}/04-selected.png` })

// shorter walks (8) keep unused neighbours around for the hub step below;
// Set & suggestions sits LAST; on FIRST open every section starts folded
// (v8 issue 17 — the menu then remembers what the user opens)
await page.getByRole('button', { name: /Advanced/ }).click()
const lastSectionName = await page.locator('.panel details.section > summary').last().textContent()
if (lastSectionName?.trim() !== 'Set & suggestions') {
  errors.push(`the last advanced section should be Set & suggestions, got "${lastSectionName}"`)
}
const openAtFirst = await page
  .locator('.panel details.section')
  .evaluateAll((ds) => ds.filter((d) => d.open).length)
if (openAtFirst !== 0) {
  errors.push(`all advanced sections should start folded on first open (${openAtFirst} open)`)
}
await page.locator('.panel details.section > summary', { hasText: 'Set & suggestions' }).click()
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
await page.getByRole('button', { name: /Suggest a set/ }).click()
await page.waitForTimeout(300)
// the suggested walk must include the must-include track
const setTitles = await page.locator('aside ol li.track .names strong').allTextContents()
if (!setTitles.includes('Seven Bridges')) {
  errors.push('the suggested set skipped the must-include track')
}
await page.keyboard.press('Escape') // clear the selection
await page.screenshot({ path: `${scratch}/05-suggested-set.png` })

// the sets ARE the suggestion browser (v8 issue 18): ✨ regenerates an
// UNTOUCHED set in place (same set, fresh content, no set spam), and Cmd+Z
// steps back through regenerations — the old ◀ history, for free
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
const walkBeforeRegen = await page.locator('aside ol li.track .names strong').allTextContents()
await page.getByRole('button', { name: /Suggest a set/ }).click()
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
await page.getByRole('button', { name: /Suggest a set/ }).click()
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
await page.locator('aside ol li.track').first().getByRole('button', { name: 'Move down' }).click()
await page.waitForTimeout(150)
if ((await page.locator('aside .head .badge').count()) !== 0) {
  errors.push('a manual edit did not clear the generated badge')
}
await page.getByRole('button', { name: 'New set' }).click()
await page.waitForTimeout(150)
const activeSetName = await page
  .locator('aside .head select')
  .evaluate((s) => s.selectedOptions[0]?.textContent)
if (activeSetName !== 'Second Set') {
  errors.push(`the new set should be called "Second Set", got "${activeSetName}"`)
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
await page.getByRole('button', { name: 'Delete set' }).click()
await page.waitForTimeout(150)
if ((await page.locator('aside .head select option').count()) !== 1) {
  errors.push('deleting the second set did not remove it')
}

// the cap (v8 issue 18): ＋ disables at eight sets; an empty eighth still
// takes a ✨ fill, a hand-edited one blocks it once the shelf is full
for (let i = 0; i < 7; i++) {
  await page.getByRole('button', { name: 'New set' }).click()
}
await page.waitForTimeout(200)
if (!(await page.getByRole('button', { name: 'New set' }).isDisabled())) {
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
  await page.getByRole('button', { name: 'Delete set' }).click()
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
const bpmColumn = () =>
  page
    .locator('.tracks-view tbody td:nth-child(5)') // ＋ column shifts everything by one
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
await page.locator('.panel details.section > summary', { hasText: 'Track properties' }).click()
if ((await page.locator('.prop-row').count()) !== 27) {
  errors.push(
    `the Track properties table should list 27 rows, got ${await page.locator('.prop-row').count()}`,
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
// title sits in the 4th cell since the tags/pos cells lead (v9 issue 13)
let openerTitle = await openerRow.locator('td:nth-child(4)').textContent()
if (openerTitle === lastTitle) {
  openerRow = page.locator('.tracks-view tbody tr').nth(2)
  openerTitle = await openerRow.locator('td:nth-child(4)').textContent()
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
  const headerStarBox = await page.locator('.header-star').boundingBox()
  const rowStarBox = await page.locator('.tag.star').first().boundingBox()
  if (headerStarBox && rowStarBox) {
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
await page.getByRole('spinbutton', { name: 'Suggested set length' }).fill('99')
await page.keyboard.press('Escape')
await page.locator('.suggest-row .primary').click()
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
    await page.locator('g.hub-retry').dispatchEvent('click')
    await page.waitForTimeout(250)
  }
  if (!spentReached) {
    errors.push('cycling force-retry never reached the reset-only state')
  } else if ((await page.locator('g.hub-reset').count()) !== 1) {
    errors.push('reset-only state is missing its ⟲ button')
  } else {
    await page.screenshot({ path: `${scratch}/07d-retry-spent.png` })
    await page.locator('g.hub-reset').dispatchEvent('click')
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
    const forcedNote = await page.locator('.forced-note').textContent()
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
// v8 issue 11: nodes are draggable — grab one and pull it 60px
const dragTarget = page.locator('.genre-node').first()
const dragBefore = await dragTarget.getAttribute('transform')
const dragBox = await dragTarget.boundingBox()
if (dragBox) {
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 60, dragBox.y + dragBox.height / 2 + 40, {
    steps: 6,
  })
  await page.mouse.up()
}
await page.waitForTimeout(400)
if ((await dragTarget.getAttribute('transform')) === dragBefore) {
  errors.push('dragging a genre node did not move it')
}
// put it roughly back so the containment check below tests the PHYSICS, not
// the user's deliberate shove
{
  const box = await dragTarget.boundingBox()
  if (box && dragBox) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2, {
      steps: 6,
    })
    await page.mouse.up()
  }
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
await page.screenshot({ path: `${scratch}/07b2-pair-inspector.png` })
await page.locator('.inspector .close').click()
if ((await page.locator('.inspector').count()) !== 0) {
  errors.push('✕ did not close the pair inspector')
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

// v10 issue 2: the genre method is chosen in the advanced menu now; the combo
// panel shows only a subtle note of the active method.
const methodNote = await page
  .locator('.criterion .ratio-note', { hasText: 'method:' })
  .textContent()
if (!methodNote || methodNote.trim() === 'method:') {
  errors.push(`the criteria-panel method note is missing, got "${methodNote}"`)
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
await page.getByRole('checkbox', { name: 'vinyl mode' }).uncheck()
await page.waitForTimeout(300)
// BPM metric ratios (v8 issue 6): unit time off shows a warning hint in the
// combo panel and strips the ordinary 1:1 edges
await page.getByRole('checkbox', { name: '± unit time', exact: false }).uncheck()
await page.waitForTimeout(300)
await page.locator('.ratio-note.warn', { hasText: 'unit time off' }).waitFor()
const edgesNoUnit = await page.locator('.combo-edge').count()
if (edgesNoUnit >= edgesBefore) {
  errors.push(`unit time off should strip edges (${edgesBefore} → ${edgesNoUnit})`)
}
await page.getByRole('checkbox', { name: '± unit time', exact: false }).check()
await page.waitForTimeout(300)
// half/double moved here from the combo panel (v8 issue 6); leave it on for
// the rest of the flow, as before
await page.getByRole('checkbox', { name: /half\/double/ }).check()
await page.waitForTimeout(300)
await page.screenshot({ path: `${scratch}/09-advanced.png` })
// the same-key spread bounds the deterministic relaxation (v9 issues 1+17):
// 0 collapses the fans, and restoring 1 reproduces the EXACT layout — no
// randomness (the ↻ re-jitter button is gone)
await page.locator('.panel details.section > summary', { hasText: 'Display' }).click()
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
const beforeSpread = await fanProbe()
await setSpread('0')
await page.waitForTimeout(300)
const collapsed = await fanProbe()
if (!collapsed.some((a) => beforeSpread.find((b) => b.label === a.label)?.d !== a.d)) {
  errors.push('spread 0 moved no same-key fan nodes')
}
await setSpread('1')
await page.waitForTimeout(300)
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
await page.locator('.panel details.section > summary', { hasText: 'Display' }).click()
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
const ensureSectionOpen = async (name) => {
  const details = page.locator('.panel details.section', { hasText: name }).first()
  if (!(await details.evaluate((d) => d.open))) {
    await page.locator('.panel details.section > summary', { hasText: name }).click()
  }
}
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
await page.locator('.panel details.section > summary', { hasText: 'Display' }).click()
await page.keyboard.press('Escape')

// minor/major key filter (v8 issue 10; the switch moved to Filters in v9
// issue 6): minor-only hides the B ring's nodes and fades its sector tint;
// "both" restores everything
await page
  .locator('aside details:has(> summary:has-text("Filters"))')
  .evaluate((d) => (d.open = true))
const nodesBothRings = await page.locator('g.node').count()
await page.locator('.ring-switch button', { hasText: 'minor' }).click()
await page.waitForTimeout(600)
const nodesMinor = await page.locator('g.node').count()
if (!(nodesMinor < nodesBothRings)) {
  errors.push(`minor-only should hide B-ring nodes (${nodesBothRings} → ${nodesMinor})`)
}
if ((await page.locator('path.sector.excluded').count()) !== 12) {
  errors.push('minor-only should fade exactly the 12 major sectors')
}
await page.screenshot({ path: `${scratch}/09c-minor-only.png` })
await page.locator('.ring-switch button', { hasText: 'both' }).click()
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
await page.getByRole('button', { name: 'Rename set' }).click()
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
if (!rememberedOpen.includes('Set & suggestions')) {
  errors.push(`Set & suggestions should be remembered open, got [${rememberedOpen}]`)
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
// v10: Clear now asks to confirm; v11 issue 17: the dialog no longer claims
// the clear "cannot be undone" (Cmd+Z restores it).
{
  const dialogBody = await page.locator('dialog[open] p').textContent()
  if (/cannot be undone/i.test(dialogBody ?? '')) {
    errors.push('the clear-set dialog still claims it cannot be undone (v11 issue 17)')
  }
}
await page.getByRole('button', { name: 'Clear set' }).click()
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
