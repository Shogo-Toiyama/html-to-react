// Where a participant is in the workshop. Saved in their project folder
// (`.launchpad/progress.json`) so it travels with the project to another
// computer or the next workshop, and in localStorage for when no folder is open.

import { readTextFile, writeLocalFile } from './localFolder'

export interface Progress {
  workshop: string
  step: string
  /** Finished steps as `workshop/step`, e.g. `w4/jsx`. */
  completed: string[]
}

const FILE = '.launchpad/progress.json'
const STORAGE_KEY = 'launchpad-progress'

export function stepKey(workshop: string, step: string): string {
  return `${workshop}/${step}`
}

function parse(text: string | null): Progress | null {
  if (!text) return null
  try {
    const data = JSON.parse(text)
    if (typeof data?.workshop !== 'string' || typeof data?.step !== 'string' || !Array.isArray(data?.completed)) return null
    return { workshop: data.workshop, step: data.step, completed: data.completed.filter((k: unknown) => typeof k === 'string') }
  } catch {
    return null
  }
}

export async function readProgress(dir: FileSystemDirectoryHandle): Promise<Progress | null> {
  return parse(await readTextFile(dir, FILE))
}

export async function writeProgress(dir: FileSystemDirectoryHandle, progress: Progress) {
  const data = { version: 1, ...progress, updatedAt: new Date().toISOString() }
  await writeLocalFile(dir, FILE, JSON.stringify(data, null, 2) + '\n')
}

export function loadLocalProgress(): Progress | null {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveLocalProgress(progress: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Only a convenience; the project folder holds the real copy.
  }
}
