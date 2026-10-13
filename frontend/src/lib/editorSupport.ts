import type { WebContainer } from '@webcontainer/api'
import { fileExists, readTextFile, writeLocalFile } from './localFolder'

// Participants edit in VS Code without Node installed, so there is no local
// node_modules. VS Code's JS features run on TypeScript, which only needs the
// type packages (not React itself) to provide autocomplete and hover docs.
// We copy those few small packages from the WebContainer to the local folder.

const TYPE_PACKAGES = ['@types/react', '@types/react-dom']

const CONFIG_FILES: Record<string, string> = {
  // Type checking stays off: converted sites keep their original DOM code,
  // which would otherwise light up with errors like `.value` on `Element`.
  'jsconfig.json':
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          checkJs: false,
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',
  // Without npm, VS Code's automatic type download fails with a warning.
  '.vscode/settings.json':
    JSON.stringify({ 'typescript.disableAutomaticTypeAcquisition': true }, null, 2) + '\n',
}

/** Writes VS Code config files that don't exist yet. Returns the paths written. */
export async function writeEditorConfig(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const written: string[] = []
  for (const [path, contents] of Object.entries(CONFIG_FILES)) {
    if (await fileExists(dir, path)) continue
    await writeLocalFile(dir, path, contents)
    written.push(path)
  }
  return written
}

const WRITE_CONCURRENCY = 6
// Only what TypeScript reads; skips READMEs, licenses, etc. Writing to a real
// disk through the File System Access API is slow (about a second per file).
const NEEDED_FILE = /(\.d\.ts|\.d\.mts|\.d\.cts|package\.json)$/

/**
 * Copies installed type packages (and their dependencies, e.g. `csstype`) from
 * the WebContainer into the local `node_modules`. Packages whose local version
 * already matches are skipped. Returns the packages copied.
 */
export async function copyTypePackages(wc: WebContainer, dir: FileSystemDirectoryHandle): Promise<string[]> {
  const copied: string[] = []
  const queue = [...TYPE_PACKAGES]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)

    const pkgDir = `node_modules/${name}`
    let manifest: { version?: string; dependencies?: Record<string, string> }
    try {
      manifest = JSON.parse(await wc.fs.readFile(`${pkgDir}/package.json`, 'utf-8'))
    } catch {
      continue // not installed in this project
    }
    queue.push(...Object.keys(manifest.dependencies ?? {}))

    const localManifest = await readTextFile(dir, `${pkgDir}/package.json`)
    if (localManifest && JSON.parse(localManifest).version === manifest.version) continue

    const copyFile = async (path: string) => writeLocalFile(dir, path, await wc.fs.readFile(path))
    const manifestPath = `${pkgDir}/package.json`
    const files = (await listFiles(wc, pkgDir)).filter((path) => path !== manifestPath)
    await runWithConcurrency(files, WRITE_CONCURRENCY, copyFile)
    // Written last: its version marks the copy as complete, so an interrupted
    // copy is retried next time.
    await copyFile(manifestPath)
    copied.push(`${name}@${manifest.version}`)
  }
  return copied
}

async function listFiles(wc: WebContainer, path: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await wc.fs.readdir(path, { withFileTypes: true })) {
    const childPath = `${path}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listFiles(wc, childPath)))
    } else if (entry.isFile() && NEEDED_FILE.test(entry.name)) {
      files.push(childPath)
    }
  }
  return files
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++])
  })
  await Promise.all(workers)
}
