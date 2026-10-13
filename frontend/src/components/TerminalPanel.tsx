import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, type RefObject } from 'react'

interface TerminalPanelProps {
  terminalRef: RefObject<Terminal | null>
}

/** Read-only terminal that shows npm / Vite output from the WebContainer. */
export function TerminalPanel({ terminalRef }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#16171d', foreground: '#d4d4d8' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current!)
    fit.fit()
    terminalRef.current = terminal

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(containerRef.current!)
    return () => {
      observer.disconnect()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [terminalRef])

  return <div className="terminal-host" ref={containerRef} />
}
