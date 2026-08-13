// Rasterises public/favicon.svg into the PWA manifest's PNG icons. Re-run
// this any time favicon.svg changes. Usage: node scripts/render-icons.mjs
//
// Same Playwright idiom as scripts/screenshot.mjs (chrome channel, falling
// back to the bundled browser). The source SVG's own rounded tile is the
// only background it has — its corners are transparent by design (theme-proof
// on the browser tab), so each render uses a transparent page background and
// omitBackground on the screenshot to avoid stamping a white square behind it.
import { chromium } from 'playwright'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(repoRoot, 'public', 'favicon.svg')
const svg = readFileSync(svgPath, 'utf8')

const targets = [
  { size: 192, out: path.join(repoRoot, 'public', 'icon-192.png') },
  { size: 512, out: path.join(repoRoot, 'public', 'icon-512.png') },
]

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
} catch {
  browser = await chromium.launch() // fall back to the bundled browser if present
}

for (const { size, out } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          html, body { margin: 0; padding: 0; background: transparent; }
          svg { display: block; width: ${size}px; height: ${size}px; }
        </style>
      </head>
      <body>${svg}</body>
    </html>`)
  await page.locator('svg').waitFor()
  await page.screenshot({ path: out, omitBackground: true })
  await page.close()
  const { size: bytes } = statSync(out)
  console.log(`wrote ${out} (${size}x${size}, ${bytes} bytes)`)
}

await browser.close()
