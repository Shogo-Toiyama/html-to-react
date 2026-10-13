// Full-page preview opened in a new tab (`/?preview=<url>`). Embedding the
// preview in our own page, instead of opening the WebContainer URL directly,
// avoids WebContainer's "Connect to Project" screen. The project keeps running
// in the original React Launchpad tab, which must stay open.

import { isPreviewUrl } from '../lib/previewTab'

export function PreviewOnly({ url }: { url: string }) {
  if (!isPreviewUrl(url)) {
    return (
      <div className="welcome">
        <h1>This preview link doesn’t look right</h1>
        <p>Open the preview again from the React Launchpad tab.</p>
      </div>
    )
  }
  return <iframe className="preview-only-frame" src={url} title="Preview" />
}
