// Links for opening the preview in a new tab through our own page (see PreviewOnly).

const PREVIEW_HOST = /\.webcontainer-api\.io$/

export function previewTabUrl(previewUrl: string): string {
  return `${location.origin}${location.pathname}?preview=${encodeURIComponent(previewUrl)}`
}

/** Only WebContainer preview URLs may be embedded, so the page can't be used to frame other sites. */
export function isPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && PREVIEW_HOST.test(parsed.hostname)
  } catch {
    return false
  }
}
