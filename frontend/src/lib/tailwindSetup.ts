// Switches Tailwind CSS on in a participant's project (Workshop 4, Step 4).
// No AI: three small, predictable edits.
//   1. package.json: add tailwindcss + @tailwindcss/vite if missing
//      (converted projects already have them; Launchpad reinstalls when this file changes)
//   2. vite.config.js: add the Tailwind plugin
//   3. the main CSS file: load Tailwind's theme and utility classes
// Tailwind's "preflight" reset is left out on purpose, so turning Tailwind on
// changes nothing on screen until classes are used.

import { readTextFile, writeLocalFile } from './localFolder'

const VERSION = '^4.3.4'
const PACKAGES = ['tailwindcss', '@tailwindcss/vite']
const CSS_MARKER = 'tailwindcss/utilities.css'

const CSS_IMPORT = `/* Tailwind CSS (added by Launchpad). Only its classes are loaded, not its
   "preflight" reset, so your page looks the same until you use them. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

`

export interface TailwindStatus {
  packages: boolean
  plugin: boolean
  /** CSS file that loads Tailwind, or null. */
  cssFile: string | null
}

export function isTailwindReady(status: TailwindStatus): boolean {
  return status.packages && status.plugin && status.cssFile !== null
}

export async function checkTailwind(dir: FileSystemDirectoryHandle): Promise<TailwindStatus> {
  const pkg = parseJson(await readTextFile(dir, 'package.json'))
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const viteConfig = (await readTextFile(dir, 'vite.config.js')) ?? ''
  const cssFile = await mainCssFile(dir)
  const css = cssFile ? await readTextFile(dir, cssFile) : null
  return {
    packages: PACKAGES.every((name) => name in deps),
    plugin: viteConfig.includes('@tailwindcss/vite'),
    cssFile: css?.includes(CSS_MARKER) ? cssFile : null,
  }
}

export interface SetupResult {
  /** True when package.json changed (Launchpad reinstalls packages). */
  installing: boolean
  /** Steps that couldn't be done automatically, for the participant to do by hand. */
  manual: string[]
}

export async function setupTailwind(dir: FileSystemDirectoryHandle): Promise<SetupResult> {
  const manual: string[] = []
  let installing = false

  // 1. package.json
  const pkgText = await readTextFile(dir, 'package.json')
  const pkg = parseJson(pkgText)
  if (pkg) {
    pkg.devDependencies ??= {}
    for (const name of PACKAGES) {
      if (!(name in { ...pkg.dependencies, ...pkg.devDependencies })) {
        pkg.devDependencies[name] = VERSION
        installing = true
      }
    }
    if (installing) await writeLocalFile(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n')
  } else {
    manual.push('Add "tailwindcss" and "@tailwindcss/vite" to devDependencies in package.json.')
  }

  // 2. vite.config.js
  const config = await readTextFile(dir, 'vite.config.js')
  if (config !== null && !config.includes('@tailwindcss/vite')) {
    const withPlugin = config.replace(/plugins:\s*\[([^\]]*)\]/, (_, inner: string) => {
      const list = inner.trim().replace(/,\s*$/, '')
      return `plugins: [${list ? list + ', ' : ''}tailwindcss()]`
    })
    if (withPlugin === config) {
      manual.push('In vite.config.js, add tailwindcss() to plugins.')
    } else {
      const lines = withPlugin.split('\n')
      const lastImport = lines.findLastIndex((line) => line.startsWith('import '))
      lines.splice(lastImport + 1, 0, "import tailwindcss from '@tailwindcss/vite'")
      await writeLocalFile(dir, 'vite.config.js', lines.join('\n'))
    }
  } else if (config === null) {
    manual.push('Create vite.config.js with the Tailwind plugin.')
  }

  // 3. CSS
  let cssFile = await mainCssFile(dir)
  if (!cssFile) {
    // No CSS imported from main.jsx: add one.
    cssFile = 'src/tailwind.css'
    const main = await readTextFile(dir, 'src/main.jsx')
    if (main === null) {
      manual.push('Import a CSS file that contains @import "tailwindcss"; from src/main.jsx.')
      return { installing, manual }
    }
    const lines = main.split('\n')
    const lastImport = lines.findLastIndex((line) => line.startsWith('import '))
    lines.splice(lastImport + 1, 0, "import './tailwind.css'")
    await writeLocalFile(dir, 'src/main.jsx', lines.join('\n'))
    await writeLocalFile(dir, cssFile, '')
  }
  const css = (await readTextFile(dir, cssFile)) ?? ''
  if (!css.includes(CSS_MARKER)) {
    // @charset must stay first; Tailwind's lines go right after it.
    const charset = /^@charset[^;]*;\s*/.exec(css)?.[0] ?? ''
    await writeLocalFile(dir, cssFile, charset + CSS_IMPORT + css.slice(charset.length))
  }
  return { installing, manual }
}

/** The first CSS file src/main.jsx imports (`import './style.css'` → `src/style.css`). */
async function mainCssFile(dir: FileSystemDirectoryHandle): Promise<string | null> {
  const main = await readTextFile(dir, 'src/main.jsx')
  const match = main && /import\s+['"]\.\/([^'"]+\.css)['"]/.exec(main)
  return match ? `src/${match[1]}` : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string | null): any {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
