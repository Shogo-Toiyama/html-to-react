import { createPackageJson, GITIGNORE, VITE_CONFIG } from '../lib/starterProject'
import { rewriteCssUrls } from './css'
import { buildLegacyScript } from './legacyScript'
import { NoteCollector, type Note } from './notes'
import { convertPage, serialize, type Attribute, type CssEntry, type Element, type PageResult, type SiteContext } from './page'
import { describePages, findSitePages, HTML_EXTENSIONS, isRootIndex, type SitePage } from './pages'
import { basename, extname, resolveUrl } from './paths'
import { buildReport, type FileMove } from './report'
import {
  buildIndexHtml,
  buildMain,
  buildPageComponent,
  buildRouterApp,
  buildSingleApp,
  LEGACY_PAGE_HELPER,
  SCROLL_TO_TOP,
} from './templates'

/** Files that belong to the old site's tooling, not the site itself. Not copied. */
const SKIPPED_EXTENSIONS = new Set(['.md', '.yml', '.yaml', '.toml', '.lock', '.sh', '.py', '.bat', '.ps1'])

/** Added to package.json for sites with several pages. */
const ROUTER_DEPENDENCY = { 'react-router': '^8.5.1' }

export interface ConvertInput {
  /** Every file of the site, keyed by root-relative path (`img/a.png`). */
  files: Map<string, Uint8Array>
  /** Used for the package name, e.g. the folder name. */
  siteName: string
}

export interface ConversionResult {
  /** The converted HTML pages, `index.html` first. */
  pages: SitePage[]
  /** The React project's files, keyed by path. */
  files: Map<string, string | Uint8Array>
  notes: Note[]
}

/** Root-level HTML pages, with `index.html` first (used to recognize a site folder). */
export function findHtmlPages(paths: Iterable<string>): string[] {
  const pages = [...paths].filter((path) => !path.includes('/') && HTML_EXTENSIONS.has(extname(path)))
  return pages.sort((a, b) => Number(isRootIndex(b)) - Number(isRootIndex(a)) || a.localeCompare(b))
}

/**
 * Converts a plain HTML/CSS/JS site into a Vite + React project. A site with
 * one page becomes `src/App.jsx`. A site with several pages becomes one
 * component per page in `src/pages/`, shown by React Router in `src/App.jsx`.
 */
export function convertSite(input: ConvertInput): ConversionResult {
  const { files, siteName } = input
  const pages = describePages(findSitePages(files.keys()))
  if (pages.length === 0) throw new Error('No HTML page found in this folder.')

  const decoder = new TextDecoder()
  const site: SiteContext = {
    files,
    readText: (path) => decoder.decode(files.get(path)),
    notes: new NoteCollector(),
    routes: pages.length > 1 ? new Map(pages.map((page) => [page.file, page.route])) : null,
  }
  const build = new ProjectBuilder(site)
  const converted = pages.map((page) => convertPage(page.file, site))
  if (pages.length === 1) buildSinglePage(build, pages[0], converted[0])
  else buildMultiPage(build, pages, converted)
  build.finish(siteName, pages)
  return { pages, files: build.output, notes: site.notes.list() }
}

function buildSinglePage(build: ProjectBuilder, page: SitePage, result: PageResult) {
  const { output, moves } = build
  const entry = page.file
  const jsxLines = result.printBody(3)
  const hasScripts = build.writeLegacyScript(result, 'src/legacy-script.js', null)
  output.set('src/App.jsx', buildSingleApp(entry, jsxLines, hasScripts))
  moves.push({ from: `\`${entry}\` → \`<body>\``, to: '`src/App.jsx` (as JSX)' })
  moves.push({ from: `\`${entry}\` → \`<head>\``, to: '`index.html`' })
  if (hasScripts) moves.push({ from: scriptLabels(result), to: '`src/legacy-script.js`' })

  const entryBase = basename(entry).replace(/\.html?$/i, '')
  const cssImports = result.css.map((css) => build.cssImport(css, entry, 'src', entryBase, './'))
  build.writeAssets()

  result.rewriteHeadUrls()
  output.set('src/main.jsx', buildMain({ cssImports, strictMode: !hasScripts, router: false }))
  output.set(
    'index.html',
    buildIndexHtml({
      htmlAttrs: result.htmlAttrs,
      head: [...result.head, ...result.headScripts].map(serialize),
      bodyAttrs: result.bodyAttrs,
      bodyScripts: result.bodyScripts.map(serialize),
    }),
  )
  build.hasScripts = hasScripts
}

