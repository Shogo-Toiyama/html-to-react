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
let previewBase: string | null = null

/** Called by PreviewPane with the dev server's URL (null while there is none). */
export function setPreviewBase(url: string | null) {
  previewBase = url
}

/** The dev server's URL inside this tab, e.g. for opening a draft page. */
export function currentPreviewBase(): string | null {
  return previewBase
}

/** Called by PreviewPane when the preview reports its path. */
export function setPreviewPath(path: string | null) {
  previewPath = path
}

/** The path the preview is showing, e.g. `/about`, or null without a preview. */
export function currentPreviewPath(): string | null {
  return previewPath
}

// ---- Picking a component in the preview (Step 5 chat) ----

const PICK_EVENT = 'launchpad:pick'
const PICKED_EVENT = 'launchpad:picked'

export interface PickedComponent {
  name: string
  /** The component with its props, e.g. `<ProjectCard title="AI Modeling" />`. */
  label: string
}

/** Turns picking on (the next click in the preview chooses a component) or off. */
export function requestPick(enabled: boolean) {
  window.dispatchEvent(new CustomEvent<boolean>(PICK_EVENT, { detail: enabled }))
}

export function onPickRequest(listener: (enabled: boolean) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<boolean>).detail)
  window.addEventListener(PICK_EVENT, handler)
  return () => window.removeEventListener(PICK_EVENT, handler)
}

/** Called by PreviewPane. `null`: picking ended without a component (Esc, or the preview went away). */
export function reportPicked(picked: PickedComponent | null) {
  window.dispatchEvent(new CustomEvent<PickedComponent | null>(PICKED_EVENT, { detail: picked }))
}

export function onPicked(listener: (picked: PickedComponent | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<PickedComponent | null>).detail)
  window.addEventListener(PICKED_EVENT, handler)
  return () => window.removeEventListener(PICKED_EVENT, handler)
}
