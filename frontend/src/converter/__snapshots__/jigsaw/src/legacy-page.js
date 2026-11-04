// Used by the *.legacy-script.js files in src/pages/ (added by the converter).
//
// On a normal website, opening another page throws away everything the old
// page's JavaScript started. With React Router the browser never leaves the
// page, so listeners on window/document and running timers would pile up
// every time you came back. trackPage() remembers them, and stop() ends them
// when you leave the page. Delete this file once no page imports it.

export function trackPage() {
  const listeners = []
  const timeouts = new Set()
  const intervals = new Set()
  const frames = new Set()

  for (const target of [window, document]) {
    target.addEventListener = (type, listener, options) => {
      EventTarget.prototype.addEventListener.call(target, type, listener, options)
      listeners.push([target, type, listener, options])
    }
  }

  return {
    setTimeout(callback, delay, ...args) {
      const id = window.setTimeout(() => {
        timeouts.delete(id)
        callback(...args)
      }, delay)
      timeouts.add(id)
      return id
    },
    setInterval(callback, delay, ...args) {
      const id = window.setInterval(callback, delay, ...args)
      intervals.add(id)
      return id
    },
    requestAnimationFrame(callback) {
      const id = window.requestAnimationFrame((time) => {
        frames.delete(id)
        callback(time)
      })
      frames.add(id)
      return id
    },
    stop() {
      delete window.addEventListener
      delete document.addEventListener
      for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options)
      timeouts.forEach((id) => clearTimeout(id))
      intervals.forEach((id) => clearInterval(id))
      frames.forEach((id) => cancelAnimationFrame(id))
    },
  }
}
