// Source text for the files the converter writes (other than the converted
// JSX, CSS and scripts themselves).

import type { Attribute } from './page'
import type { SitePage } from './pages'

const STRICT_MODE_NOTE = `// <StrictMode> is left out on purpose. In development it runs effects twice,
// so the code in your legacy script would also run twice (for example, adding
// every click listener two times). Add it back once that code is gone.
`

/** Single-page site: `src/App.jsx` holds the page's <body>. */
export function buildSingleApp(entry: string, jsxLines: string[], hasScripts: boolean): string {
  const imports = hasScripts ? `import { useEffect } from 'react'\nimport { runLegacyScript } from './legacy-script.js'\n\n` : ''
  const effect = hasScripts
    ? `  // Runs your original JavaScript once, after React has put the page on screen.
  useEffect(() => {
    runLegacyScript()
  }, [])

`
    : ''
  return `${imports}// Converted from ${entry}. The JSX below is your page's <body>.
function App() {
${effect}  return (
${fragment(jsxLines)}
  )
}

export default App
`
}

/** Multi-page site: `src/App.jsx` picks the page component that matches the URL. */
export function buildRouterApp(pages: SitePage[]): string {
  const imports = pages.map((page) => `import ${page.component} from './pages/${page.component}.jsx'\n`).join('')
  const routes = pages.map((page) => `        <Route path="${page.route}" element={<${page.component} />} />\n`).join('')
  return `import { Route, Routes } from 'react-router'
import ScrollToTop from './ScrollToTop.jsx'
${imports}
// Each page of your site is now a component. React Router shows the one whose
// path matches the URL, without loading a new HTML file.
function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
${routes}        <Route path="*" element={<p>Page not found</p>} />
      </Routes>
    </>
  )
}

export default App
`
}

export interface PageComponentInput {
  page: SitePage
  cssImports: string[]
  /** e.g. `./HomePage.legacy-script.js`, or null when the page has no JavaScript. */
  legacyScript: string | null
  usesLink: boolean
  /** <body> attributes only this page had. */
  bodyAttrs: Attribute[]
  /** JSX lines for <title>/<meta> (React 19 moves them into <head>). */
  headLines: string[]
  bodyLines: string[]
}

export function buildPageComponent(input: PageComponentInput): string {
  const { page, cssImports, legacyScript, usesLink, bodyAttrs, headLines, bodyLines } = input
  const imports: string[] = []
  if (legacyScript || bodyAttrs.length > 0) imports.push(`import { useEffect } from 'react'`)
  if (usesLink) imports.push(`import { Link } from 'react-router'`)
  if (legacyScript) imports.push(`import { runLegacyScript } from '${legacyScript}'`)
  imports.push(...cssImports.map((path) => `import '${path}'`))

  const effects: string[] = []
  if (bodyAttrs.length > 0) {
    const list = bodyAttrs.map((attr) => `${attr.name}="${attr.value}"`).join(' ')
    effects.push(
      `  // Converter: on ${page.file}, <body> had ${list}. All pages now share one`,
      `  // <body>, so this page adds it when it opens and removes it when you leave.`,
      `  useEffect(() => {`,
      ...bodyAttrs.map((attr) => `    document.body.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)})`),
      `    return () => {`,
      ...bodyAttrs.map((attr) => `      document.body.removeAttribute(${JSON.stringify(attr.name)})`),
      `    }`,
      `  }, [])`,
      '',
    )
  }
  if (legacyScript) {
    effects.push(
      `  // Runs your original JavaScript when this page opens. What it returns stops`,
      `  // its timers and listeners when you go to another page.`,
      `  useEffect(() => {`,
      `    return runLegacyScript()`,
      `  }, [])`,
      '',
    )
  }

  const name = page.component
  return `${imports.join('\n')}${imports.length > 0 ? '\n\n' : ''}// Converted from ${page.file}. The JSX below is that page's <body>.
function ${name}() {
${effects.map((line) => line + '\n').join('')}  return (
${fragment([...headLines, ...bodyLines])}
  )
}

export default ${name}
`
}

export interface MainInput {
  cssImports: string[]
  strictMode: boolean
  router: boolean
}

