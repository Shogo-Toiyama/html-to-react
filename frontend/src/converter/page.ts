import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { printChildren, printElement, type JsxContext } from './jsx'
import { collectTopLevelNames, type ScriptSource } from './legacyScript'
import type { NoteCollector } from './notes'
import { extname, publicUrl, resolveUrl } from './paths'
import { HTML_EXTENSIONS } from './pages'

// Converts one HTML page: pulls out its CSS and scripts, rewrites file paths,
// and prints its <body> as JSX. Putting the pieces together into a project is
// done by convertSite() in index.ts.

export type Element = DefaultTreeAdapterTypes.Element
export type Attribute = Element['attrs'][number]
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type ChildNode = DefaultTreeAdapterTypes.ChildNode

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'])

export type CssEntry = { kind: 'file'; path: string } | { kind: 'inline'; css: string }

export interface SiteContext {
  files: Map<string, Uint8Array>
  readText(path: string): string
  notes: NoteCollector
  /** Site page file → React Router path. Only set for multi-page sites. */
  routes: Map<string, string> | null
}

export interface PageResult {
  file: string
  htmlAttrs: Attribute[]
  /** Elements left in <head> (meta, title, external CSS, ...), with file URLs rewritten. */
  head: Element[]
  /** Scripts and links that stay in the HTML file (CDN scripts, JSON-LD, ...). */
  headScripts: Element[]
  bodyScripts: Element[]
  /** <body> attributes without event handlers. */
  bodyAttrs: Attribute[]
  bodyOnload: string | null
  css: CssEntry[]
  scripts: ScriptSource[]
  /** Script files whose code moved into the legacy script. */
  consumedScripts: Set<string>
  /** Prints the <body> as JSX lines (call after deciding what else goes in the page). */
  printBody(depth: number): string[]
  /** Rewrites file URLs in `head`, `headScripts` and `bodyScripts` (once). */
  rewriteHeadUrls(): void
  /** Prints head elements (e.g. <title>) as JSX lines, for React 19 to place in <head>. */
  printHead(elements: Element[], depth: number): string[]
  /** Top-level functions used by inline handlers (must be put on `window`). */
  exposedFunctions(): string[]
  exposedVariables(): string[]
  usesLink(): boolean
}

