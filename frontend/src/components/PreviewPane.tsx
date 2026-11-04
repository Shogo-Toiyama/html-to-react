// The running site: a browser-like toolbar and the preview iframe.
//
// The address bar shows "📁 <folder> /path" instead of the real WebContainer
// URL, which only works inside this tab. The path comes from the bridge script
// in the preview (see lib/previewBridge.ts), and typing a path navigates there.
// Render it with `key={previewUrl}` so a new dev server starts from a clean state.

import { useEffect, useRef, useState } from 'react'
import { isPreviewMessage, type HostCommand, type HostMessage } from '../lib/previewBridge'
import { previewTabUrl } from '../lib/previewTab'

interface PreviewPaneProps {
  previewUrl: string | null
  folderName: string | null
  /** Shown while there's no preview yet (e.g. "Installing packages…"). */
  statusLabel: string
  status: 'loading' | 'error'
  hint: string | null
  onFullView(): void
  /** Esc pressed while the preview has focus. */
  onEscape(): void
}

export function PreviewPane(props: PreviewPaneProps) {
  const { previewUrl, folderName, statusLabel, status, hint, onFullView, onEscape } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [path, setPath] = useState('/')
  const [draft, setDraft] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  })

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !isPreviewMessage(event.data)) return
      setConnected(true)
      if (event.data.type === 'location') setPath(event.data.path)
      else if (event.data.type === 'escape') onEscapeRef.current()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const send = (command: HostCommand) => {
    if (!previewUrl) return
    const message: HostMessage = { source: 'launchpad-host', ...command }
    frameRef.current?.contentWindow?.postMessage(message, new URL(previewUrl).origin)
  }

  const reload = () => {
    // Without the bridge (e.g. a project that doesn't use Vite), reloading the iframe is all we can do.
    if (connected) {
      send({ type: 'reload' })
    } else {
      setPath('/')
      setFrameKey((key) => key + 1)
    }
  }

  const navigate = (input: string) => {
    const target = input.trim() === '' ? '/' : input.trim().startsWith('/') ? input.trim() : '/' + input.trim()
    send({ type: 'navigate', path: target })
    setDraft(null)
  }

  const fullUrl = previewUrl ? new URL(path, previewUrl).href : null

  return (
    <section className="preview-pane">
      <div className="preview-toolbar">
        <button type="button" className="icon-button" title="Back" disabled={!connected} onClick={() => send({ type: 'back' })}>
          ←
        </button>
        <button
          type="button"
          className="icon-button"
          title="Forward"
          disabled={!connected}
          onClick={() => send({ type: 'forward' })}
        >
          →
        </button>
        <button type="button" className="icon-button" title="Reload" disabled={!previewUrl} onClick={reload}>
          ↻
        </button>
        <form
          className="address-bar"
          title={fullUrl ? `Running in this tab at ${fullUrl}` : undefined}
          onSubmit={(event) => {
            event.preventDefault()
            navigate(draft ?? path)
          }}
        >
          {folderName && <span className="address-folder">📁 {folderName}</span>}
          {previewUrl ? (
            <input
              className="address-path"
              aria-label="Page path"
              spellCheck={false}
              disabled={!connected}
              value={draft ?? path}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => setDraft(null)}
            />
          ) : (
            <span className="address-status">{statusLabel}</span>
          )}
        </form>
        {previewUrl && fullUrl && (
          <>
            <button type="button" className="button" onClick={onFullView}>
              Full view ⤢
            </button>
            <a
              className="button"
              href={previewTabUrl(fullUrl)}
              target="_blank"
              rel="noreferrer"
              title="Keep this tab open: your project runs here."
            >
              Open in new tab ↗
            </a>
          </>
        )}
      </div>
      {previewUrl ? (
        <iframe
          key={frameKey}
          ref={frameRef}
          className="preview-frame"
          src={previewUrl}
          title="Preview"
        />
      ) : (
        <div className="preview-placeholder">
          {status === 'error' ? (
            <p>Something went wrong. Open the terminal below to see the error.</p>
          ) : (
            <>
              <div className="spinner" aria-hidden="true" />
              <p>{statusLabel}</p>
              {hint && <p className="hint">{hint}</p>}
            </>
          )}
        </div>
      )}
    </section>
  )
}