export function buildMain({ cssImports, strictMode, router }: MainInput): string {
  const imports = [
    ...(strictMode ? [`import { StrictMode } from 'react'`] : []),
    `import { createRoot } from 'react-dom/client'`,
    ...(router ? [`import { BrowserRouter } from 'react-router'`] : []),
    ...cssImports.map((path) => `import '${path}'`),
    `import App from './App.jsx'`,
  ]
  const redirect = router
    ? `
// Old links like "about.html" (for example in your JavaScript) open the new
// URL ("/about") instead.
if (/\\.html?$/.test(location.pathname)) {
  const path = location.pathname.replace(/\\.html?$/, '').replace(/\\/index$/, '') || '/'
  history.replaceState(null, '', path + location.search + location.hash)
}
`
    : ''

  let tree = '<App />'
  if (router) tree = `<BrowserRouter>\n  ${tree}\n</BrowserRouter>`
  if (strictMode) tree = `<StrictMode>\n${indent(tree, '  ')}\n</StrictMode>`
  const render = tree.includes('\n')
    ? `createRoot(document.getElementById('root')).render(\n${indent(tree, '  ')},\n)`
    : `createRoot(document.getElementById('root')).render(${tree})`

  return `${imports.join('\n')}
${redirect}
${strictMode ? '' : STRICT_MODE_NOTE}${render}
`
}

export interface IndexHtmlInput {
  htmlAttrs: Attribute[]
  /** Serialized <head> elements. */
  head: string[]
  bodyAttrs: Attribute[]
  /** Serialized <script> elements that stay at the end of <body>. */
  bodyScripts: string[]
}

export function buildIndexHtml({ htmlAttrs, head, bodyAttrs, bodyScripts }: IndexHtmlInput): string {
  const headLines = [...head]
  if (!headLines.some((line) => /^<meta[^>]*\scharset=/i.test(line))) headLines.unshift('<meta charset="UTF-8" />')
  const attrs = (list: Attribute[]) =>
    list.map((attr) => ` ${attr.name}="${attr.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join('')
  return `<!doctype html>
<html${attrs(htmlAttrs)}>
  <head>
${indent(headLines.join('\n'), '    ')}
  </head>
  <body${attrs(bodyAttrs)}>
    <!-- React puts your page inside this div. "display: contents" makes the div
         invisible to CSS layout, so your styles work as if it wasn't there. -->
    <div id="root" style="display: contents"></div>
${bodyScripts.length > 0 ? indent(bodyScripts.join('\n'), '    ') + '\n' : ''}    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`
}

export const SCROLL_TO_TOP = `import { useEffect } from 'react'
import { useLocation } from 'react-router'

// When you open a new page on a normal website, it starts at the top (or at
// the #section in the link). React Router switches pages without loading a
// new one, so this component does that scrolling by hand.
function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

export default ScrollToTop
`

export const LEGACY_PAGE_HELPER = `// Used by the *.legacy-script.js files in src/pages/ (added by the converter).
//
// On a normal website, opening another page throws away everything the old
// page's JavaScript started. With React Router the browser never leaves the
// page, so listeners on window/document and running timers would pile up
// every time you came back. trackPage() remembers them, and stop() ends them
// when you leave the page. Delete this file once no page imports it.

export function trackPage() {
  const listeners = []
  const timeouts = new Set()
  const intervals = new Set()
  const frames = new Set()

  for (const target of [window, document]) {
    target.addEventListener = (type, listener, options) => {
      EventTarget.prototype.addEventListener.call(target, type, listener, options)
      listeners.push([target, type, listener, options])
    }
  }

  return {
    setTimeout(callback, delay, ...args) {
      const id = window.setTimeout(() => {
        timeouts.delete(id)
        callback(...args)
      }, delay)
      timeouts.add(id)
      return id
    },
    setInterval(callback, delay, ...args) {
      const id = window.setInterval(callback, delay, ...args)
      intervals.add(id)
      return id
    },
    requestAnimationFrame(callback) {
      const id = window.requestAnimationFrame((time) => {
        frames.delete(id)
        callback(time)
      })
      frames.add(id)
      return id
    },
    stop() {
      delete window.addEventListener
      delete document.addEventListener
      for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options)
      timeouts.forEach((id) => clearTimeout(id))
      intervals.forEach((id) => clearInterval(id))
      frames.forEach((id) => cancelAnimationFrame(id))
    },
  }
}
`

function fragment(lines: string[]): string {
  return lines.length > 0 ? `    <>\n${lines.join('\n')}\n    </>` : '    <></>'
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n')
}
