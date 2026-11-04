// Width of the side panel, remembered between visits.

import { useState } from 'react'

export const GUIDE_MIN_WIDTH = 300
export const GUIDE_DEFAULT_WIDTH = 380
const GUIDE_MAX_SHARE = 0.6 // of the window width, so the preview stays usable
const STORAGE_KEY = 'launchpad-guide-width'

export function clampWidth(width: number): number {
  const max = Math.max(GUIDE_MIN_WIDTH, window.innerWidth * GUIDE_MAX_SHARE)
  return Math.round(Math.min(max, Math.max(GUIDE_MIN_WIDTH, width)))
}

/** The side panel's width, remembered in localStorage. */
export function useGuideWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY))
      return saved > 0 ? clampWidth(saved) : GUIDE_DEFAULT_WIDTH
    } catch {
      return GUIDE_DEFAULT_WIDTH
    }
  })
  const save = (next: number) => {
    setWidth(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Only a convenience.
    }
  }
  return [width, save] as const
}
