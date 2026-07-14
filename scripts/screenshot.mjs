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

// click to select → focus dimming
await node.click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${scratch}/04-selected.png` })

// double-click two nodes to start a walk
await node.dblclick()
await page.locator('g.node[aria-label*="Paper Lanterns"]').dblclick()
await page.locator('g.node[aria-label*="Broken Compass"]').dblclick()
await page.waitForTimeout(200)
await page.keyboard.press('Escape')
await page.screenshot({ path: `${scratch}/05-walk.png` })

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
