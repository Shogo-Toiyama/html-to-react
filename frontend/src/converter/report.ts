import type { Note } from './notes'
import type { SitePage } from './pages'

// Builds CONVERSION.md: a participant-facing explanation of what moved where
// and why each change was needed.

export interface FileMove {
  from: string
  to: string
}

interface ReportInput {
  /** Multi-page sites only. */
  pages: SitePage[] | null
  entry: string
  moves: FileMove[]
  notes: Note[]
  hasScripts: boolean
}

export function buildReport({ pages, entry, moves, notes, hasScripts }: ReportInput): string {
  const changes = notes.filter((note) => note.kind === 'change')
  const checks = notes.filter((note) => note.kind === 'check')
  const madeFrom = pages
    ? `your ${pages.length} pages (${pages.map((page) => `\`${page.file}\``).join(', ')})`
    : `\`${entry}\``

  const lines: string[] = [
    '# How your site was converted to React',
    '',
    `This project was made from ${madeFrom}. It should look and work the same as your original site. ` +
      'Your original folder was not changed.',
    '',
  ]

  if (pages) {
    lines.push(
      '## Your pages',
      '',
      'Each page is now a component. React Router (in `src/App.jsx`) shows the component whose path matches the URL.',
      '',
      '| Page | URL | Component |',
      '|---|---|---|',
      ...pages.map((page) => `| \`${page.file}\` | \`${page.route}\` | \`src/pages/${page.component}.jsx\` |`),
      '',
    )
  }

  lines.push(
    '## Where things went',
    '',
    '| Before | Now |',
    '|---|---|',
    ...moves.map((move) => `| ${move.from} | ${move.to} |`),
    '',
  )

  if (changes.length > 0) {
    lines.push('## What changed, and why', '')
    for (const note of changes) {
      lines.push(`### ${note.title}${note.count > 1 ? ` (${note.count}×)` : ''}`, '', note.detail, '')
      if (note.examples.length > 0) {
        lines.push(...note.examples.map((example) => `- \`${example.replaceAll('`', "'")}\``), '')
      }
    }
  }

  if (checks.length > 0) {
    lines.push('## Please check', '')
    for (const note of checks) {
      lines.push(`- **${note.title}.** ${note.detail}`)
      for (const example of note.examples) lines.push(`  - \`${example.replaceAll('`', "'")}\``)
    }
    lines.push('')
  }

  lines.push('## What’s next', '')
  if (hasScripts) {
    const where = pages
      ? 'the `*.legacy-script.js` file next to each page component'
      : '`src/legacy-script.js`'
    const importer = pages ? 'the page component' : '`App.jsx`'
    lines.push(
      `Your JavaScript is in ${where} and still changes the page directly ` +
        '(`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, ' +
        'which is fine for now. As you learn React, you’ll move this code into components using state and ' +
        'event handlers, one piece at a time. When a legacy script is empty, delete it and its import in ' +
        `${importer}.`,
      '',
    )
  }
  lines.push(
    pages
      ? 'Parts that appear on several pages, like a header or footer, make great components: write one ' +
          '`Header` component and use `<Header />` on every page.'
      : 'Try splitting `src/App.jsx` into smaller components, for example a `Header` and a `Footer`.',
    '',
  )
  if (pages) {
    lines.push(
      '**Publishing your site:** every URL (like `/about`) must be answered with `index.html`, so React Router ' +
        'can show the right page. Most hosts call this a “single-page app” or “rewrite all routes to index.html” ' +
        'setting. Without it, opening `/about` directly shows a “404 Not Found” page.',
      '',
    )
  }
  return lines.join('\n')
}
