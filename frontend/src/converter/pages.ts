// A site with several HTML pages becomes one React app: each page turns into
// a component (`about.html` → `AboutPage`) shown by React Router at a URL
// (`about.html` → `/about`).

import { extname } from './paths'

export const HTML_EXTENSIONS = new Set(['.html', '.htm'])

export interface SitePage {
  /** Site-root-relative path of the HTML file, e.g. `about.html` or `blog/post.html`. */
  file: string
  /** React Router path, e.g. `/`, `/about`, `/blog/post`. */
  route: string
  /** Component name, e.g. `HomePage`, `AboutPage`, `BlogPostPage`. */
  component: string
}

/** Every HTML page in the site (any folder), with the top-level `index.html` first. */
export function findSitePages(paths: Iterable<string>): string[] {
  const pages = [...paths].filter((path) => HTML_EXTENSIONS.has(extname(path)))
  const rank = (path: string) => (isRootIndex(path) ? 0 : path.includes('/') ? 2 : 1)
  return pages.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export function isRootIndex(path: string): boolean {
  return /^index\.html?$/i.test(path)
}

export function describePages(files: string[]): SitePage[] {
  const used = new Set<string>()
  return files.map((file) => {
    let component = componentName(file)
    for (let n = 2; used.has(component); n++) component = componentName(file).replace(/Page$/, `${n}Page`)
    used.add(component)
    return { file, route: routePath(file), component }
  })
}

/** `index.html` → `/`, `about.html` → `/about`, `blog/index.html` → `/blog`. */
export function routePath(file: string): string {
  const path = file.replace(/\.html?$/i, '').replace(/(^|\/)index$/i, '')
  return '/' + path.replace(/\/$/, '')
}

/** `index.html` → `HomePage`, `my-projects.html` → `MyProjectsPage`, `blog/post.html` → `BlogPostPage`. */
export function componentName(file: string): string {
  if (isRootIndex(file)) return 'HomePage'
  const words = file
    .replace(/\.html?$/i, '')
    .replace(/(^|\/)index$/i, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  let name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('')
  if (!/^[A-Z]/.test(name)) name = 'Page' + name
  return name + 'Page'
}