function buildMultiPage(build: ProjectBuilder, pages: SitePage[], results: PageResult[]) {
  const { output, moves, notes } = build
  const bodies = results.map((result) => result.printBody(3))
  results.forEach((result) => result.rewriteHeadUrls())

  // ---- <head>: what every page has goes into index.html ----

  const everyPage = <T,>(lists: T[][], key: (item: T) => string) => {
    const sets = lists.map((list) => new Set(list.map(key)))
    return (item: T) => sets.every((set) => set.has(key(item)))
  }
  const inAllHeads = everyPage(results.map((r) => r.head), serialize)
  const htmlHead = new OrderedSet()
  const someHeads: string[] = []
  const pageHeads: Element[][] = results.map((result) =>
    result.head.filter((element) => {
      if (inAllHeads(element)) {
        htmlHead.add(serialize(element))
        return false
      }
      if (isPerPageHeadTag(element)) return true
      if (htmlHead.add(serialize(element))) someHeads.push(`${result.file}: ${shortTag(element)}`)
      return false
    }),
  )
  const inAllScripts = everyPage(results.map((r) => [...r.headScripts, ...r.bodyScripts]), serialize)
  const htmlBodyScripts = new OrderedSet()
  for (const result of results) {
    for (const element of [...result.headScripts, ...result.bodyScripts]) {
      const added = (result.headScripts.includes(element) ? htmlHead : htmlBodyScripts).add(serialize(element))
      if (added && !inAllScripts(element)) someHeads.push(`${result.file}: ${shortTag(element)}`)
    }
  }
  if (pageHeads.some((list) => list.length > 0)) {
    notes.change(
      'Each page\'s `<title>` moved into its component',
      'All pages now share one `index.html`. A `<title>` (or `<meta>`) written in a component\'s JSX is moved ' +
        'into `<head>` by React while that page is on screen, so each page keeps its own title.',
    )
  }
  if (someHeads.length > 0) {
    notes.check(
      'Some `<head>` tags now load on every page',
      'All pages now share one `index.html`. These tags were only on some of your pages, so check that they ' +
        'don\'t change how the other pages look or work.',
      someHeads.join(', '),
    )
  }

  // ---- <body> attributes: shared ones stay on <body>, the rest move into the page ----

  const attrKey = (attr: Attribute) => `${attr.name}=${attr.value}`
  const inAllBodies = everyPage(results.map((r) => r.bodyAttrs), attrKey)
  const sharedBodyAttrs = results[0].bodyAttrs.filter(inAllBodies)
  const pageBodyAttrs = results.map((result) => result.bodyAttrs.filter((attr) => !inAllBodies(attr)))
  pageBodyAttrs.forEach((attrs, i) => {
    if (attrs.length === 0) return
    notes.change(
      '`<body>` attributes moved into the page component',
      'All pages now share one `<body>`. Attributes that only some pages had (like `class="dark"`) are added ' +
        'by that page\'s component when it opens and removed when you leave.',
      `${results[i].file}: ${attrs.map((attr) => `${attr.name}="${attr.value}"`).join(' ')}`,
    )
  })

  // ---- CSS: files every page links go in main.jsx, the rest in each page ----

  const linkedBy = new Map<string, Set<string>>()
  for (const result of results) {
    for (const css of result.css) if (css.kind === 'file') getOrAdd(linkedBy, css.path, () => new Set()).add(result.file)
  }
  const shared = (path: string) => linkedBy.get(path)!.size === pages.length
  const pageOnlyCss: string[] = []

  // ---- Scripts and page components ----

  let anyScripts = false
  const scriptUse = new Map<string, number>()
  results.forEach((result, i) => {
    const page = pages[i]
    const cssImports = result.css
      .filter((css) => !(css.kind === 'file' && shared(css.path)))
      .map((css) => {
        pageOnlyCss.push(css.kind === 'file' ? `${css.path} (${result.file})` : `<style> in ${result.file}`)
        return build.cssImport(css, result.file, 'src/pages', page.component, '../')
      })

    const scriptFile = `src/pages/${page.component}.legacy-script.js`
    const hasScripts = build.writeLegacyScript(result, scriptFile, page.component)
    for (const path of result.consumedScripts) scriptUse.set(path, (scriptUse.get(path) ?? 0) + 1)
    anyScripts ||= hasScripts

    const headLines = result.printHead(pageHeads[i], 3)
    output.set(
      `src/pages/${page.component}.jsx`,
      buildPageComponent({
        page,
        cssImports,
        legacyScript: hasScripts ? `./${page.component}.legacy-script.js` : null,
        usesLink: result.usesLink(),
        bodyAttrs: pageBodyAttrs[i],
        headLines,
        bodyLines: bodies[i],
      }),
    )
    moves.push({ from: `\`${page.file}\` → \`<body>\``, to: `\`src/pages/${page.component}.jsx\` (as JSX)` })
    if (hasScripts) moves.push({ from: scriptLabels(result), to: `\`${scriptFile}\`` })
  })
  moves.push({ from: 'The `<head>` of every page', to: '`index.html` (one for the whole site)' })
  const mainImports = results[0].css
    .filter((css) => css.kind === 'file' && shared(css.path))
    .map((css) => build.cssImport(css, results[0].file, 'src', '', './'))

  if (pageOnlyCss.length > 0) {
    notes.check(
      'CSS from one page now also applies to the other pages',
      'React shows all your pages inside one HTML document, and the CSS of every page is loaded at the start. ' +
        'CSS that used to be on only some pages now affects all of them. If a page looks different than before, ' +
        'make those selectors more specific (for example `.about-title` instead of `h1`). Moving your styles ' +
        'into Tailwind classes later also fixes this.',
      pageOnlyCss.join(', '),
    )
  }
  const sharedScripts = [...scriptUse].filter(([, count]) => count > 1).map(([path]) => path)
  if (sharedScripts.length > 0) {
    notes.check(
      'A script used by several pages was copied into each of them',
      'Each page now has its own `*.legacy-script.js`, so a change to this code must be made in every copy. ' +
        'As you move the code into components, you can share it between pages again.',
      sharedScripts.join(', '),
    )
  }
  if (anyScripts) output.set('src/legacy-page.js', LEGACY_PAGE_HELPER)

  notes.change(
    'Your pages became components, and React Router switches between them',
    'Each HTML page is now a component in `src/pages/`. `src/App.jsx` lists which URL shows which component. ' +
      'When you click a link, React swaps the component instead of loading a new HTML file, and the URL in the ' +
      'address bar still changes.',
  )

  build.writeAssets()
  output.set('src/App.jsx', buildRouterApp(pages))
  output.set('src/ScrollToTop.jsx', SCROLL_TO_TOP)
  output.set('src/main.jsx', buildMain({ cssImports: mainImports, strictMode: !anyScripts, router: true }))
  output.set(
    'index.html',
    buildIndexHtml({
      htmlAttrs: results[0].htmlAttrs,
      head: htmlHead.values(),
      bodyAttrs: sharedBodyAttrs,
      bodyScripts: htmlBodyScripts.values(),
    }),
  )
  build.hasScripts = anyScripts
  build.dependencies = ROUTER_DEPENDENCY
}

