// Applying an AI suggestion to the participant's folder, undoing it, and the
// change log. Before files are overwritten, their old versions are copied to
// `.launchpad/backups/<id>/`. Every applied suggestion is recorded in
// `.launchpad/history.json` (and localStorage) with what changed and why.

import type { AiStep, FileChange, SuggestedComponent, Suggestion } from './aiApi'
import { deleteLocalFile, fileExists, readTextFile, writeLocalFile } from './localFolder'

export interface AiHistoryEntry {
  id: string
  /** ISO time it was applied. */
  appliedAt: string
  step: AiStep
  model: string
  summary: string
  components: SuggestedComponent[]
  changes: FileChange[]
  /** Files that didn't exist before (deleted on undo). */
  created: string[]
  /** Files that were overwritten; their old versions are in `.launchpad/backups/<id>/`. */
  modified: string[]
  undoneAt?: string
}

const HISTORY_FILE = '.launchpad/history.json'

function storageKey(dir: FileSystemDirectoryHandle) {
  return `launchpad-ai-history:${dir.name}`
}

export async function readHistory(dir: FileSystemDirectoryHandle): Promise<AiHistoryEntry[]> {
  try {
    const text = await readTextFile(dir, HISTORY_FILE)
    if (text) return (JSON.parse(text).entries ?? []) as AiHistoryEntry[]
  } catch {
    // Fall back to the browser copy.
  }
  try {
    return JSON.parse(localStorage.getItem(storageKey(dir)) ?? '[]') as AiHistoryEntry[]
  } catch {
    return []
  }
}

async function saveHistory(dir: FileSystemDirectoryHandle, entries: AiHistoryEntry[]) {
  const json = JSON.stringify({ version: 1, entries }, null, 2) + '\n'
  try {
    localStorage.setItem(storageKey(dir), JSON.stringify(entries))
  } catch {
    // The folder copy is the main one.
  }
  await writeLocalFile(dir, HISTORY_FILE, json)
}

export async function applySuggestion(
  dir: FileSystemDirectoryHandle,
  step: AiStep,
  model: string,
  suggestion: Suggestion,
): Promise<AiHistoryEntry> {
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const created: string[] = []
  const modified: string[] = []
  // Back up first, then write, so a failure halfway can still be undone.
  for (const file of suggestion.files) {
    const old = await readTextFile(dir, file.path)
    if (old === null) {
      created.push(file.path)
    } else {
      modified.push(file.path)
      await writeLocalFile(dir, `.launchpad/backups/${id}/${file.path}`, old)
    }
  }
  for (const file of suggestion.files) await writeLocalFile(dir, file.path, file.content)

  const entry: AiHistoryEntry = {
    id,
    appliedAt: new Date().toISOString(),
    step,
    model,
    summary: suggestion.summary,
    components: suggestion.components,
    changes: suggestion.changes,
    created,
    modified,
  }
  await saveHistory(dir, [...(await readHistory(dir)), entry])
  return entry
}

export async function undoSuggestion(dir: FileSystemDirectoryHandle, entry: AiHistoryEntry): Promise<AiHistoryEntry> {
  for (const path of entry.modified) {
    const old = await readTextFile(dir, `.launchpad/backups/${entry.id}/${path}`)
    if (old !== null) await writeLocalFile(dir, path, old)
  }
  for (const path of entry.created) {
    if (await fileExists(dir, path)) await deleteLocalFile(dir, path)
  }
  const undone = { ...entry, undoneAt: new Date().toISOString() }
  const history = await readHistory(dir)
  await saveHistory(
    dir,
    history.map((e) => (e.id === entry.id ? undone : e)),
  )
  return undone
}