export function convertPage(file: string, site: SiteContext): PageResult {
  const { files, readText, notes, routes } = site
  const document = parse(readText(file))
  const htmlElement = findChild(document, 'html')!
  const head = findChild(htmlElement, 'head')!
  const body = findChild(htmlElement, 'body')!

  // ---- Pull <style>, <link rel=stylesheet> and <script> out of the page ----

  const css: CssEntry[] = []
  const scripts: ScriptSource[] = []
  const headScripts: Element[] = []
  const bodyScripts: Element[] = []
  const consumedScripts = new Set<string>()
  let inlineScriptCount = 0

  const extract = (element: Element, inHead: boolean): boolean => {
    const attr = (name: string) => element.attrs.find((a) => a.name === name)?.value
    switch (element.tagName) {
      case 'style':
        css.push({ kind: 'inline', css: textContent(element) })
        return true
      case 'link': {
        const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/)
        const href = attr('href')
        if (!rel.includes('stylesheet') || !href) return false
        const resolved = resolveUrl(file, href)
        if (!resolved) {
          // External stylesheet (e.g. Google Fonts): stays in the HTML file's <head>.
          if (!inHead) headScripts.push(element)
          return !inHead
        }
        if (files.has(resolved.path)) css.push({ kind: 'file', path: resolved.path })
        else notes.check('A linked CSS file was not found', 'This `<link>` points at a file that is not in your folder.', `${file}: ${href}`)
        return true
      }
      case 'script': {
        const type = (attr('type') ?? '').toLowerCase().trim()
        const src = attr('src')
        if (type === 'module') {
          notes.check(
            '`<script type="module">` is not converted yet',
            'This version only converts classic scripts. The module script was left out; ' +
              'its code needs to be moved into the React project by hand.',
            `${file}: ${src ?? '(inline)'}`,
          )
          return true
        }
        if (!JS_TYPES.has(type)) {
          headScripts.push(element) // JSON-LD, templates, etc.
          return true
        }
        if (src) {
          const resolved = resolveUrl(file, src)
          if (!resolved) {
            ;(inHead ? headScripts : bodyScripts).push(element)
          } else if (files.has(resolved.path)) {
            scripts.push({ label: resolved.path, code: readText(resolved.path) })
            consumedScripts.add(resolved.path)
          } else {
            notes.check('A script file was not found', 'This `<script src>` points at a file that is not in your folder.', `${file}: ${src}`)
          }
          return true
        }
        inlineScriptCount += 1
        scripts.push({ label: `${file} (inline <script>)`, code: textContent(element) })
        return true
      }
    }
    return false
  }

  const extractAll = (parent: ParentNode, inHead: boolean) => {
    parent.childNodes = parent.childNodes.filter((node) => {
      if (!isElement(node)) return true
      if (extract(node, inHead)) return false
      extractAll(node, inHead)
      return true
    })
  }
  extractAll(head, true)
  extractAll(body, false)
  if (inlineScriptCount > 1) {
    let n = 0
    for (const script of scripts) {
      if (script.label.endsWith('(inline <script>)')) script.label = script.label.replace('<script>', `<script> #${++n}`)
    }
  }

  // ---- File paths ----

  /** The site page a URL points at (`about.html`, `blog/`, `/`), if any. */
  const linkedPage = (path: string): string | null => {
    if (!routes) return null
    const candidates = HTML_EXTENSIONS.has(extname(path))
      ? [path]
      : [path, 'index.html', 'index.htm'].map((name, i) => (i === 0 ? name : path ? `${path}/${name}` : name))
    return candidates.find((candidate) => routes.has(candidate)) ?? null
  }

  const pageRoute = (url: string): string | null => {
    const resolved = resolveUrl(file, url)
    if (!resolved) return null
    const page = linkedPage(resolved.path)
    return page === null ? null : routes!.get(page)! + resolved.suffix
  }

  const rewriteUrl = (url: string): string => {
    const resolved = resolveUrl(file, url)
    if (!resolved) return url
    const page = linkedPage(resolved.path)
    if (page !== null) return routes!.get(page)! + resolved.suffix
    if (resolved.path === '') return url
    if (HTML_EXTENSIONS.has(extname(resolved.path))) {
      if (resolved.path !== file) {
        notes.check('A linked page was not found', 'These links point at HTML files that are not in your folder.', `${file}: ${url}`)
      }
      return url
    }
    if (!files.has(resolved.path)) {
      notes.check('A file used in your HTML was not found', 'These paths were left unchanged.', `${file}: ${url}`)
      return url
    }
    notes.change(
      'Image and file paths now start with `/`',
      'Images and other files moved to the `public/` folder, which Vite serves from the root of the site. ' +
        'So `./img/me.png` became `/img/me.png` (the file is at `public/img/me.png`).',
      `${file}: ${url}`,
    )
    return publicUrl(resolved.path, resolved.suffix)
  }

  const headElements = head.childNodes.filter(isElement)
  let headRewritten = false
  // Called after the body is printed, so CONVERSION.md lists the body's changes first.
  const rewriteHeadUrls = () => {
    if (headRewritten) return
    headRewritten = true
    for (const element of [...headElements, ...headScripts, ...bodyScripts]) {
      for (const attr of element.attrs) {
        if (attr.name === 'href' || attr.name === 'src') attr.value = rewriteUrl(attr.value)
      }
    }
  }

  // ---- <body> attributes ----

  let bodyOnload: string | null = null
  const bodyAttrs = body.attrs.filter((attr) => {
    if (!attr.name.startsWith('on')) return true
    if (attr.name === 'onload') {
      bodyOnload = attr.value.trim()
      notes.change(
        '`<body onload>` moved into the legacy script',
        'The code from `<body onload="...">` now runs at the end of `runLegacyScript()`, after the page is on screen.',
        file,
      )
    } else {
      notes.check('An event handler on `<body>` was removed', 'Move this code into the legacy script by hand.', `${file}: ${attr.name}`)
    }
    return false
  })

  // ---- JSX ----

  const { functions, variables } = collectTopLevelNames(scripts)
  const ctx: JsxContext = {
    file,
    globals: new Set([...functions, ...variables]),
    usedGlobals: new Set(),
    rewriteUrl,
    pageRoute: routes ? pageRoute : undefined,
    notes,
  }

  return {
    file,
    htmlAttrs: htmlElement.attrs,
    head: headElements,
    headScripts,
    bodyScripts,
    bodyAttrs,
    bodyOnload,
    css,
    scripts,
    consumedScripts,
    printBody: (depth) => printChildren(body.childNodes, ctx, depth, 'body'),
    rewriteHeadUrls,
    printHead: (elements, depth) => elements.flatMap((element) => printElement(element, ctx, depth)),
    exposedFunctions: () => [...ctx.usedGlobals].filter((name) => functions.has(name)),
    exposedVariables: () => [...ctx.usedGlobals].filter((name) => variables.has(name) && !functions.has(name)),
    usesLink: () => ctx.usesLink === true,
  }
}

export function serialize(element: Element): string {
  return serializeOuter(element)
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function findChild(parent: ParentNode, tag: string): Element | undefined {
  return parent.childNodes.find((node): node is Element => isElement(node) && node.tagName === tag)
}

function textContent(element: Element): string {
  return element.childNodes.map((node) => ('value' in node ? node.value : '')).join('')
}
