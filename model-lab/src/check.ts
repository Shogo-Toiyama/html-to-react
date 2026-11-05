// Real-browser check: does each result still look and behave like the original site?
//
//   npm run check
//
// For the original project (runs/baseline/start) and every other project in runs/
// (Sonnet's baseline stages and each model's runs), this starts Vite, opens the pages
// in Chrome and records:
//   - the structure: every element's tag, id, text and attributes (except class/style)
//   - every element's computed style (so "p-[40px]" vs "p-[14px]" or a lost border shows up)
//   - the style of hoverable elements while the mouse is over them
//   - the page after clicking each button (the popups), and after Close
//   - console errors and Vite error overlays
//   - whether the screenshot is byte-identical
// Then it compares each project with the original. Sonnet's baseline is checked the same
// way, so a difference that Sonnet also has is a limit of this check, not Haiku's mistake.
//
// Needs `npm install` once inside runs/baseline/start (its node_modules are shared).

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const RUNS = join(import.meta.dirname, '..', 'runs')
const START = join(RUNS, 'baseline', 'start')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5199
const ROUTES = ['/', '/about']
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ElementSnap {
  tag: string
  id: string
  text: string
  attrs: Record<string, string>
  style: Record<string, string>
}
interface PageSnap {
  rest: ElementSnap[]
  hover: Record<number, Record<string, string>>
  clicks: ElementSnap[][]
  errors: string[]
  screenshot: string
  /** Screenshot with the first popup open. */
  popupShot: string
}
type ProjectSnap = Record<string, PageSnap>

// Runs inside the page.
const SNAPSHOT = `(() => {
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'])
  return [...document.body.querySelectorAll('*')].filter((e) => !skip.has(e.tagName)).map((e) => {
    const cs = getComputedStyle(e)
    const style = {}
    for (const p of cs) style[p] = cs.getPropertyValue(p)
    const attrs = {}
    for (const a of e.attributes) if (a.name !== 'class' && a.name !== 'style') attrs[a.name] = a.value
    const text = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    return { tag: e.tagName, id: e.id, text, attrs, style }
  })
})()`

const HOVERABLE = `(() => {
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'])
  const els = [...document.body.querySelectorAll('*')].filter((e) => !skip.has(e.tagName))
  const found = new Set()
  for (const sheet of document.styleSheets) {
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) walk(rule.cssRules)
        const selector = rule.selectorText
        if (!selector || !selector.includes(':hover')) continue
        for (const part of selector.split(',')) {
          if (!part.includes(':hover')) continue
          try { document.querySelectorAll(part.replace(/:hover/g, '')).forEach((el) => found.add(els.indexOf(el))) } catch {}
        }
      }
    }
    walk(sheet.cssRules)
  }
  return [...found].filter((i) => i >= 0)
})()`

const STYLE_OF = `((i) => {
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'])
  const e = [...document.body.querySelectorAll('*')].filter((x) => !skip.has(x.tagName))[i]
  const cs = getComputedStyle(e)
  const style = {}
  for (const p of cs) style[p] = cs.getPropertyValue(p)
  return style
})`

function startVite(project: string): Promise<ChildProcess> {
  const link = join(project, 'node_modules')
  if (!existsSync(link)) symlinkSync(join(START, 'node_modules'), link)
  const child = spawn(join(link, '.bin', 'vite'), ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: project })
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('Local')) resolve(child)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('exit', () => reject(new Error(`vite exited: ${output.slice(-300)}`)))
    setTimeout(() => reject(new Error(`vite did not start: ${output.slice(-300)}`)), 30000)
  })
}

async function snapshotPage(page: Page, route: string, hoverIdx: number[] | null, shotPath: string): Promise<PageSnap & { hoverIdx: number[] }> {
  const errors: string[] = []
  const onConsole = (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 150)}`)
  const onError = (e: unknown) => errors.push(`pageerror: ${String(e).slice(0, 150)}`)
  page.on('console', onConsole)
  page.on('pageerror', onError)
  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle0' })
  await sleep(300)
  if (await page.$('vite-error-overlay')) errors.push('vite error overlay')

  const rest = (await page.evaluate(SNAPSHOT)) as ElementSnap[]
  const idx = hoverIdx ?? ((await page.evaluate(HOVERABLE)) as number[])
  const handles = await page.$$('body *:not(script):not(style):not(link):not(meta):not(noscript)')
  const hover: PageSnap['hover'] = {}
  for (const i of idx) {
    const handle = handles[i]
    if (!handle) continue
    try {
      await handle.hover()
      await sleep(450)
      hover[i] = (await page.evaluate(`(${STYLE_OF})(${i})`)) as Record<string, string>
    } catch {
      hover[i] = { error: 'could not hover' }
    }
    await page.mouse.move(0, 0)
    await sleep(450)
  }

  const clicks: ElementSnap[][] = []
  let popupShot = ''
  const labels = (await page.$$eval('button', (b) => b.map((x) => x.textContent?.trim() ?? ''))) as string[]
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 'Close') continue
    await page.evaluate(`document.querySelectorAll('button')[${i}].click()`)
    await sleep(80)
    clicks.push((await page.evaluate(SNAPSHOT)) as ElementSnap[])
    if (!popupShot) popupShot = Buffer.from((await page.screenshot()) as Uint8Array).toString('base64')
    await page.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Close').forEach((b) => b.click())`)
    await sleep(80)
    clicks.push((await page.evaluate(SNAPSHOT)) as ElementSnap[])
  }

  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle0' })
  await sleep(300)
  const shot = (await page.screenshot({ fullPage: true })) as Uint8Array
  writeFileSync(shotPath, shot)
  page.off('console', onConsole)
  page.off('pageerror', onError)
  return { rest, hover, clicks, errors, screenshot: Buffer.from(shot).toString('base64'), popupShot, hoverIdx: idx }
}

