import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { createPackageJson, GITIGNORE, VITE_CONFIG } from '../lib/starterProject'
import { rewriteCssUrls } from './css'
import { printChildren, type JsxContext } from './jsx'
import { buildLegacyScript, collectTopLevelNames, type ScriptSource } from './legacyScript'
import { NoteCollector, type Note } from './notes'
import { basename, extname, publicUrl, resolveUrl } from './paths'
import { buildReport, type FileMove } from './report'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type ChildNode = DefaultTreeAdapterTypes.ChildNode

/** Files that belong to the old site's tooling, not the site itself. Not copied. */
const SKIPPED_EXTENSIONS = new Set(['.md', '.yml', '.yaml', '.toml', '.lock', '.sh', '.py', '.bat', '.ps1'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'])

export interface ConvertInput {
  /** Every file of the site, keyed by root-relative path (`img/a.png`). */
  files: Map<string, Uint8Array>
  /** Used for the package name, e.g. the folder name. */
  siteName: string
  /** The HTML page to convert. Defaults to `index.html` (see `findHtmlPages`). */
  entry?: string
}

export interface ConversionResult {
  entry: string
  /** The React project's files, keyed by path. */
  files: Map<string, string | Uint8Array>
  notes: Note[]
}

/** Root-level HTML pages, with `index.html` first. */
export function findHtmlPages(paths: Iterable<string>): string[] {
  const pages = [...paths].filter((path) => !path.includes('/') && HTML_EXTENSIONS.has(extname(path)))
  return pages.sort((a, b) => Number(isIndex(b)) - Number(isIndex(a)) || a.localeCompare(b))
}

function isIndex(path: string): boolean {
  return /^index\.html?$/i.test(path)
}

export function convertSite(input: ConvertInput): ConversionResult {
  const { files, siteName } = input
  const entry = input.entry ?? findHtmlPages(files.keys())[0]
  if (!entry) throw new Error('No HTML page found in the top level of this folder.')

  const decoder = new TextDecoder()
  const readText = (path: string) => decoder.decode(files.get(path))
  const notes = new NoteCollector()
  const output = new Map<string, string | Uint8Array>()
  const moves: FileMove[] = []

  const document = parse(readText(entry))
  const htmlElement = findChild(document, 'html')!
  const head = findChild(htmlElement, 'head')!
  const body = findChild(htmlElement, 'body')!

  // ---- Pull <style>, <link rel=stylesheet> and <script> out of the page ----

  type CssEntry = { kind: 'file'; path: string } | { kind: 'inline'; css: string }
  const cssEntries: CssEntry[] = []
  const scripts: ScriptSource[] = []
  const headScripts: Element[] = []
  const bodyScripts: Element[] = []
  const consumedScripts = new Set<string>()
  let inlineScriptCount = 0

  const extract = (element: Element, inHead: boolean): boolean => {
    const attr = (name: string) => element.attrs.find((a) => a.name === name)?.value
    switch (element.tagName) {
      case 'style':
        cssEntries.push({ kind: 'inline', css: textContent(element) })
        return true
      case 'link': {
        const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/)
        const href = attr('href')
        if (!rel.includes('stylesheet') || !href) return false
        const resolved = resolveUrl(entry, href)
        if (!resolved) {
          if (!inHead) headScripts.push(element)
          return !inHead
        }
        if (files.has(resolved.path)) cssEntries.push({ kind: 'file', path: resolved.path })
        else notes.check('A linked CSS file was not found', 'This `<link>` points at a file that is not in your folder.', href)
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
            src ?? `${entry} (inline)`,
          )
          return true
        }
        if (!JS_TYPES.has(type)) {
          headScripts.push(element) // JSON-LD, templates, etc.
          return true
        }
        if (src) {
          const resolved = resolveUrl(entry, src)
          if (!resolved) {
            ;(inHead ? headScripts : bodyScripts).push(element)
          } else if (files.has(resolved.path)) {
            scripts.push({ label: resolved.path, code: readText(resolved.path) })
            consumedScripts.add(resolved.path)
          } else {
            notes.check('A script file was not found', 'This `<script src>` points at a file that is not in your folder.', src)
          }
          return true
        }
        inlineScriptCount += 1
        scripts.push({ label: `${entry} (inline <script>)`, code: textContent(element) })
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

  // ---- Assets: everything else goes to public/ ----

  const rewriteUrl = (url: string): string => {
    const resolved = resolveUrl(entry, url)
    if (!resolved || resolved.path === '') return url
    if (HTML_EXTENSIONS.has(extname(resolved.path))) {
      if (resolved.path !== entry) {
        notes.check(
          'Links to other pages won’t work yet',
          `This version converts one page (${entry}). Links to other HTML pages will show the converted page ` +
            'instead. Support for multiple pages is coming.',
          url,
        )
      }
      return url
    }
    if (!files.has(resolved.path)) {
      notes.check('A file used in your HTML was not found', 'These paths were left unchanged.', url)
      return url
    }
    notes.change(
      'Image and file paths now start with `/`',
      'Images and other files moved to the `public/` folder, which Vite serves from the root of the site. ' +
        'So `./img/me.png` became `/img/me.png` (the file is at `public/img/me.png`).',
      url,
    )
    return publicUrl(resolved.path, resolved.suffix)
  }

  // ---- Body → App.jsx ----

  const { functions, variables } = collectTopLevelNames(scripts)
  const ctx: JsxContext = {
    file: entry,
    globals: new Set([...functions, ...variables]),
    usedGlobals: new Set(),
    rewriteUrl,
    notes,
  }
  const jsxLines = printChildren(body.childNodes, ctx, 3, 'body')

  let bodyOnload: string | null = null
  const bodyAttributes = body.attrs.filter((attr) => {
    if (!attr.name.startsWith('on')) return true
    if (attr.name === 'onload') {
      bodyOnload = attr.value.trim()
      notes.change(
        '`<body onload>` moved into legacy-script.js',
        'The code from `<body onload="...">` now runs at the end of `runLegacyScript()`, after the page is on screen.',
      )
    } else {
      notes.check('An event handler on `<body>` was removed', 'Move this code into legacy-script.js by hand.', attr.name)
    }
    return false
  })

  const hasScripts = scripts.length > 0 || bodyOnload !== null
  if (hasScripts) {
    output.set(
      'src/legacy-script.js',
      buildLegacyScript({
        sources: scripts,
        exposedFunctions: [...ctx.usedGlobals].filter((name) => functions.has(name)),
        exposedVariables: [...ctx.usedGlobals].filter((name) => variables.has(name) && !functions.has(name)),
        bodyOnload,
        notes,
      }),
    )
    moves.push({ from: scripts.map((s) => `\`${s.label}\``).join(', ') || '`<body onload>`', to: '`src/legacy-script.js`' })
  }
  output.set('src/App.jsx', buildApp(entry, jsxLines, hasScripts))
  moves.unshift({ from: `\`${entry}\` → \`<body>\``, to: '`src/App.jsx` (as JSX)' })

  // ---- CSS → src/ ----

  const cssImports: string[] = []
  for (const path of files.keys()) {
    if (extname(path) !== '.css') continue
    output.set(`src/${path}`, rewriteCssUrls(readText(path), path, (p) => files.has(p), notes))
  }
  const entryBase = basename(entry).replace(/\.html?$/i, '')
  let inlineIndex = 0
  for (const css of cssEntries) {
    if (css.kind === 'file') {
      cssImports.push(`./${css.path}`)
      moves.push({ from: `\`${css.path}\``, to: `\`src/${css.path}\`` })
      continue
    }
    let name: string
    do {
      inlineIndex += 1
      name = inlineIndex === 1 ? `${entryBase}.css` : `${entryBase}-${inlineIndex}.css`
    } while (output.has(`src/${name}`))
    output.set(`src/${name}`, rewriteCssUrls(css.css.replace(/^\n+/, ''), entry, (p) => files.has(p), notes))
    cssImports.push(`./${name}`)
    moves.push({ from: `\`<style>\` in \`${entry}\``, to: `\`src/${name}\`` })
  }

  // ---- Everything else ----

  let assetCount = 0
  const skipped: string[] = []
  for (const [path, bytes] of files) {
    const ext = extname(path)
    if (path === entry || ext === '.css' || consumedScripts.has(path)) continue
    if (HTML_EXTENSIONS.has(ext) || SKIPPED_EXTENSIONS.has(ext)) {
      skipped.push(path)
      continue
    }
    output.set(`public/${path}`, bytes)
    assetCount += 1
  }
  if (assetCount > 0) moves.push({ from: `Images and other files (${assetCount})`, to: '`public/` (same folder layout)' })
  if (skipped.length > 0) {
    notes.check(
      'Some files were not copied',
      'Other HTML pages and files that aren’t part of the website (like notes or config files) were left in your ' +
        'original folder.',
      skipped.join(', '),
    )
  }

  output.set('src/main.jsx', buildMain(cssImports, hasScripts))
  output.set('index.html', buildIndexHtml(htmlElement, head, bodyAttributes, headScripts, bodyScripts, rewriteUrl))
  moves.splice(1, 0, { from: `\`${entry}\` → \`<head>\``, to: '`index.html`' })
  output.set('package.json', createPackageJson(packageName(siteName)))
  output.set('vite.config.js', VITE_CONFIG)
  output.set('.gitignore', GITIGNORE)
  output.set('CONVERSION.md', buildReport({ entry, moves, notes: notes.list(), hasScripts }))

  return { entry, files: output, notes: notes.list() }
}

function buildApp(entry: string, jsxLines: string[], hasScripts: boolean): string {
  const imports = hasScripts ? `import { useEffect } from 'react'\nimport { runLegacyScript } from './legacy-script.js'\n\n` : ''
  const effect = hasScripts
    ? `  // Runs your original JavaScript once, after React has put the page on screen.
  useEffect(() => {
    runLegacyScript()
  }, [])

`
    : ''
  const jsx = jsxLines.length > 0 ? `    <>\n${jsxLines.join('\n')}\n    </>` : '    <></>'
  return `${imports}// Converted from ${entry}. The JSX below is your page's <body>.
function App() {
${effect}  return (
${jsx}
  )
}

export default App
`
}

function buildMain(cssImports: string[], hasScripts: boolean): string {
  const css = cssImports.map((path) => `import '${path}'\n`).join('')
  if (!hasScripts) {
    return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
${css}import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
  }
  return `import { createRoot } from 'react-dom/client'
${css}import App from './App.jsx'

// <StrictMode> is left out on purpose. In development it runs effects twice,
// so the code in legacy-script.js would also run twice (for example, adding
// every click listener two times). Add it back once that code is gone.
createRoot(document.getElementById('root')).render(<App />)
`
}

function buildIndexHtml(
  html: Element,
  head: Element,
  bodyAttributes: DefaultTreeAdapterTypes.Element['attrs'],
  headScripts: Element[],
  bodyScripts: Element[],
  rewriteUrl: (url: string) => string,
): string {
  const headLines: string[] = []
  for (const node of head.childNodes) {
    if (!isElement(node)) continue
    for (const attr of node.attrs) {
      if (attr.name === 'href' || attr.name === 'src') attr.value = rewriteUrl(attr.value)
    }
    headLines.push(serializeOuter(node))
  }
  for (const script of headScripts) headLines.push(serializeOuter(script))
  const hasCharset = head.childNodes.some((node) => isElement(node) && node.tagName === 'meta' && node.attrs.some((a) => a.name === 'charset'))
  if (!hasCharset) headLines.unshift('<meta charset="UTF-8" />')

  const attrs = (list: Element['attrs']) =>
    list.map((attr) => ` ${attr.name}="${attr.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join('')

  const indent = (lines: string[], pad: string) => lines.map((line) => pad + line).join('\n')
  return `<!doctype html>
<html${attrs(html.attrs)}>
  <head>
${indent(headLines, '    ')}
  </head>
  <body${attrs(bodyAttributes)}>
    <!-- React puts your page inside this div. "display: contents" makes the div
         invisible to CSS layout, so your styles work as if it wasn't there. -->
    <div id="root" style="display: contents"></div>
${bodyScripts.length > 0 ? indent(bodyScripts.map((s) => serializeOuter(s)), '    ') + '\n' : ''}    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`
}

function packageName(siteName: string): string {
  const slug = siteName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return (slug || 'my-site') + '-react'
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
