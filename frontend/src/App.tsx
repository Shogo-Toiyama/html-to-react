import type { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { GuidePanel } from './components/GuidePanel'
import { PreviewPane } from './components/PreviewPane'
import { sendErrorToChat } from './lib/chatInbox'
import { ResizeHandle } from './components/ResizeHandle'
import { TerminalDrawer } from './components/TerminalDrawer'
import { browserSupported, Welcome, type ConvertTarget, type Prompt } from './components/Welcome'
import { convertSite, findHtmlPages, type ConversionResult } from './converter'
import type { ConversionSummary, StepContext } from './curriculum/StepContent'
import { DEFAULT_POSITION, findWorkshop } from './curriculum/workshops'
import { DevSession, type SessionPhase } from './lib/devSession'
import { useGuideWidth } from './lib/guideWidth'
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
import { loadLocalProgress, readProgress, saveLocalProgress, stepKey, writeProgress, type Progress } from './lib/progress'
import { loadSampleSite, SAMPLE_SITE_NAME } from './lib/sampleSite'
import { STARTER_FILES } from './lib/starterProject'

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

interface Project {
  dir: FileSystemDirectoryHandle
  mainFile: string | null
}

/** A saved position is only used if that workshop and step still exist. */
function validProgress(progress: Progress | null): Progress | null {
  if (!progress) return null
  const workshop = findWorkshop(progress.workshop)
  return workshop?.steps.some((step) => step.id === progress.step) ? progress : null
}

const INITIAL_PROGRESS: Progress = validProgress(loadLocalProgress()) ?? { ...DEFAULT_POSITION, completed: [] }

function App() {
  const terminalRef = useRef<Terminal | null>(null)
  const sessionRef = useRef<DevSession | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [phase, setPhase] = useState<SessionPhase | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [rememberedFolder, setRememberedFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [lastSync, setLastSync] = useState<SyncInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS)
  const [conversion, setConversion] = useState<ConversionSummary | null>(null)
  const [guideWidth, setGuideWidth] = useGuideWidth()
  const [resizing, setResizing] = useState(false)
  /** Folder name shown while files are being created (before the project runs). */
  const [creatingIn, setCreatingIn] = useState<string | null>(null)

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

  // ---- Workshop progress ----

  // Latest progress for async code (a folder may finish loading after the participant moved on).
  const progressRef = useRef(progress)

  function updateProgress(next: Progress, dir = project?.dir) {
    progressRef.current = next
    setProgress(next)
    saveLocalProgress(next)
    if (dir) void writeProgress(dir, next).catch(() => {})
  }

  /** A project's saved position wins; a project without one gets the current position. */
  async function syncProgressWith(dir: FileSystemDirectoryHandle) {
    const saved = validProgress(await readProgress(dir).catch(() => null))
    if (saved) {
      progressRef.current = saved
      setProgress(saved)
      saveLocalProgress(saved)
    } else {
      void writeProgress(dir, progressRef.current).catch(() => {})
    }
  }

  function selectStep(workshop: string, step: string) {
    updateProgress({ ...progress, workshop, step })
  }

  function finishStep() {
    const workshop = findWorkshop(progress.workshop)
    if (!workshop) return
    const key = stepKey(workshop.id, progress.step)
    const completed = progress.completed.includes(key) ? progress.completed : [...progress.completed, key]
    const index = workshop.steps.findIndex((step) => step.id === progress.step)
    const next = workshop.steps[index + 1]
    updateProgress({ workshop: workshop.id, step: next?.id ?? progress.step, completed })
  }

  // ---- Running a project ----

  function resetView() {
    sessionRef.current?.stop()
    setPrompt(null)
    setNotice(null)
    setPreviewUrl(null)
    setLastSync(null)
    setExpanded(false)
  }

  function startSession(dir: FileSystemDirectoryHandle, { keepTerminal = false } = {}) {
    resetView()
    if (!keepTerminal) terminalRef.current?.clear()
    setCreatingIn(null)
    setProject({ dir, mainFile: null })
    void findMainFile(dir).then((mainFile) => setProject((p) => (p?.dir === dir ? { dir, mainFile } : p)))
    void syncProgressWith(dir)

    const session = new DevSession(
      dir,
      {
        onPhase: (next) => {
          setPhase(next)
          // Show the install log while the project is being set up; fold it away once it runs.
          if (next === 'running') setTerminalOpen(false)
          else if (next !== 'stopped') setTerminalOpen(true)
        },
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
    try {
      await openFolderUnsafe(handle)
    } catch (error) {
      // e.g. the folder was moved or deleted since it was picked or remembered.
      const missing = error instanceof DOMException && error.name === 'NotFoundError'
      setNotice(
        missing
          ? `Could not find “${handle.name}”. It may have been moved or deleted — please choose the folder again.`
          : `Could not open “${handle.name}”: ${errorMessage(error)}`,
      )
    }
  }

  async function openFolderUnsafe(handle: FileSystemDirectoryHandle) {
    if (!(await ensureReadWritePermission(handle))) {
      setNotice('Edit permission is needed to run and update your project. Please allow it and try again.')
      return
    }
    await rememberFolder(handle)
    setRememberedFolder(handle)
    setConversion(null)

    if (await fileExists(handle, 'package.json')) {
      startSession(handle)
    } else if (await isFolderEmpty(handle)) {
      showPrompt({ kind: 'empty-folder', handle })
    } else {
      const names: string[] = []
      for await (const [name, entry] of handle.entries()) if (entry.kind === 'file') names.push(name)
      const pages = findHtmlPages(names)
      showPrompt(pages.length > 0 ? { kind: 'html-site', handle, pages } : { kind: 'not-a-project', handle })
    }
  }

  /** Shows a question in the main area (stopping any running project). */
  function showPrompt(next: Prompt) {
    resetView()
    setProject(null)
    setPhase(null)
    setPrompt(next)
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

  async function pickFolder() {
    const handle = await pickDirectory({ id: 'workshop-project', mode: 'readwrite' })
    if (handle) await openFolder(handle)
  }

  /** Switches to the session view right away and logs to the terminal while files are written. */
  function beginCreating(target: FileSystemDirectoryHandle, message: string) {
    resetView()
    terminalRef.current?.clear()
    setProject(null)
    setCreatingIn(target.name)
    setPhase('creating')
    setTerminalOpen(true)
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
      failCreating()
      return
    }
    startSession(handle, { keepTerminal: true })
  }

  function failCreating() {
    setPhase('error')
    setTerminalOpen(true)
  }

  // ---- Converting an HTML site ----

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

  /** Saves the sample website into a folder the participant picks, then converts it next to it. */
  async function saveSampleSite() {
    const parent = await pickDirectory({ id: 'sample-parent', mode: 'readwrite', startIn: 'documents' })
    if (!parent) return
    let site: FileSystemDirectoryHandle
    let target: FileSystemDirectoryHandle
    try {
      site = await createNewFolder(parent, SAMPLE_SITE_NAME)
      await writeLocalFiles(site, await loadSampleSite())
      target = await createNewFolder(parent, `${site.name} - React`)
    } catch (error) {
      setNotice(`Could not save the sample site in “${parent.name}”: ${errorMessage(error)}`)
      return
    }
    await convertToReact(site, target)
  }

  async function convertToReact(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle) {
    const log = beginCreating(target, `Converting "${source.name}" to React in "${target.name}"…`)
    let result: ConversionResult
    try {
      const snapshot = await scanFolder(source)
      const files = new Map<string, Uint8Array>()
      for (const [path, file] of snapshot) files.set(path, await readBytes(file))
      result = convertSite({ files, siteName: source.name })
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
      failCreating()
      return
    }
    await rememberFolder(target)
    setRememberedFolder(target)
    setConversion(summarize(result))
    // A fresh conversion is Step 1, whatever the folder's progress file would say (it has none yet).
    updateProgress({ ...progress, workshop: 'w4', step: 'jsx' }, target)
    startSession(target, { keepTerminal: true })
  }

  // ---- Layout ----

  const showWelcome = phase === null || phase === 'stopped'
  const isExpanded = expanded && previewUrl !== null && !showWelcome
  const folderName = project?.dir.name ?? creatingIn
  const stepContext: StepContext = {
    project: project && !showWelcome ? { dir: project.dir, name: project.dir.name, mainFile: project.mainFile } : null,
    conversion,
  }

  return (
    <div
      className={`app${isExpanded ? ' expanded' : ''}${resizing ? ' resizing' : ''}`}
      style={{ '--guide-width': `${guideWidth}px` } as CSSProperties}
    >
      <header className="topbar">
        <span className="brand">
          <img className="brand-icon" src="/favicon.png" alt="" />
          React Launchpad
        </span>
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
        <div className="main-column">
          {showWelcome ? (
            <section className="preview-pane">
              <Welcome
                prompt={prompt}
                notice={notice}
                rememberedFolder={rememberedFolder}
                onPick={pickFolder}
                onReopen={(handle) => void openFolder(handle)}
                onUseSample={() => showPrompt({ kind: 'sample', siteName: SAMPLE_SITE_NAME })}
                onSaveSample={() => void saveSampleSite()}
                onCreateStarter={(handle) => void createStarter(handle)}
                onConvert={(handle, where: ConvertTarget) =>
                  void (where === 'new-folder' ? convertIntoNewFolder(handle) : convertIntoChosenFolder(handle))
                }
                onDismissPrompt={() => setPrompt(null)}
              />
            </section>
          ) : (
            <PreviewPane
              key={previewUrl ?? 'starting'}
              previewUrl={previewUrl}
              folderName={folderName}
              statusLabel={PHASE_LABELS[phase ?? 'booting']}
              status={phase === 'error' ? 'error' : 'loading'}
              hint={phase === 'installing' ? 'The first install takes about 10–30 seconds.' : null}
              onFullView={() => setExpanded(true)}
              onEscape={() => setExpanded(false)}
              onAskAiToFix={(error) => {
                sendErrorToChat(error)
                setExpanded(false)
                selectStep('w4', 'chat')
              }}
            />
          )}
          {isExpanded && (
            <button type="button" className="button exit-full-view" onClick={() => setExpanded(false)}>
              Exit full view (Esc)
            </button>
          )}
          <TerminalDrawer
            terminalRef={terminalRef}
            open={terminalOpen}
            onToggle={() => setTerminalOpen((open) => !open)}
            badge={lastSync && <SyncBadge sync={lastSync} />}
          />
        </div>

        <ResizeHandle width={guideWidth} onResize={setGuideWidth} onDragging={setResizing} />
        <GuidePanel
          progress={progress}
          ctx={stepContext}
          hasProject={!showWelcome}
          onSelect={selectStep}
          onNext={finishStep}
          onOpenFolder={() => void pickFolder()}
          onUseSample={() => showPrompt({ kind: 'sample', siteName: SAMPLE_SITE_NAME })}
        />
      </main>
    </div>
  )
}

/** The file with the main page's JSX, for the step instructions. */
async function findMainFile(dir: FileSystemDirectoryHandle): Promise<string | null> {
  for (const path of ['src/pages/HomePage.jsx', 'src/App.jsx', 'src/App.tsx']) {
    if (await fileExists(dir, path)) return path
  }
  return null
}

function summarize(result: ConversionResult): ConversionSummary {
  const count = (title: string) => result.notes.find((note) => note.title.startsWith(title))?.count ?? 0
  return {
    pages: result.pages.length,
    classNames: count('`class` became `className`'),
    handlers: count('Inline event handlers became functions'),
    links: count('Links between your pages'),
    checks: result.notes.filter((note) => note.kind === 'check').length,
  }
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