/** Collects the output files shared by both kinds of site. */
class ProjectBuilder {
  readonly output = new Map<string, string | Uint8Array>()
  readonly moves: FileMove[] = []
  readonly notes: NoteCollector
  hasScripts = false
  dependencies: Record<string, string> = {}
  private readonly site: SiteContext
  private readonly consumedScripts = new Set<string>()
  private readonly usedCss = new Set<string>()
  private readonly movedCss = new Set<string>()

  constructor(site: SiteContext) {
    this.site = site
    this.notes = site.notes
    const { files, readText, notes } = site
    // Every CSS file moves to src/ with the same layout, so @import between them keeps working.
    for (const path of files.keys()) {
      if (extname(path) !== '.css') continue
      this.output.set(`src/${path}`, rewriteCssUrls(readText(path), path, (p) => files.has(p), notes))
    }
  }

  /**
   * Returns the import path for a page's CSS, from a file in `fromDir`.
   * Inline <style> blocks are written to `<fromDir>/<baseName>.css`.
   */
  cssImport(css: CssEntry, page: string, fromDir: string, baseName: string, toSrc: string): string {
    if (css.kind === 'file') {
      this.usedCss.add(css.path)
      if (!this.movedCss.has(css.path)) {
        this.movedCss.add(css.path)
        this.moves.push({ from: `\`${css.path}\``, to: `\`src/${css.path}\`` })
      }
      return toSrc + css.path
    }
    let name: string
    let n = 0
    do {
      n += 1
      name = n === 1 ? `${baseName}.css` : `${baseName}-${n}.css`
    } while (this.output.has(`${fromDir}/${name}`))
    this.output.set(`${fromDir}/${name}`, rewriteCssUrls(css.css.replace(/^\n+/, ''), page, (p) => this.site.files.has(p), this.notes))
    this.moves.push({ from: `\`<style>\` in \`${page}\``, to: `\`${fromDir}/${name}\`` })
    return `./${name}`
  }

