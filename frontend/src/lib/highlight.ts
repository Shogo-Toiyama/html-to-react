// Lets the side panel ask the preview to blink a component (e.g. the one
// picked in the Tailwind step). PreviewPane listens and forwards it to the
// bridge script in the preview.

const EVENT = 'launchpad:highlight'

/** `component` is the component's name, e.g. `ProjectCard`. */
export function highlightComponent(component: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: component }))
}

export function onHighlightRequest(listener: (component: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
