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
export type HostCommand =
  | { type: 'navigate'; path: string }
  | { type: 'back' | 'forward' | 'reload' }
  /** Outline the React component under the mouse. */
  | { type: 'inspect'; enabled: boolean }
  /** Blink every instance of a component (by name) twice. */
  | { type: 'highlight'; component: string }

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
    } else if (message.type === 'inspect') {
      inspecting = message.enabled
      if (!inspecting) hide()
    } else if (message.type === 'highlight') {
      highlight(message.component)
    }
  })

  // ---- Component inspector: outline the React component under the mouse ----
  // In development React keeps a "fiber" on every DOM element that records
  // which component rendered it. Walk up from the hovered element to the
  // nearest component the participant wrote, and outline everything it renders.
  const SKIP = new Set(['App', 'ScrollToTop', 'Routes', 'Route', 'RenderedRoute', 'Router', 'BrowserRouter', 'Navigate', 'Outlet'])
  let inspecting = false
  let box = null
  let label = null
  let lastTarget = null

  const fiberOf = (node) => {
    for (let el = node; el; el = el.parentElement) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
      if (key) return el[key]
    }
    return null
  }
  const componentOf = (fiber) => {
    for (let f = fiber; f; f = f.return) {
      if (typeof f.type !== 'function') continue
      const name = f.type.displayName || f.type.name
      if (name && /^[A-Z]/.test(name) && !SKIP.has(name)) return { fiber: f, name }
    }
    return null
  }
  const topElements = (fiber) => {
    const out = []
    const walk = (f) => {
      for (let child = f.child; child; child = child.sibling) {
        if (child.stateNode instanceof Element) out.push(child.stateNode)
        else walk(child)
      }
    }
    walk(fiber)
    return out
  }
  const shortValue = (value) => {
    if (typeof value === 'string') return JSON.stringify(value.length > 24 ? value.slice(0, 24) + '…' : value)
    if (typeof value === 'function') return '{function}'
    const json = JSON.stringify(value)
    return '{' + (json && json.length > 24 ? json.slice(0, 24) + '…' : json) + '}'
  }
  const describe = (name, props) => {
    const entries = Object.entries(props || {}).filter(([key]) => key !== 'children')
    return '<' + name + entries.map(([key, value]) => ' ' + key + '=' + shortValue(value)).join('') + ' />'
  }
  const hide = () => {
    if (box) box.style.display = 'none'
    lastTarget = null
  }
  const show = (target) => {
    const found = componentOf(fiberOf(target))
    const rects = found ? topElements(found.fiber).map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height) : []
    if (!found || rects.length === 0) return hide()
    if (!box) {
      box = document.createElement('div')
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid #fe8d3c;background:rgba(254,141,60,0.08);border-radius:2px'
      label = document.createElement('div')
      label.style.cssText = 'position:absolute;left:-2px;padding:2px 6px;border-radius:4px;background:#fe8d3c;color:#fff;font:600 12px/1.4 ui-monospace,Menlo,monospace;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis'
      box.appendChild(label)
      document.documentElement.appendChild(box)
    }
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    const right = Math.max(...rects.map((r) => r.right))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    Object.assign(box.style, { display: 'block', left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' })
    label.textContent = describe(found.name, found.fiber.memoizedProps)
    label.style.top = top > 22 ? '-22px' : '2px'
    lastTarget = target
  }
  let frame = 0
  document.addEventListener('mousemove', (event) => {
    if (!inspecting) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => show(event.target))
  }, true)
  window.addEventListener('scroll', () => inspecting && lastTarget && show(lastTarget), true)
  document.addEventListener('mouseleave', hide)

  // ---- Highlight: blink every instance of one component twice ----
  const instancesOf = (name) => {
    const rootEl = document.getElementById('root')
    const key = rootEl && Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$'))
    if (!key) return []
    const found = []
    const visit = (fiber) => {
      for (let f = fiber; f; f = f.sibling) {
        const type = f.type
        if (typeof type === 'function' && (type.displayName || type.name) === name) found.push(f)
        else visit(f.child)
      }
    }
    // The root's "current" tree is the one on screen.
    visit(rootEl[key].stateNode.current.child)
    return found
  }
  const highlight = (name) => {
    const elements = instancesOf(name).flatMap(topElements)
    if (elements.length === 0) return
    const onScreen = (el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < innerHeight && (r.width || r.height)
    }
    const scrolled = !elements.some(onScreen)
    if (scrolled) elements[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => {
      for (const el of elements) {
        const r = el.getBoundingClientRect()
        if (!r.width && !r.height) continue
        const flash = document.createElement('div')
        flash.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:4px;outline:3px solid #fe8d3c;background:rgba(254,141,60,0.25);opacity:0'
        Object.assign(flash.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' })
        document.documentElement.appendChild(flash)
        const blink = flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 1400, easing: 'ease-in-out' })
        blink.onfinish = () => flash.remove()
      }
    }, scrolled ? 450 : 0)
  }

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
