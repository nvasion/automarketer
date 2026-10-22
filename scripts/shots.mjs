// Screenshots of the real app for the public "How it works" page, in every
// theme: src/assets/shots/<name>-automarketer|light|dark.webp.
//
//   npm run dev:full            # or any running AutoMarketer (no database needed)
//   node scripts/shots.mjs      # BASE_URL=http://localhost:5173 by default
//
// It registers a throwaway account, imports the demo campaigns from
// src/data/sampleData.ts, walks the campaign wizard (template posts, no AI key)
// and captures each screen. Set the platform *_CLIENT_ID env vars on the API
// (any value) so Connected Platforms shows Connect buttons, not "not configured".
//
// Needs Playwright with Chromium. If it isn't installed in this repo:
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs [CHROMIUM=/path/to/chrome] node scripts/shots.mjs
// Extra env: OUT (output dir), DEBUG_OUT (also save full-page PNGs of every
// public and app page there, for review), ONLY (comma-separated shot names).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright')
const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const OUT = process.env.OUT ?? join(here, '..', 'src', 'assets', 'shots')
const DEBUG_OUT = process.env.DEBUG_OUT
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const VIEW = { width: 1440, height: 900 }
// File suffix -> data-theme id. The suffix names the capture: <name>-<suffix>.webp.
const THEME_IDS = { automarketer: 'automarketer', light: 'tynhub-light', dark: 'tynhub-dark' }
const THEMES = Object.keys(THEME_IDS)

mkdirSync(OUT, { recursive: true })
if (DEBUG_OUT) mkdirSync(DEBUG_OUT, { recursive: true })

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, reducedMotion: 'reduce' })
const page = await context.newPage()
// The first load of a cold Vite dev server pre-bundles dependencies.
page.setDefaultNavigationTimeout(180000)
page.on('pageerror', (e) => console.error('[page error]', e.message))

// ── Account and demo data ─────────────────────────────────────────────────────
// The sidebar shows a name made from the address ("Jordan Rivera").
const email = 'jordan.rivera@example.com'
const password = 'shots-demo-password'
await page.goto(`${BASE}/`)
const reg = await page.request.post(`${BASE}/api/auth/register`, { data: { email, password } })
// 409: the account is left over from an earlier run against the same server.
if (!reg.ok() && reg.status() !== 409) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`)
// Sign in through the form, so the session cookie is the browser's own.
await page.goto(`${BASE}/login`)
await page.locator('#email').fill(email)
await page.locator('#password').fill(password)
await page.getByRole('button', { name: /sign in/i }).click()
await page.getByText('Total Campaigns').waitFor({ timeout: 180000 })
// The app's own sample campaigns, loaded through Vite so this script needs no TS tooling.
const imported = await page.evaluate(async () => {
  const { SAMPLE_CAMPAIGNS } = await import('/src/data/sampleData.ts')
  const res = await fetch('/api/campaigns/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaigns: SAMPLE_CAMPAIGNS }),
  })
  return res.status
})
if (imported >= 300) throw new Error(`import failed: ${imported}`)

// ── Helpers ───────────────────────────────────────────────────────────────────
// The app reads the stored theme when it mounts, so reload after storing the
// choice.
async function setTheme(theme) {
  await page.evaluate((t) => localStorage.setItem('automarketer.theme', t), THEME_IDS[theme])
  await page.reload()
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, THEME_IDS[theme])
}

async function go(path) {
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

/** Screenshot the viewport as WebP (re-encoded by Chromium from its PNG). */
async function capture(name, theme) {
  if (ONLY && !ONLY.has(name)) return
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
  const png = await page.screenshot({ type: 'png' })
  const webp = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.86).split(',')[1]
  }, png.toString('base64'))
  const file = join(OUT, `${name}-${theme}.webp`)
  writeFileSync(file, Buffer.from(webp, 'base64'))
  console.log('wrote', file)
}

async function debugPage(name) {
  if (!DEBUG_OUT) return
  // A full-page capture never scrolls, so lazy images would stay empty.
  await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager')))
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(DEBUG_OUT, `${name}.png`), fullPage: true })
}

// ── Shots ─────────────────────────────────────────────────────────────────────
try {
for (const theme of THEMES) {
  await setTheme(theme)

  await go('/settings')
  await page.getByRole('button', { name: /Connected Platforms/ }).click()
  await page.waitForTimeout(300)
  await capture('platforms', theme)

  await page.getByRole('button', { name: /AI Settings/ }).click()
  await page.waitForTimeout(200)
  await capture('ai', theme)

  await go('/create')
  await page.getByPlaceholder('e.g. Q2 Product Launch').fill('Northwind Launch Week')
  await page.getByPlaceholder('https://yourproduct.com').fill('https://northwind.dev')
  await page
    .getByPlaceholder(/Briefly describe/)
    .fill('Northwind is a deploy dashboard for small engineering teams: one page for every environment, with rollbacks in a click. Launch week starts Monday.')
  await page.getByPlaceholder('e.g. Startup founders and product managers').fill('Engineering leads at startups')
  await capture('wizard-info', theme)

  await page.getByRole('button', { name: /Continue/ }).click() // → screenshots
  await page.getByRole('button', { name: /Continue/ }).click() // → platforms & tone
  // LinkedIn and X start selected; the cards are clickable tiles.
  for (const name of ['Reddit', 'Bluesky']) {
    await page.getByText(name, { exact: true }).click()
  }
  await page.getByPlaceholder(/e\.g\. startups or r\/startups/).fill('r/devops, r/startups')
  await page.getByText('Excited', { exact: true }).click()
  await capture('wizard-platforms', theme)

  await page.getByRole('button', { name: /Generate with AI/ }).click()
  await page.getByText(/AI-Generated Content/).waitFor({ timeout: 15000 })
  await page.getByText(/Generating your content/).waitFor({ state: 'hidden', timeout: 30000 })
  await page.locator('textarea').first().waitFor()
  await page.waitForTimeout(400)
  await capture('wizard-review', theme)

  // A campaign that is ready to go out, so the page shows Publish All.
  await go('/campaigns/camp-002')
  await page.getByRole('button', { name: /Publish All/ }).waitFor()
  await capture('campaign', theme)

  if (DEBUG_OUT) {
    for (const [name, path] of [
      ['dashboard', '/'],
      ['campaigns', '/campaigns'],
      ['scheduler', '/scheduler'],
      ['analytics', '/analytics'],
      ['settings', '/settings'],
      ['campaign-002', '/campaigns/camp-002'],
    ]) {
      await go(path)
      await debugPage(`app-${name}-${theme}`)
    }
  }
}

} catch (e) {
  // On a failed step, keep a picture of where it stopped.
  if (DEBUG_OUT) await page.screenshot({ path: join(DEBUG_OUT, 'failure.png') }).catch(() => {})
  await browser.close()
  throw e
}

// Public pages, signed out, for review only.
if (DEBUG_OUT) {
  await context.clearCookies()
  for (const theme of THEMES) {
    await setTheme(theme)
    for (const [name, path] of [
      ['landing', '/'],
      ['how-it-works', '/how-it-works'],
      ['login', '/login'],
      ['register', '/register'],
    ]) {
      await go(path)
      await debugPage(`public-${name}-${theme}`)
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await setTheme('automarketer')
  for (const [name, path] of [
    ['landing', '/'],
    ['how-it-works', '/how-it-works'],
  ]) {
    await go(path)
    await debugPage(`mobile-${name}`)
  }
}

await browser.close()
