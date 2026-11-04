import type { DirectoryNode, FileSystemTree } from '@webcontainer/api'

/** Names we never read from (or sync out of) the participant's folder. */
const IGNORED_NAMES = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'Thumbs.db'])

export interface LocalFileEntry {
  handle: FileSystemFileHandle
  lastModified: number
  size: number
}

/** Snapshot of the folder keyed by POSIX-style relative path, e.g. `src/App.jsx`. */
export type FolderSnapshot = Map<string, LocalFileEntry>

export async function scanFolder(dir: FileSystemDirectoryHandle): Promise<FolderSnapshot> {
  const snapshot: FolderSnapshot = new Map()
  await walk(dir, '', snapshot)
  return snapshot
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: FolderSnapshot) {
  for await (const [name, handle] of dir.entries()) {
    if (IGNORED_NAMES.has(name)) continue
    const path = prefix + name
    if (handle.kind === 'directory') {
      await walk(handle, path + '/', out)
    } else {
      const file = await handle.getFile()
      out.set(path, { handle, lastModified: file.lastModified, size: file.size })
    }
  }
}

export interface SnapshotDiff {
  changed: string[]
  removed: string[]
}

export function diffSnapshots(before: FolderSnapshot, after: FolderSnapshot): SnapshotDiff {
  const changed: string[] = []
  const removed: string[] = []
  for (const [path, entry] of after) {
    const prev = before.get(path)
    if (!prev || prev.lastModified !== entry.lastModified || prev.size !== entry.size) {
      changed.push(path)
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path)
  }
  return { changed, removed }
}

export async function readBytes(entry: LocalFileEntry): Promise<Uint8Array> {
  const file = await entry.handle.getFile()
  return new Uint8Array(await file.arrayBuffer())
}

/** Builds the nested tree that `WebContainer.mount()` expects. */
export async function snapshotToTree(snapshot: FolderSnapshot): Promise<FileSystemTree> {
  const root: FileSystemTree = {}
  for (const [path, entry] of snapshot) {
    const parts = path.split('/')
    const fileName = parts.pop()!
    let node = root
    for (const part of parts) {
      node[part] ??= { directory: {} }
      node = (node[part] as DirectoryNode).directory
    }
    node[fileName] = { file: { contents: await readBytes(entry) } }
  }
  return root
}

/** True when the folder has nothing a participant would see (hidden `.` entries don't count). */
export async function isFolderEmpty(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const name of dir.keys()) {
    if (!name.startsWith('.') && name !== 'Thumbs.db') return false
  }
  return true
}

/** True if `child` is a folder directly inside `parent`. */
export async function containsFolder(parent: FileSystemDirectoryHandle, child: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const entry of parent.values()) {
    if (entry.kind === 'directory' && (await entry.isSameEntry(child))) return true
  }
  return false
}

/** Creates `name` inside `parent`, or `name 2`, `name 3`, ... if that name is taken. */
export async function createNewFolder(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`
    if (!(await entryExists(parent, candidate))) return parent.getDirectoryHandle(candidate, { create: true })
  }
}

async function entryExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  for await (const existing of dir.keys()) if (existing === name) return true
  return false
}

export async function fileExists(dir: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    await getFileHandle(dir, path, false)
    return true
  } catch {
    return false
  }
}

export async function readTextFile(dir: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  try {
    const handle = await getFileHandle(dir, path, false)
    return await (await handle.getFile()).text()
  } catch {
    return null
  }
}

export async function writeLocalFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  contents: string | Uint8Array,
) {
  const handle = await getFileHandle(dir, path, true)
  const writable = await handle.createWritable()
  await writable.write(typeof contents === 'string' ? contents : new Blob([contents as BlobPart]))
  await writable.close()
}

const WRITE_CONCURRENCY = 6

/**
 * Writes many files, several at a time (each write to a real disk is slow).
 * With `skipExisting`, files that already exist are left untouched.
 */
export async function writeLocalFiles(
  dir: FileSystemDirectoryHandle,
  files: Iterable<[path: string, contents: string | Uint8Array]>,
  { skipExisting = false, onWritten }: { skipExisting?: boolean; onWritten?: (path: string) => void } = {},
) {
  await runWithConcurrency([...files], WRITE_CONCURRENCY, async ([path, contents]) => {
    if (skipExisting && (await fileExists(dir, path))) return
    await writeLocalFile(dir, path, contents)
    onWritten?.(path)
  })
}

export async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++])
  })
  await Promise.all(workers)
}

async function getFileHandle(dir: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/')
  const fileName = parts.pop()!
  let current = dir
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create })
  }
  return current.getFileHandle(fileName, { create })
}

/** Asks for read/write access; must be called from a user gesture when it may prompt. */
export async function ensureReadWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return true
  return (await handle.requestPermission?.(descriptor)) === 'granted'
}

// Remember the last folder so a page reload doesn't mean re-picking it.
// FileSystemHandles can be stored in IndexedDB (but not localStorage).

const DB_NAME = 'react-launchpad'
const STORE = 'handles'
const LAST_FOLDER_KEY = 'last-folder'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function rememberFolder(handle: FileSystemDirectoryHandle) {
  try {
    const db = await openDb()
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, LAST_FOLDER_KEY)
  } catch {
    // Remembering the folder is only a convenience.
  }
}

export async function recallFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(LAST_FOLDER_KEY)
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}
