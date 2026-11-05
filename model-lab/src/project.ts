// Reading a project folder into a SuggestRequest (same rules as collectRequest in
// frontend/src/lib/aiClient.ts, but on Node's file system) and applying a suggestion.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { AiStep, ProjectFile, SuggestRequest, Suggestion } from '../../frontend/src/lib/aiApi'

const WHOLE_SITE = '*'

export function readProject(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(jsx?|css|html|json|md)$/.test(entry)) files.set(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8'))
    }
  }
  walk(root)
  return files
}

export function copyProject(from: string, to: string) {
  cpSync(from, to, { recursive: true, filter: (src) => !src.includes('node_modules') })
}

export function buildRequest(root: string, step: AiStep, target?: string): SuggestRequest {
  const snapshot = readProject(root)
  const paths = [...snapshot.keys()].filter((path) => path.startsWith('src/')).sort()
  const multiPage = paths.some((path) => /^src\/pages\/[^/]+\.jsx$/.test(path))
  const isComponentFile = (path: string) =>
    /^src\/components\/.+\.jsx$/.test(path) || (multiPage ? /^src\/pages\/[^/]+\.jsx$/.test(path) : path === 'src/App.jsx')
  const isLegacy = (path: string) => /legacy-script\.js$/.test(path)
  const isCss = (path: string) => path.endsWith('.css')

  let isEditable: (path: string) => boolean
  let isContext: (path: string) => boolean
  if (step === 'tailwind') {
    isEditable = (path) => isComponentFile(path) && (!target || target === WHOLE_SITE || path === target)
    isContext = (path) => isCss(path) || isLegacy(path)
  } else if (step === 'tailwind-cleanup') {
    isEditable = isCss
    isContext = (path) => isComponentFile(path) || isLegacy(path)
  } else {
    isEditable = isComponentFile
    isContext = (path) => isLegacy(path) || (multiPage && path === 'src/App.jsx')
  }
  const read = (path: string): ProjectFile => ({ path, content: snapshot.get(path)! })
  return {
    step,
    target,
    editable: paths.filter(isEditable).map(read),
    context: paths.filter((path) => !isEditable(path) && isContext(path)).map(read),
  }
}

export function applySuggestion(root: string, suggestion: Suggestion) {
  for (const file of suggestion.files) {
    const path = join(root, file.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.content)
  }
}

/** Same three edits as frontend/src/lib/tailwindSetup.ts, for the Tailwind step (CSS side only). */
export function setupTailwind(root: string) {
  const marker = 'tailwindcss/utilities.css'
  const cssPath = join(root, 'src/style.css')
  if (!existsSync(cssPath)) return
  const css = readFileSync(cssPath, 'utf8')
  if (css.includes(marker)) return
  const header = `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

`
  writeFileSync(cssPath, header + css)
  const vitePath = join(root, 'vite.config.js')
  let vite = readFileSync(vitePath, 'utf8')
  if (!vite.includes('@tailwindcss/vite')) {
    vite = "import tailwindcss from '@tailwindcss/vite'\n" + vite.replace('plugins: [react()]', 'plugins: [react(), tailwindcss()]')
    writeFileSync(vitePath, vite)
  }
}
