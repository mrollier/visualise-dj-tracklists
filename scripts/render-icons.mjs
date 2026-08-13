// Rasterises public/favicon.svg into the PWA manifest's PNG icons. Re-run
// this any time favicon.svg changes. Usage: node scripts/render-icons.mjs
//
// Same Playwright idiom as scripts/screenshot.mjs (chrome channel, falling
// back to the bundled browser). The source SVG's own rounded tile is the
// only background it has — its corners are transparent by design (theme-proof
// on the browser tab), so the plain icon-192/icon-512 renders use a
// transparent page background and omitBackground on the screenshot to avoid
// stamping a white square behind it.
//
// icon-512-maskable.png is different on purpose: the manifest's
// purpose:"maskable" entry needs a FULL-BLEED OPAQUE square — Android
// supplies its own mask shape over whatever the source image contains, so a
// transparent/rounded source (like favicon.svg's own tile) would show
// through or double-round. That render paints an opaque #1a1a19 square
// first, then the same favicon.svg content scaled down about the tile
// centre on top, so every star clears the platform's safe-zone circle. See
// the MASKABLE_SCALE comment below and task-14-report.md for the arithmetic
// (Dubhe, the worst-case star, at ~30.04px from centre unscaled vs a
// 25.6px-radius safe circle).
import { chromium } from 'playwright'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(repoRoot, 'public', 'favicon.svg')
const svg = readFileSync(svgPath, 'utf8')

// 30.04 (Dubhe's unscaled outer edge) * 0.8 = 24.03, which clears the
// 25.6px (40% of 64) W3C/Chrome maskable safe-zone radius by ~1.6px. Dubhe
// is the farthest star from the tile centre of the four, and a uniform
// scale about that same centre preserves that ranking, so checking Dubhe
// alone is sufficient — the other three clear with even more margin.
const MASKABLE_SCALE = 0.8

const targets = [
  { size: 192, out: path.join(repoRoot, 'public', 'icon-192.png') },
  { size: 512, out: path.join(repoRoot, 'public', 'icon-512.png') },
  {
    size: 512,
    out: path.join(repoRoot, 'public', 'icon-512-maskable.png'),
    maskable: true,
  },
]

function pageHtml(size, maskable) {
  if (!maskable) {
    return `<!doctype html>
      <html>
        <head>
          <style>
            html, body { margin: 0; padding: 0; background: transparent; }
            svg { display: block; width: ${size}px; height: ${size}px; }
          </style>
        </head>
        <body>${svg}</body>
      </html>`
  }
  return `<!doctype html>
    <html>
      <head>
        <style>
          html, body { margin: 0; padding: 0; }
          .bg { position: absolute; inset: 0; background: #1a1a19; }
          .content {
            position: absolute;
            inset: 0;
            transform-origin: center;
            transform: scale(${MASKABLE_SCALE});
          }
          svg { display: block; width: ${size}px; height: ${size}px; }
        </style>
      </head>
      <body>
        <div class="bg"></div>
        <div class="content">${svg}</div>
      </body>
    </html>`
}

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
} catch {
  browser = await chromium.launch() // fall back to the bundled browser if present
}

try {
  for (const { size, out, maskable } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    try {
      await page.setContent(pageHtml(size, maskable))
      await page.locator('svg').waitFor()
      await page.screenshot({ path: out, omitBackground: !maskable })
      const { size: bytes } = statSync(out)
      console.log(`wrote ${out} (${size}x${size}, ${bytes} bytes)`)
    } finally {
      await page.close()
    }
  }
} finally {
  // however far the loop above got, never leak the browser process.
  await browser.close()
}
