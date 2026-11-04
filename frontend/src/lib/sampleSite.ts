// The workshop's sample website (src/samples/acm-design), for participants
// who don't have their own site or missed the first steps.

/** Folder name for the saved sample (its React version becomes "MySampleWebsite - React"). */
export const SAMPLE_SITE_NAME = 'MySampleWebsite'

const PREFIX = '../samples/acm-design/'

// Text files are bundled as strings; anything else (images, fonts) as URLs.
// (import.meta.glob only accepts literal patterns.)
const textFiles = import.meta.glob('../samples/acm-design/**/*.{html,htm,css,js,json,svg,txt,md}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const binaryFiles = import.meta.glob(['../samples/acm-design/**/*', '!../samples/acm-design/**/*.{html,htm,css,js,json,svg,txt,md}'], {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The sample site's files, keyed by path inside the site (`index.html`). */
export async function loadSampleSite(): Promise<Map<string, string | Uint8Array>> {
  const files = new Map<string, string | Uint8Array>()
  for (const [path, text] of Object.entries(textFiles)) files.set(path.slice(PREFIX.length), text)
  for (const [path, url] of Object.entries(binaryFiles)) {
    const response = await fetch(url)
    files.set(path.slice(PREFIX.length), new Uint8Array(await response.arrayBuffer()))
  }
  return files
}
