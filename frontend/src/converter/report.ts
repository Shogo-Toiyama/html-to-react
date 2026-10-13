import type { Note } from './notes'

// Builds CONVERSION.md: a participant-facing explanation of what moved where
// and why each change was needed.

export interface FileMove {
  from: string
  to: string
}

interface ReportInput {
  entry: string
  moves: FileMove[]
  notes: Note[]
  hasScripts: boolean
}

export function buildReport({ entry, moves, notes, hasScripts }: ReportInput): string {
  const changes = notes.filter((note) => note.kind === 'change')
  const checks = notes.filter((note) => note.kind === 'check')

  const lines: string[] = [
    '# How your site was converted to React',
    '',
    `This project was made from \`${entry}\`. It should look and work the same as your original site. ` +
      'Your original folder was not changed.',
    '',
    '## Where things went',
    '',
    '| Before | Now |',
    '|---|---|',
    ...moves.map((move) => `| ${move.from} | ${move.to} |`),
    '',
  ]

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
    lines.push(
      'Your JavaScript is in `src/legacy-script.js` and still changes the page directly ' +
        '(`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, ' +
        'which is fine for now. As you learn React, you’ll move this code into components using state and ' +
        'event handlers, one piece at a time. When `legacy-script.js` is empty, delete it and its import in ' +
        '`App.jsx`.',
      '',
    )
  }
  lines.push(
    'Try splitting `src/App.jsx` into smaller components, for example a `Header` and a `Footer`.',
    '',
  )
  return lines.join('\n')
}
