// Shows a chat proposal on its own before it is applied. The proposed files
// are written only into the container, under `.launchpad-runtime/drafts/<id>/`
// at their project paths, next to a small page that renders the proposal's
// example JSX. The wrapper Vite config (previewBridge.ts) sends imports of
// files the draft doesn't have to the real project. The participant's folder
// is never touched.

import type { ChatProposal, ProjectFile } from './aiApi'
import { collectChatFiles } from './aiClient'
import { readTextFile } from './localFolder'
import { DRAFTS_DIR } from './previewBridge'
import { getWebContainer } from './webcontainer'

/** Why a proposal can't be shown on its own (shown to the participant), or the page to open. */
export type DraftResult = { ok: true; path: string } | { ok: false; reason: string }

export async function writeDraft(dir: FileSystemDirectoryHandle, id: string, proposal: ChatProposal): Promise<DraftResult> {
  const preview = proposal.preview
  if (!preview?.jsx.trim()) return { ok: false, reason: 'This change has no example to show on its own.' }

  const project = await collectChatFiles(dir)
  const drafted = new Map(proposal.files.map((file) => [file.path, file.content]))
  const current = (path: string) => drafted.get(path) ?? project.find((file) => file.path === path)?.content
  const base = `${DRAFTS_DIR}/${safeId(id)}`
  /** Import specifier from the draft's page: the draft copy if there is one, else the project's file. */
  const from = (path: string) => (drafted.has(path) ? `./${path}` : `/${path}`)

  // Components used in the example.
  const tags = [...new Set([...preview.jsx.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]))]
  const imports: string[] = []
  for (const tag of tags) {
    const file = findComponentFile(tag, [...proposal.files, ...project])
    if (!file) return { ok: false, reason: `Couldn’t find where <${tag}> is defined.` }
    imports.push(`import ${tag} from '${from(file)}'`)
  }

  // The site's CSS, in the order the app loads it (main.jsx, App.jsx, then the pages).
  const entries = ['src/main.jsx', 'src/App.jsx', ...project.map((f) => f.path).filter((p) => /^src\/pages\/[^/]+\.jsx$/.test(p))]
  const css: string[] = []
  for (const entry of entries) {
    for (const match of (current(entry) ?? '').matchAll(/^\s*import\s+["'](\.{1,2}\/[^"']+\.css)["']/gm)) {
      const path = resolve(entry, match[1])
      if (!css.includes(path) && current(path) !== undefined) css.push(path)
    }
  }
  const usesTailwind = [...css, ...proposal.files.map((f) => f.path)].some((path) =>
    /@import\s+["']tailwindcss/.test(current(path) ?? ''),
  )
  const pkg = JSON.parse(current('package.json') ?? '{}')
  const hasRouter = Boolean({ ...pkg.dependencies, ...pkg.devDependencies }['react-router'])

  const page = `import { Component } from 'react'
import { createRoot } from 'react-dom/client'
${hasRouter ? "import { MemoryRouter } from 'react-router'\n" : ''}${css.map((path) => `import '${from(path)}'`).join('\n')}
${usesTailwind ? "import './launchpad-draft.css'\n" : ''}${imports.join('\n')}

class LaunchpadBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <pre style={{ margin: 12, color: '#cd2b31', whiteSpace: 'pre-wrap', font: '12px/1.5 ui-monospace, monospace' }}>
        {String(this.state.error?.stack || this.state.error)}
      </pre>
    )
  }
}

const example = (
  <>
${preview.jsx}
  </>
)

createRoot(document.getElementById('root')).render(
  <LaunchpadBoundary>${hasRouter ? '<MemoryRouter>{example}</MemoryRouter>' : '{example}'}</LaunchpadBoundary>,
)
`

  // Fonts and other <link>s from the site's index.html.
  const indexHtml = (await readTextFile(dir, 'index.html').catch(() => null)) ?? ''
  const links = [...indexHtml.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/rel=["']?icon/i.test(tag))
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${preview.component} preview</title>
    ${links.join('\n    ')}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./launchpad-draft.jsx"></script>
  </body>
</html>
`

  const files: ProjectFile[] = [
    ...proposal.files,
    { path: 'launchpad-draft.jsx', content: page },
    { path: 'index.html', content: html },
  ]
  if (usesTailwind) {
    // Tailwind may not scan this hidden folder, so build the draft's classes here.
    files.push({
      path: 'launchpad-draft.css',
      content: `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@source "./";
`,
    })
  }

  const wc = await getWebContainer()
  await wc.fs.rm(base, { recursive: true, force: true })
  for (const file of files) {
    const path = `${base}/${file.path}`
    await wc.fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    await wc.fs.writeFile(path, file.content)
  }
  return { ok: true, path: `/${base}/index.html` }
}

/** The file whose default export is `name`. */
function findComponentFile(name: string, files: ProjectFile[]): string | null {
  const jsx = files.filter((file) => /^src\/.+\.jsx$/.test(file.path))
  const byName = jsx.find((file) => file.path.split('/').pop() === `${name}.jsx`)
  if (byName) return byName.path
  const exportsIt = new RegExp(`export\\s+default\\s+(?:function\\s+)?${name}\\b`)
  return jsx.find((file) => exportsIt.test(file.content))?.path ?? null
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '')
}

function resolve(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