async function snapshotProject(project: string, label: string, hoverByRoute: Record<string, number[]>): Promise<ProjectSnap> {
  const out = join(RUNS, 'check', label)
  mkdirSync(out, { recursive: true })
  const server = await startVite(project)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  try {
    const result: ProjectSnap = {}
    for (const route of ROUTES) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800 })
      const shotPath = join(out, `${route === '/' ? 'home' : route.slice(1)}.png`)
      const snap = await snapshotPage(page, route, hoverByRoute[route] ?? null, shotPath)
      hoverByRoute[route] ??= snap.hoverIdx
      result[route] = snap
      await page.close()
    }
    return result
  } finally {
    await browser.close()
    server.kill('SIGTERM')
    await sleep(500)
  }
}

/** Differences between the original and a result, grouped so the report stays short. */
function compare(ref: ProjectSnap, got: ProjectSnap): { structure: string[]; style: string[]; hover: string[]; click: string[]; errors: string[]; pixels: string[] } {
  const d = { structure: [] as string[], style: [] as string[], hover: [] as string[], click: [] as string[], errors: [] as string[], pixels: [] as string[] }
  const name = (e: ElementSnap) => `<${e.tag.toLowerCase()}${e.id ? '#' + e.id : ''}>`
  const diffElements = (route: string, a: ElementSnap[], b: ElementSnap[], where: string, into: string[]) => {
    if (a.length !== b.length) {
      d.structure.push(`${route} ${where}: ${a.length} elements in the original, ${b.length} now`)
      return
    }
    a.forEach((x, i) => {
      const y = b[i]
      if (x.tag !== y.tag || x.id !== y.id) d.structure.push(`${route} ${where} #${i}: ${name(x)} became ${name(y)}`)
      else if (x.text !== y.text) d.structure.push(`${route} ${where} ${name(x)}: text "${x.text.slice(0, 30)}" became "${y.text.slice(0, 30)}"`)
      else if (JSON.stringify(x.attrs) !== JSON.stringify(y.attrs)) d.structure.push(`${route} ${where} ${name(x)}: attributes changed`)
      const props = Object.keys(x.style).filter((p) => x.style[p] !== y.style[p])
      if (props.length) {
        const shown = props.slice(0, 4).map((p) => `${p}: ${x.style[p]} → ${y.style[p]}`).join('; ')
        into.push(`${route} ${where} ${name(x)} #${i}: ${props.length} props (${shown}${props.length > 4 ? '…' : ''})`)
      }
    })
  }
  for (const route of ROUTES) {
    const a = ref[route]
    const b = got[route]
    diffElements(route, a.rest, b.rest, 'rest', d.style)
    a.clicks.forEach((snap, i) => b.clicks[i] && diffElements(route, snap, b.clicks[i], `click ${i}`, d.click))
    for (const key of Object.keys(a.hover)) {
      const x = a.hover[+key]
      const y = b.hover[+key] ?? {}
      const props = Object.keys(x).filter((p) => x[p] !== y[p])
      if (props.length) {
        const shown = props.slice(0, 4).map((p) => `${p}: ${x[p]} → ${y[p]}`).join('; ')
        d.hover.push(`${route} element #${key} on hover: ${props.length} props (${shown}${props.length > 4 ? '…' : ''})`)
      }
    }
    for (const error of b.errors) if (!a.errors.includes(error)) d.errors.push(`${route}: ${error}`)
    if (a.screenshot !== b.screenshot) d.pixels.push(`${route}: screenshot differs`)
    if (a.popupShot !== b.popupShot) d.pixels.push(`${route}: screenshot with the popup open differs`)
  }
  return d
}

async function main() {
  const only = process.argv[2]
  const labels: { label: string; dir: string }[] = []
  for (const model of readdirSync(RUNS).sort()) {
    if (model === 'check') continue
    if (model === 'baseline') {
      for (const stage of readdirSync(join(RUNS, model)).sort()) {
        if (stage !== 'start') labels.push({ label: `sonnet/${stage}`, dir: join(RUNS, model, stage, 'project') })
      }
    } else {
      for (const run of readdirSync(join(RUNS, model)).sort()) labels.push({ label: `${model}/${run}`, dir: join(RUNS, model, run, 'project') })
    }
  }
  const selected = labels.filter((item) => !only || item.label.includes(only))

  const hoverByRoute: Record<string, number[]> = {}
  process.stdout.write('original… ')
  const ref = await snapshotProject(START, 'start', hoverByRoute)
  // Sanity check: hovering must really change something in the original, or "no hover differences" means nothing.
  const changed = Object.entries(ref['/'].hover).map(([key, style]) => Object.keys(style).filter((p) => style[p] !== ref['/'].rest[+key].style[p]).length)
  console.log(`hover changes ${changed.join('/')} style props per hovered element in the original`)
  console.log(`done (hoverable elements: ${JSON.stringify(hoverByRoute)})`)

  const report: Record<string, ReturnType<typeof compare>> = {}
  for (const { label, dir } of selected) {
    process.stdout.write(`${label}… `)
    try {
      const got = await snapshotProject(dir, label, hoverByRoute)
      const diff = compare(ref, got)
      report[label] = diff
      const counts = Object.entries(diff).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`)
      console.log(counts.length ? counts.join(', ') : 'identical to the original')
    } catch (error) {
      console.log(`CHECK FAILED: ${String(error).slice(0, 200)}`)
    }
  }
  writeFileSync(join(RUNS, 'check', 'report.json'), JSON.stringify(report, null, 2))
  console.log('\nDetails: runs/check/report.json (screenshots in runs/check/<label>/)')
}

await main()
