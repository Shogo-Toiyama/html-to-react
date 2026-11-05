// Lets the side panel talk to the preview without holding a reference to it:
// - ask it to blink a component (e.g. the one picked in the Tailwind step).
//   PreviewPane listens and forwards it to the bridge script in the preview.
// - read which page the preview is showing (the chat sends it to the AI).

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

let previewPath: string | null = null

/** Called by PreviewPane when the preview reports its path. */
export function setPreviewPath(path: string | null) {
  previewPath = path
}

/** The path the preview is showing, e.g. `/about`, or null without a preview. */
export function currentPreviewPath(): string | null {
  return previewPath
}
