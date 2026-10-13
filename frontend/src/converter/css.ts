import type { NoteCollector } from './notes'
import { extname, publicUrl, resolveUrl } from './paths'

const URL_PATTERN = /url\(\s*(['"]?)([^'")]*?)\1\s*\)/g

/**
 * CSS files move into `src/` while images and fonts move into `public/`, so
 * relative `url(...)` references to assets become absolute (`/img/bg.png`).
 * References to other CSS files stay relative because CSS keeps its folder
 * layout inside `src/`.
 */
export function rewriteCssUrls(
  css: string,
  cssPath: string,
  fileExists: (path: string) => boolean,
  notes: NoteCollector,
): string {
  return css.replace(URL_PATTERN, (match, quote: string, url: string) => {
    const resolved = resolveUrl(cssPath, url)
    if (!resolved || extname(resolved.path) === '.css') return match
    if (!fileExists(resolved.path)) {
      notes.check(
        'A file used in your CSS was not found',
        'These paths point at files that are not in your folder, so they were left unchanged.',
        `${cssPath}: url(${url})`,
      )
      return match
    }
    notes.change(
      'CSS `url(...)` paths now start with `/`',
      'Images and fonts moved to the `public/` folder, which Vite serves from the root of the site. ' +
        'A path like `/img/bg.png` means `public/img/bg.png`.',
      `${cssPath}: url(${url})`,
    )
    return `url(${quote}${publicUrl(resolved.path, resolved.suffix)}${quote})`
  })
}

/**
 * Splits an inline `style="..."` attribute into declarations, respecting
 * semicolons inside `url(...)` or quotes.
 */
export function parseInlineStyle(style: string): [property: string, value: string][] {
  const declarations: [string, string][] = []
  let current = ''
  let depth = 0
  let quote: string | null = null

  const flush = () => {
    const colon = current.indexOf(':')
    if (colon > 0) {
      const property = current.slice(0, colon).trim()
      const value = current.slice(colon + 1).trim()
      if (property && value) declarations.push([property, value])
    }
    current = ''
  }

  for (const char of style) {
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth = Math.max(0, depth - 1)
    } else if (char === ';' && depth === 0) {
      flush()
      continue
    }
    current += char
  }
  flush()
  return declarations
}
