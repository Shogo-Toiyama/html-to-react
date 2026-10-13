import { WebContainer } from '@webcontainer/api'

// Only one WebContainer can be booted per page, so share a single promise.
let bootPromise: Promise<WebContainer> | null = null

export function getWebContainer(): Promise<WebContainer> {
  bootPromise ??= WebContainer.boot({ coep: 'credentialless', workdirName: 'project' }).catch(
    (error: unknown) => {
      bootPromise = null
      throw error
    },
  )
  return bootPromise
}

/** Removes everything from the working directory (used when switching folders). */
export async function clearWorkdir(wc: WebContainer) {
  for (const name of await wc.fs.readdir('.')) {
    await wc.fs.rm(name, { recursive: true, force: true })
  }
}