  /** Writes the page's legacy script if it has any JavaScript. Returns whether it did. */
  writeLegacyScript(result: PageResult, path: string, component: string | null): boolean {
    for (const script of result.consumedScripts) this.consumedScripts.add(script)
    if (result.scripts.length === 0 && result.bodyOnload === null) return false
    this.output.set(
      path,
      buildLegacyScript({
        sources: result.scripts,
        exposedFunctions: result.exposedFunctions(),
        exposedVariables: result.exposedVariables(),
        bodyOnload: result.bodyOnload,
        component: component ? `${component}.jsx` : 'App.jsx',
        pageTrackerImport: component ? '../legacy-page.js' : undefined,
        notes: this.notes,
      }),
    )
    return true
  }

  /** Copies images, fonts and other files to public/. */
  writeAssets() {
    let assetCount = 0
    const skipped: string[] = []
    for (const [path, bytes] of this.site.files) {
      const ext = extname(path)
      if (HTML_EXTENSIONS.has(ext) || ext === '.css' || this.consumedScripts.has(path)) continue
      if (SKIPPED_EXTENSIONS.has(ext)) {
        skipped.push(path)
        continue
      }
      this.output.set(`public/${path}`, bytes)
      assetCount += 1
    }
    if (assetCount > 0) this.moves.push({ from: `Images and other files (${assetCount})`, to: '`public/` (same folder layout)' })
    if (skipped.length > 0) {
      this.notes.check(
        'Some files were not copied',
        'Files that aren’t part of the website (like notes or config files) were left in your original folder.',
        skipped.join(', '),
      )
    }
  }

  finish(siteName: string, pages: SitePage[]) {
    this.noteUnusedCss(pages.length > 1)
    this.output.set('package.json', createPackageJson(packageName(siteName), this.dependencies))
    this.output.set('vite.config.js', VITE_CONFIG)
    this.output.set('.gitignore', GITIGNORE)
    this.output.set(
      'CONVERSION.md',
      buildReport({ pages: pages.length > 1 ? pages : null, entry: pages[0].file, moves: this.moves, notes: this.notes.list(), hasScripts: this.hasScripts }),
    )
  }

  /** CSS files that no page links (directly or through @import). */
  private noteUnusedCss(multiPage: boolean) {
    const { files, readText } = this.site
    const used = new Set(this.usedCss)
    const queue = [...used]
    while (queue.length > 0) {
      const path = queue.pop()!
      for (const match of readText(path).matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)) {
        const target = resolveUrl(path, match[1])?.path
        if (target && files.has(target) && !used.has(target)) {
          used.add(target)
          queue.push(target)
        }
      }
    }
    const unused = [...files.keys()].filter((path) => extname(path) === '.css' && !used.has(path))
    if (unused.length === 0) return
    const example = unused[0]
    const how = multiPage
      ? `add \`import '../${example}'\` at the top of the page component that needs it (in \`src/pages/\`)`
      : `add \`import './${example}'\` to \`src/main.jsx\``
    this.notes.check(
      'A CSS file isn’t used by any page',
      `It was copied to \`src/\`, but none of your HTML pages linked it. To use it, ${how}.`,
      unused.map((path) => `src/${path}`).join(', '),
    )
  }
}

/** A list of unique strings that keeps the order they were added in. */
class OrderedSet {
  private readonly items = new Set<string>()
  /** Returns true if the value was new. */
  add(value: string): boolean {
    if (this.items.has(value)) return false
    this.items.add(value)
    return true
  }
  values(): string[] {
    return [...this.items]
  }
}

function scriptLabels(result: PageResult): string {
  return result.scripts.map((s) => `\`${s.label}\``).join(', ') || `\`<body onload>\` in \`${result.file}\``
}

/** `<meta name>` values that describe one page (others, like `viewport`, are for the whole site). */
const PAGE_META_NAMES = new Set(['description', 'keywords', 'author', 'robots'])

/**
 * Tags that differ between pages and can be written in a page component's
 * JSX (React 19 moves them into <head>): the title and meta tags describing
 * the page (`description`, Open Graph `og:*`, `twitter:*`).
 */
function isPerPageHeadTag(element: Element): boolean {
  if (element.tagName === 'title') return true
  if (element.tagName !== 'meta') return false
  const attr = (name: string) => element.attrs.find((a) => a.name === name)?.value.toLowerCase()
  const name = attr('name')
  if (name !== undefined) return PAGE_META_NAMES.has(name) || name.startsWith('twitter:')
  return attr('property')?.startsWith('og:') ?? false
}

/** `<script src="https://...">` for notes. */
function shortTag(element: Element): string {
  const attr = element.attrs.find((a) => a.name === 'src' || a.name === 'href' || a.name === 'name' || a.name === 'rel')
  return attr ? `<${element.tagName} ${attr.name}="${attr.value}">` : `<${element.tagName}>`
}

function getOrAdd<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) map.set(key, (value = create()))
  return value
}

function packageName(siteName: string): string {
  const slug = siteName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return (slug || 'my-site') + '-react'
}
