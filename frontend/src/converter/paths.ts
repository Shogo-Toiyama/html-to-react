// Helpers for the relative URLs found in a static site (`./img/a.png`,
// `../css/x.css`, `/favicon.ico`). Paths are POSIX-style and relative to the
// site root, without a leading slash: `img/a.png`.

const EXTERNAL_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/** True for URLs that don't point at a file in the site (http:, data:, mailto:, #hash, //cdn…). */
export function isExternalUrl(url: string): boolean {
  return EXTERNAL_URL.test(url.trim())
}

export interface ResolvedUrl {
  /** Site-root-relative file path, e.g. `img/a.png`. */
  path: string
  /** `?query` and/or `#hash` that followed the path (kept when rewriting). */
  suffix: string
}

/** Resolves `url` as written in `fromFile` to a site-root-relative path, or null if it is external. */
export function resolveUrl(fromFile: string, url: string): ResolvedUrl | null {
  const trimmed = url.trim()
  if (trimmed === '' || isExternalUrl(trimmed)) return null

  const suffixStart = trimmed.search(/[?#]/)
  const rawPath = suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart)
  const suffix = suffixStart === -1 ? '' : trimmed.slice(suffixStart)
  if (rawPath === '') return null

  let decoded = rawPath
  try {
    decoded = decodeURI(rawPath)
  } catch {
    // Keep malformed escapes as written.
  }

  const base = decoded.startsWith('/') ? [] : dirname(fromFile).split('/').filter(Boolean)
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') base.pop()
    else base.push(part)
  }
  return { path: base.join('/'), suffix }
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extname(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/** URL for a file served from Vite's `public/` folder. */
export function publicUrl(path: string, suffix = ''): string {
  return '/' + encodeURI(path) + suffix
}
