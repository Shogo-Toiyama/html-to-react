import type { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import { TerminalPanel } from './components/TerminalPanel'
import { DevSession, type SessionPhase } from './lib/devSession'
import {
  ensureReadWritePermission,
  fileExists,
  isFolderEmpty,
  recallFolder,
  rememberFolder,
  writeLocalFile,
} from './lib/localFolder'
import { STARTER_FILES } from './lib/starterProject'

type Prompt =
  | { kind: 'empty-folder'; handle: FileSystemDirectoryHandle }
  | { kind: 'not-a-project'; handle: FileSystemDirectoryHandle }

const PHASE_LABELS: Record<SessionPhase, string> = {
  booting: 'Starting Node.js…',
  mounting: 'Loading files…',
  installing: 'Installing packages…',
  starting: 'Starting dev server…',
  running: 'Running',
  error: 'Error',
  stopped: 'Stopped',
}

interface SyncInfo {
  paths: string[]
  at: number
}

const browserSupported = typeof window.showDirectoryPicker === 'function'

function App() {
  const terminalRef = useRef<Terminal | null>(null)
  const sessionRef = useRef<DevSession | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [phase, setPhase] = useState<SessionPhase | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [rememberedFolder, setRememberedFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [lastSync, setLastSync] = useState<SyncInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void recallFolder().then(setRememberedFolder)
    return () => sessionRef.current?.stop()
  }, [])

  function startSession(handle: FileSystemDirectoryHandle) {
    sessionRef.current?.stop()
    terminalRef.current?.clear()
    setPrompt(null)
    setNotice(null)
    setPreviewUrl(null)
    setLastSync(null)
    setFolderName(handle.name)

    const session = new DevSession(
      handle,
      {
        onPhase: (next) => setPhase(next),
        onOutput: (chunk) => terminalRef.current?.write(chunk),
        onServerReady: (url) => setPreviewUrl(url),
        onSynced: (changed, removed) => setLastSync({ paths: [...changed, ...removed], at: Date.now() }),
      },
      () => ({ cols: terminalRef.current?.cols ?? 80, rows: terminalRef.current?.rows ?? 24 }),
    )
    sessionRef.current = session
    void session.start()
  }

  async function openFolder(handle: FileSystemDirectoryHandle) {
    if (!(await ensureReadWritePermission(handle))) {
      setNotice('Edit permission is needed to run and update your project. Please allow it and try again.')
      return
    }
    await rememberFolder(handle)
    setRememberedFolder(handle)

    if (await fileExists(handle, 'package.json')) {
      startSession(handle)
    } else if (await isFolderEmpty(handle)) {
      setPrompt({ kind: 'empty-folder', handle })
    } else {
      setPrompt({ kind: 'not-a-project', handle })
    }
  }

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker!({ id: 'workshop-project', mode: 'readwrite' })
      await openFolder(handle)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function createStarter(handle: FileSystemDirectoryHandle) {
    for (const [path, contents] of Object.entries(STARTER_FILES)) {
      await writeLocalFile(handle, path, contents)
    }
    startSession(handle)
  }

  const showWelcome = phase === null || phase === 'stopped'

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">React Launchpad</span>
        {folderName && !showWelcome && <span className="folder-chip">📁 {folderName}</span>}
        {phase && !showWelcome && <span className={`status status-${phase}`}>{PHASE_LABELS[phase]}</span>}
        <span className="spacer" />
        {browserSupported && !showWelcome && (
          <button type="button" className="button" onClick={pickFolder}>
            Open another folder
          </button>
        )}
      </header>

      <main className="workspace">
        <section className="preview-pane">
          {showWelcome ? (
            <Welcome
              prompt={prompt}
              notice={notice}
              rememberedFolder={rememberedFolder}
              onPick={pickFolder}
              onReopen={(handle) => void openFolder(handle)}
              onCreateStarter={(handle) => void createStarter(handle)}
              onDismissPrompt={() => setPrompt(null)}
            />
          ) : (
            <>
              <div className="preview-toolbar">
                <button
                  type="button"
                  className="icon-button"
                  title="Reload preview"
                  disabled={!previewUrl}
                  onClick={() => setPreviewKey((key) => key + 1)}
                >
                  ↻
                </button>
                <span className="preview-url">{previewUrl ?? PHASE_LABELS[phase]}</span>
                {previewUrl && (
                  <a className="button" href={previewUrl} target="_blank" rel="noreferrer">
                    Open in new tab ↗
                  </a>
                )}
              </div>
              {previewUrl ? (
                <iframe key={previewKey} className="preview-frame" src={previewUrl} title="Preview" />
              ) : (
                <div className="preview-placeholder">
                  {phase === 'error' ? (
                    <p>Something went wrong — see the terminal below.</p>
                  ) : (
                    <>
                      <div className="spinner" aria-hidden="true" />
                      <p>{PHASE_LABELS[phase]}</p>
                      {phase === 'installing' && <p className="hint">The first install takes about 10–30 seconds.</p>}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="terminal-pane">
          <div className="terminal-header">
            <span>Terminal</span>
            {lastSync && <SyncBadge sync={lastSync} />}
          </div>
          <TerminalPanel terminalRef={terminalRef} />
        </section>
      </main>
    </div>
  )
}

interface WelcomeProps {
  prompt: Prompt | null
  notice: string | null
  rememberedFolder: FileSystemDirectoryHandle | null
  onPick: () => void
  onReopen: (handle: FileSystemDirectoryHandle) => void
  onCreateStarter: (handle: FileSystemDirectoryHandle) => void
  onDismissPrompt: () => void
}

function Welcome({ prompt, notice, rememberedFolder, onPick, onReopen, onCreateStarter, onDismissPrompt }: WelcomeProps) {
  if (!browserSupported) {
    return (
      <div className="welcome">
        <h1>Please open this page in Chrome or Edge</h1>
        <p>This app needs access to a folder on your computer, which only Chrome and Edge support right now.</p>
      </div>
    )
  }

  if (!window.crossOriginIsolated) {
    return (
      <div className="welcome">
        <h1>This page can’t run Node.js</h1>
        <p>
          The server must send <code>Cross-Origin-Opener-Policy</code> and <code>Cross-Origin-Embedder-Policy</code>{' '}
          headers. Please tell the workshop organizers.
        </p>
      </div>
    )
  }

  if (prompt?.kind === 'empty-folder') {
    return (
      <div className="welcome">
        <h1>“{prompt.handle.name}” is empty</h1>
        <p>Create a starter React project in this folder? You’ll be able to edit every file in VS Code.</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => onCreateStarter(prompt.handle)}>
            Create React project
          </button>
          <button type="button" className="button" onClick={onDismissPrompt}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (prompt?.kind === 'not-a-project') {
    return (
      <div className="welcome">
        <h1>“{prompt.handle.name}” isn’t a React project</h1>
        <p>
          It has files but no <code>package.json</code>. Converting an HTML/CSS/JS site is coming soon — for now, choose
          an empty folder or an existing React project.
        </p>
        <div className="actions">
          <button type="button" className="button primary" onClick={onPick}>
            Choose another folder
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="welcome">
      <h1>Run React right in your browser</h1>
      <p>No installs needed. Your files stay on your computer.</p>
      <ol className="steps">
        <li>
          Choose a folder: an <strong>empty folder</strong> to start a new project, or an existing React project.
        </li>
        <li>
          Edit the files in <strong>VS Code</strong> and save.
        </li>
        <li>Your site updates here automatically.</li>
      </ol>
      {notice && <p className="notice">{notice}</p>}
      <div className="actions">
        <button type="button" className="button primary" onClick={onPick}>
          Open folder
        </button>
        {rememberedFolder && (
          <button type="button" className="button" onClick={() => onReopen(rememberedFolder)}>
            Reopen “{rememberedFolder.name}”
          </button>
        )}
      </div>
    </div>
  )
}

function SyncBadge({ sync }: { sync: SyncInfo }) {
  const names = sync.paths.map((path) => path.split('/').pop()).join(', ')
  const time = new Date(sync.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <span className="sync-badge" key={sync.at} title={sync.paths.join('\n')}>
      Synced {names} · {time}
    </span>
  )
}

export default App
