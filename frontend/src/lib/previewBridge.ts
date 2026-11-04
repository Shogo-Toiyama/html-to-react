// A tiny script inside the preview tells Launchpad which page it is on, and
// lets the toolbar navigate it (the preview is a cross-origin iframe, so
// Launchpad can't read or change its URL directly).
//
// The script is added by a Vite config that wraps the participant's own
// vite.config.js. Both files live only inside the WebContainer, in
// RUNTIME_DIR; they are never written to the participant's folder.

export const RUNTIME_DIR = '.launchpad-runtime'
export const RUNTIME_CONFIG = `${RUNTIME_DIR}/vite.config.mjs`

/** Messages from the preview to Launchpad. */
export type PreviewMessage =
  | {
      source: 'launchpad-preview'
      type: 'location'
      /** pathname + search + hash, e.g. `/about#team`. */
      path: string
    }
  /** Esc was pressed inside the preview (key presses there never reach Launchpad's window). */
  | { source: 'launchpad-preview'; type: 'escape' }

/** What Launchpad can ask the preview to do. */
export type HostCommand = { type: 'navigate'; path: string } | { type: 'back' | 'forward' | 'reload' }

/** Messages from Launchpad to the preview. */
export type HostMessage = HostCommand & { source: 'launchpad-host' }

export function isPreviewMessage(data: unknown): data is PreviewMessage {
  return typeof data === 'object' && data !== null && (data as PreviewMessage).source === 'launchpad-preview'
}

/** Runs inside the preview page. Plain JavaScript (it is injected as-is). */
const BRIDGE_SCRIPT = `;(() => {
  if (window.parent === window) return
  const currentPath = () => location.pathname + location.search + location.hash
  const report = () =>
    window.parent.postMessage({ source: 'launchpad-preview', type: 'location', path: currentPath() }, '*')

  // React Router changes the URL with pushState/replaceState, which fire no event.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    history[method] = function (...args) {
      const result = original.apply(this, args)
      report()
      return result
    }
  }
  window.addEventListener('popstate', report)
  window.addEventListener('hashchange', report)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.parent.postMessage({ source: 'launchpad-preview', type: 'escape' }, '*')
  })

  window.addEventListener('message', (event) => {
    const message = event.data
    if (event.source !== window.parent || !message || message.source !== 'launchpad-host') return
    if (message.type === 'navigate') {
      if (message.path === currentPath()) return
      // Same as clicking a <Link>: change the URL, then tell the router.
      history.pushState(null, '', message.path)
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    } else if (message.type === 'back') {
      history.back()
    } else if (message.type === 'forward') {
      history.forward()
    } else if (message.type === 'reload') {
      location.reload()
    }
  })
  report()
})()
`

const WRAPPER_CONFIG = `// Added by React Launchpad inside the in-browser container only (it is not in
// your folder). It loads your vite.config.js and adds a small script that tells
// Launchpad which page the preview is showing.
import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite'

const bridge = ${JSON.stringify(BRIDGE_SCRIPT)}

export default defineConfig(async (env) => {
  const loaded = await loadConfigFromFile(env, undefined, process.cwd())
  return mergeConfig(loaded?.config ?? {}, {
    plugins: [
      {
        name: 'launchpad-preview-bridge',
        apply: 'serve',
        transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module' }, children: bridge, injectTo: 'head-prepend' }],
      },
    ],
  })
})
`

/** Files to write into the container before starting the dev server. */
export const RUNTIME_FILES: Record<string, string> = {
  [RUNTIME_CONFIG]: WRAPPER_CONFIG,
}
