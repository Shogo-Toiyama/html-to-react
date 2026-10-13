import type { WebContainer, WebContainerProcess } from '@webcontainer/api'
import { copyTypePackages, writeEditorConfig } from './editorSupport'
import { diffSnapshots, readBytes, scanFolder, snapshotToTree, type FolderSnapshot } from './localFolder'
import { clearWorkdir, getWebContainer } from './webcontainer'

const POLL_INTERVAL_MS = 1000

// Vite 8's bundler runs on WASI here, which makes Node print an
// ExperimentalWarning on every worker start. Hide it from participants.
const PROCESS_ENV = { NODE_NO_WARNINGS: '1' }

export type SessionPhase = 'booting' | 'mounting' | 'installing' | 'starting' | 'running' | 'error' | 'stopped'

export interface SessionCallbacks {
  onPhase(phase: SessionPhase, detail?: string): void
  /** Raw terminal output (may contain ANSI escape codes). */
  onOutput(chunk: string): void
  onServerReady(url: string): void
  onSynced(changed: string[], removed: string[]): void
}

export interface TerminalSize {
  cols: number
  rows: number
}

/**
 * Runs a participant's local project inside the WebContainer:
 * mount → `npm install` → `npm run dev`, then mirrors local edits into the
 * container by polling the folder.
 */
export class DevSession {
  private wc: WebContainer | null = null
  private snapshot: FolderSnapshot = new Map()
  private devProcess: WebContainerProcess | null = null
  private installed = false
  private unsubscribers: (() => void)[] = []
  private stopped = false
  private readonly dir: FileSystemDirectoryHandle
  private readonly cb: SessionCallbacks
  private readonly terminalSize: () => TerminalSize

  constructor(dir: FileSystemDirectoryHandle, callbacks: SessionCallbacks, terminalSize: () => TerminalSize) {
    this.dir = dir
    this.cb = callbacks
    this.terminalSize = terminalSize
  }

  async start() {
    try {
      this.cb.onPhase('booting')
      this.info('Starting the in-browser Node.js environment…')
      const wc = await getWebContainer()
      this.wc = wc
      if (this.stopped) return

      this.unsubscribers.push(
        wc.on('server-ready', (_port, url) => {
          if (this.stopped) return
          this.cb.onPhase('running')
          this.cb.onServerReady(url)
        }),
        wc.on('error', ({ message }) => this.fail(message)),
      )

      this.cb.onPhase('mounting')
      // Write config before the first scan so it isn't reported as a user edit.
      const configWritten = await writeEditorConfig(this.dir)
      if (configWritten.length > 0) this.info(`Added VS Code settings: ${configWritten.join(', ')}`)

      this.info(`Loading files from "${this.dir.name}"…`)
      await clearWorkdir(wc)
      this.snapshot = await scanFolder(this.dir)
      await wc.mount(await snapshotToTree(this.snapshot))
      this.info(`Loaded ${this.snapshot.size} files.`)

      void this.loop()
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  stop() {
    this.stopped = true
    this.devProcess?.kill()
    this.devProcess = null
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.cb.onPhase('stopped')
  }

  private async install(): Promise<boolean> {
    const wc = this.wc!
    this.cb.onPhase('installing')
    this.command('npm install')
    const exitCode = await this.run(await wc.spawn('npm', ['install'], { terminal: this.terminalSize(), env: PROCESS_ENV }))
    if (this.stopped) return false
    if (exitCode !== 0) {
      this.fail(`npm install failed (exit code ${exitCode}). Check package.json and save to retry.`)
      return false
    }

    const copied = await copyTypePackages(wc, this.dir)
    if (copied.length > 0) this.info(`Copied type definitions for VS Code: ${copied.join(', ')}`)
    return true
  }

  private async startDevServer() {
    const wc = this.wc!
    this.cb.onPhase('starting')
    this.command('npm run dev')
    // Keep Vite from clearing the terminal so the install log stays visible.
    const process = await wc.spawn('npm', ['run', 'dev', '--', '--clearScreen', 'false'], {
      terminal: this.terminalSize(),
      env: PROCESS_ENV,
    })
    this.devProcess = process
    void this.run(process).then((exitCode) => {
      if (this.devProcess !== process || this.stopped) return
      this.devProcess = null
      this.fail(`The dev server stopped (exit code ${exitCode}). Fix the error and save a file to restart it.`)
    })
  }

  private async restart(reinstall: boolean) {
    const process = this.devProcess
    this.devProcess = null
    process?.kill()
    if (reinstall) this.installed = await this.install()
    if (this.installed && !this.stopped) await this.startDevServer()
  }

  // Install, start, and sync all run on this one sequential loop, so a save
  // during `npm install` is simply picked up by the next sync.
  private async loop() {
    await this.restart(true)
    while (!this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (this.stopped) return
      try {
        await this.syncOnce()
      } catch (error) {
        this.info(`Sync error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async syncOnce() {
    const wc = this.wc!
    const next = await scanFolder(this.dir)
    const { changed, removed } = diffSnapshots(this.snapshot, next)
    this.snapshot = next
    if (changed.length === 0 && removed.length === 0) return

    for (const path of changed) {
      const slash = path.lastIndexOf('/')
      if (slash > 0) await wc.fs.mkdir(path.slice(0, slash), { recursive: true })
      await wc.fs.writeFile(path, await readBytes(next.get(path)!))
    }
    for (const path of removed) {
      await wc.fs.rm(path, { force: true })
    }
    this.cb.onSynced(changed, removed)

    if (changed.includes('package.json') || !this.installed) {
      this.info('Files changed — reinstalling packages.')
      await this.restart(true)
    } else if (!this.devProcess) {
      await this.restart(false)
    }
  }

  private async run(process: WebContainerProcess): Promise<number> {
    void process.output.pipeTo(
      new WritableStream({ write: (chunk) => this.cb.onOutput(chunk) }),
    )
    return process.exit
  }

  private fail(message: string) {
    if (this.stopped) return
    this.cb.onOutput(`\r\n\x1b[31m✖ ${message}\x1b[0m\r\n`)
    this.cb.onPhase('error', message)
  }

  private info(message: string) {
    this.cb.onOutput(`\x1b[36m● ${message}\x1b[0m\r\n`)
  }

  private command(command: string) {
    this.cb.onOutput(`\r\n\x1b[1m$ ${command}\x1b[0m\r\n`)
  }
}
