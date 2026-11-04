// npm / Vite output, folded away under the preview. It stays mounted while
// closed so no output is lost.

import type { Terminal } from '@xterm/xterm'
import type { ReactNode, RefObject } from 'react'
import { TerminalPanel } from './TerminalPanel'

interface TerminalDrawerProps {
  terminalRef: RefObject<Terminal | null>
  open: boolean
  onToggle(): void
  /** Shown on the right of the header, e.g. the last sync. */
  badge: ReactNode
}

export function TerminalDrawer({ terminalRef, open, onToggle, badge }: TerminalDrawerProps) {
  return (
    <section className={open ? 'terminal-pane open' : 'terminal-pane'}>
      <div className="terminal-header">
        <button type="button" className="terminal-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? '▾' : '▸'} Terminal
        </button>
        {badge}
      </div>
      <div className="terminal-body" aria-hidden={!open}>
        <TerminalPanel terminalRef={terminalRef} />
      </div>
    </section>
  )
}
