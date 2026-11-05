// The running site: a browser-like toolbar and the preview iframe.
//
// The address bar shows "📁 <folder> /path" instead of the real WebContainer
// URL, which only works inside this tab. The path comes from the bridge script
// in the preview (see lib/previewBridge.ts), and typing a path navigates there.
// Render it with `key={previewUrl}` so a new dev server starts from a clean state.

import { useEffect, useRef, useState } from 'react'
import type { ChatError } from '../lib/chatInbox'
import { onHighlightRequest, onPickRequest, reportPicked, setPreviewBase, setPreviewPath } from '../lib/highlight'
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
  /** "Ask AI to fix" on an error shown in the preview. */
  onAskAiToFix?(error: ChatError): void
}

type PageError = { kind: 'build' | 'runtime'; message: string }

export function PreviewPane(props: PreviewPaneProps) {
  const { previewUrl, folderName, statusLabel, status, hint, onFullView, onEscape, onAskAiToFix } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [path, setPath] = useState('/')
  const [draft, setDraft] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [inspect, setInspect] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pageError, setPageError] = useState<PageError | null>(null)
  const onEscapeRef = useRef(onEscape)
  const inspectRef = useRef(inspect)
  const pickingRef = useRef(picking)
  useEffect(() => {
    onEscapeRef.current = onEscape
    inspectRef.current = inspect
    pickingRef.current = picking
  })

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !isPreviewMessage(event.data)) return
      setConnected(true)
      if (event.data.type === 'location') {
        setPath(event.data.path)
        setPreviewPath(event.data.path)
        // A new page (or a reload) starts without the old page's runtime error.
        setPageError((current) => (current?.kind === 'runtime' ? null : current))
        // A reloaded page starts with the inspector and picking off; turn them back on.
        const source = event.source as Window
        if (inspectRef.current) {
          const message: HostMessage = { source: 'launchpad-host', type: 'inspect', enabled: true }
          source.postMessage(message, event.origin)
        }
        if (pickingRef.current) {
          const message: HostMessage = { source: 'launchpad-host', type: 'pick', enabled: true }
          source.postMessage(message, event.origin)
        }
      } else if (event.data.type === 'escape') {
        onEscapeRef.current()
      } else if (event.data.type === 'picked') {
        setPicking(false)
        reportPicked(event.data.component ? { name: event.data.component, label: event.data.label ?? '' } : null)
      } else if (event.data.type === 'error') {
        const { kind, message } = event.data
        if (message) setPageError({ kind, message })
        else setPageError((current) => (current?.kind === kind ? null : current))
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      setPreviewPath(null)
      if (pickingRef.current) reportPicked(null)
    }
  }, [])

  useEffect(() => {
    setPreviewBase(previewUrl)
    return () => setPreviewBase(null)
  }, [previewUrl])

  // The chat asks to pick a component in the preview (lib/highlight.ts).
  useEffect(() => {
    return onPickRequest((enabled) => {
      if (enabled && !previewUrl) return reportPicked(null)
      setPicking(enabled)
      if (!previewUrl) return
      const message: HostMessage = { source: 'launchpad-host', type: 'pick', enabled }
      frameRef.current?.contentWindow?.postMessage(message, new URL(previewUrl).origin)
    })
  }, [previewUrl])

  const send = (command: HostCommand) => {
    if (!previewUrl) return
    const message: HostMessage = { source: 'launchpad-host', ...command }
    frameRef.current?.contentWindow?.postMessage(message, new URL(previewUrl).origin)
  }

  useEffect(() => {
    if (!connected || !previewUrl) return
    const message: HostMessage = { source: 'launchpad-host', type: 'inspect', enabled: inspect }
    frameRef.current?.contentWindow?.postMessage(message, new URL(previewUrl).origin)
  }, [inspect, connected, previewUrl])

  // The side panel asks to blink a component (lib/highlight.ts).
  useEffect(() => {
    if (!previewUrl) return
    return onHighlightRequest((component) => {
      const message: HostMessage = { source: 'launchpad-host', type: 'highlight', component }
      frameRef.current?.contentWindow?.postMessage(message, new URL(previewUrl).origin)
    })
  }, [previewUrl])

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
            <button
              type="button"
              className={inspect ? 'button pressed' : 'button'}
              aria-pressed={inspect}
              disabled={!connected}
              title="Hover over the page to see which component draws each part"
              onClick={() => setInspect((on) => !on)}
            >
              🧩 Components
            </button>
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
      {picking && (
        <div className="preview-banner pick">
          🎯 Click a part of the page to ask AI about it.
          <button
            type="button"
            className="link-button"
            onClick={() => {
              send({ type: 'pick', enabled: false })
              setPicking(false)
              reportPicked(null)
            }}
          >
            Cancel
          </button>
        </div>
      )}
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
      {previewUrl && pageError && (
        <div className="preview-error" role="alert">
          <span className="preview-error-text">
            ⚠️ {pageError.kind === 'build' ? 'Your code has an error' : 'The page hit an error'}:{' '}
            <code>{pageError.message.split('\n')[0]}</code>
          </span>
          {onAskAiToFix && (
            <button
              type="button"
              className="button primary"
              onClick={() => onAskAiToFix({ ...pageError, page: path })}
            >
              Ask AI to fix
            </button>
          )}
          <button type="button" className="icon-button" title="Hide" onClick={() => setPageError(null)}>
            ×
          </button>
        </div>
      )}
    </section>
  )
}
