import type { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import { TerminalPanel } from './components/TerminalPanel'
import { convertSite, findHtmlPages } from './converter'
import { DevSession, type SessionPhase } from './lib/devSession'
import { previewTabUrl } from './lib/previewTab'
import {
  containsFolder,
  createNewFolder,
  ensureReadWritePermission,
  fileExists,
  isFolderEmpty,
  readBytes,
  recallFolder,
  rememberFolder,
  scanFolder,
  writeLocalFiles,
} from './lib/localFolder'
import { STARTER_FILES } from './lib/starterProject'

type Prompt =
  | { kind: 'empty-folder'; handle: FileSystemDirectoryHandle }
  | { kind: 'html-site'; handle: FileSystemDirectoryHandle; pages: string[] }
  | { kind: 'not-a-project'; handle: FileSystemDirectoryHandle }

/** Where the converted project goes: a new folder next to the site, or a folder the participant picks. */
type ConvertTarget = 'new-folder' | 'choose-folder'

const PHASE_LABELS: Record<SessionPhase, string> = {
  creating: 'Creating project files…',
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
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    void recallFolder().then(setRememberedFolder)
    return () => sessionRef.current?.stop()
  }, [])

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  function startSession(handle: FileSystemDirectoryHandle, { keepTerminal = false } = {}) {
    sessionRef.current?.stop()
    if (!keepTerminal) terminalRef.current?.clear()
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
      const names: string[] = []
      for await (const [name, entry] of handle.entries()) if (entry.kind === 'file') names.push(name)
      const pages = findHtmlPages(names)
      setPrompt(pages.length > 0 ? { kind: 'html-site', handle, pages } : { kind: 'not-a-project', handle })
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

  /** Switches to the session view right away and logs to the terminal while files are written. */
  function beginCreating(target: FileSystemDirectoryHandle, message: string) {
    sessionRef.current?.stop()
    terminalRef.current?.clear()
    setPrompt(null)
    setNotice(null)
    setPreviewUrl(null)
    setLastSync(null)
    setFolderName(target.name)
    setPhase('creating')
    const log = (text: string) => terminalRef.current?.write(text.replaceAll('\n', '\r\n'))
    log(`\x1b[36m● ${message}\x1b[0m\n`)
    return log
  }

  async function createStarter(handle: FileSystemDirectoryHandle) {
    const log = beginCreating(handle, `Creating a starter React project in "${handle.name}"…`)
    try {
      // The folder may hold hidden files (e.g. .gitignore); never overwrite them.
      await writeLocalFiles(handle, Object.entries(STARTER_FILES), {
        skipExisting: true,
        onWritten: (path) => log(`  + ${path}\n`),
      })
    } catch (error) {
      log(`\x1b[31m✖ Could not create files: ${errorMessage(error)}\x1b[0m\n`)
      setPhase('error')
      return
    }
    startSession(handle, { keepTerminal: true })
  }

  /** Opens a folder picker; returns null (after showing any error) if the user cancels. */
  async function pickDirectory(options: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await window.showDirectoryPicker!(options)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice(errorMessage(error))
      return null
    }
  }

  /** The participant chooses (or creates) an empty folder for the React version. */
  async function convertIntoChosenFolder(source: FileSystemDirectoryHandle) {
    const target = await pickDirectory({ id: 'react-output', mode: 'readwrite' })
    if (!target) return
    if (await target.isSameEntry(source)) {
      setNotice('That’s your original site folder. Please create or choose a different, empty folder.')
      return
    }
    if (!(await isFolderEmpty(target))) {
      setNotice(`“${target.name}” isn’t empty. Please create or choose an empty folder for the React version.`)
      return
    }
    await convertToReact(source, target)
  }

  /**
   * Creates "<site> - React" next to the site folder. The browser can't reach a
   * folder's parent on its own, so the participant selects that parent once.
   */
  async function convertIntoNewFolder(source: FileSystemDirectoryHandle) {
    const parent = await pickDirectory({ id: 'react-output-parent', mode: 'readwrite', startIn: source })
    if (!parent) return
    if (await parent.isSameEntry(source)) {
      setNotice(`That’s “${source.name}” itself. In the dialog, go up one folder and select the folder that contains it.`)
      return
    }
    if (!(await containsFolder(parent, source))) {
      setNotice(`“${source.name}” isn’t inside “${parent.name}”. Please select the folder that contains “${source.name}”.`)
      return
    }
    let target: FileSystemDirectoryHandle
    try {
      target = await createNewFolder(parent, `${source.name} - React`)
    } catch (error) {
      setNotice(`Could not create a folder in “${parent.name}”: ${errorMessage(error)}`)
      return
    }
    await convertToReact(source, target)
  }

  async function convertToReact(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle) {
    const log = beginCreating(target, `Converting "${source.name}" to React in "${target.name}"…`)
    try {
      const snapshot = await scanFolder(source)
      const files = new Map<string, Uint8Array>()
      for (const [path, file] of snapshot) files.set(path, await readBytes(file))
      const result = convertSite({ files, siteName: source.name })
      await writeLocalFiles(target, result.files, { onWritten: (path) => log(`  + ${path}\n`) })

      const checks = result.notes.filter((note) => note.kind === 'check').length
      if (result.pages.length > 1) {
        log(`\x1b[36m● ${result.pages.length} pages, each now a component in src/pages/:\x1b[0m\n`)
        for (const page of result.pages) log(`    ${page.file} → ${page.route} (${page.component})\n`)
      }
      log(`\x1b[32m✔ Converted. Open CONVERSION.md to see what changed and why.\x1b[0m\n`)
      if (checks > 0) log(`\x1b[33m! ${checks} thing(s) to check — see “Please check” in CONVERSION.md.\x1b[0m\n`)
    } catch (error) {
      log(`\x1b[31m✖ Conversion failed: ${errorMessage(error)}\x1b[0m\n`)
      setPhase('error')
      return
    }
    await rememberFolder(target)
    setRememberedFolder(target)
    startSession(target, { keepTerminal: true })
  }

  const showWelcome = phase === null || phase === 'stopped'
  const isExpanded = expanded && previewUrl !== null && !showWelcome

  return (
    <div className={isExpanded ? 'app expanded' : 'app'}>
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
              onConvert={(handle, where) =>
                void (where === 'new-folder' ? convertIntoNewFolder(handle) : convertIntoChosenFolder(handle))
              }
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
                  <>
                    <button type="button" className="button" onClick={() => setExpanded(true)}>
                      Full view ⤢
                    </button>
                    <a
                      className="button"
                      href={previewTabUrl(previewUrl)}
                      target="_blank"
                      rel="noreferrer"
                      title="Keep this tab open: your project runs here."
                    >
                      Open in new tab ↗
                    </a>
                  </>
                )}
              </div>
              {isExpanded && (
                <button type="button" className="button exit-full-view" onClick={() => setExpanded(false)}>
                  Exit full view (Esc)
                </button>
              )}
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
  onConvert: (handle: FileSystemDirectoryHandle, where: ConvertTarget) => void
  onDismissPrompt: () => void
}

function Welcome(props: WelcomeProps) {
  const { prompt, notice, rememberedFolder, onPick, onReopen, onCreateStarter, onConvert, onDismissPrompt } = props
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

  if (prompt?.kind === 'html-site') {
    return <ConvertPrompt prompt={prompt} notice={notice} onConvert={onConvert} onCancel={onDismissPrompt} />
  }

  if (prompt?.kind === 'not-a-project') {
    return (
      <div className="welcome">
        <h1>Nothing to run in “{prompt.handle.name}”</h1>
        <p>
          This folder has no <code>package.json</code> (React project) and no <code>.html</code> page at its top level.
          Choose an empty folder, an existing React project, or the folder that contains your site’s{' '}
          <code>index.html</code>.
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
          Choose a folder: your <strong>HTML website</strong> to convert it, an <strong>empty folder</strong> to start
          a new project, or an existing React project.
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

interface ConvertPromptProps {
  prompt: Extract<Prompt, { kind: 'html-site' }>
  notice: string | null
  onConvert: (handle: FileSystemDirectoryHandle, where: ConvertTarget) => void
  onCancel: () => void
}

function ConvertPrompt({ prompt, notice, onConvert, onCancel }: ConvertPromptProps) {
  const name = prompt.handle.name
  return (
    <div className="welcome">
      <h1>“{name}” is an HTML website</h1>
      <p>
        Convert it to a React project? Your original files stay exactly as they are. The React version goes into a new
        folder.
      </p>
      {prompt.pages.length > 1 && (
        <p className="hint">
          Found {prompt.pages.length} pages ({prompt.pages.join(', ')}). Each one becomes a component, and React Router
          switches between them.
        </p>
      )}
      <ol className="steps">
        <li>
          Click <strong>Create “{name} - React”</strong>.
        </li>
        <li>
          The dialog opens inside “{name}”. Go <strong>up one folder</strong> and click <strong>Open</strong> (or{' '}
          <strong>Select</strong>). The new folder is created next to “{name}”.
        </li>
      </ol>
      {notice && <p className="notice">{notice}</p>}
      <div className="actions">
        <button type="button" className="button primary" onClick={() => onConvert(prompt.handle, 'new-folder')}>
          Create “{name} - React”
        </button>
        <button type="button" className="button" onClick={() => onConvert(prompt.handle, 'choose-folder')}>
          Choose another empty folder
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
