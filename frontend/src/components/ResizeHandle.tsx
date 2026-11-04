// Draggable border between the preview and the side panel.

import type { PointerEvent } from 'react'
import { clampWidth, GUIDE_DEFAULT_WIDTH, GUIDE_MIN_WIDTH } from '../lib/guideWidth'

interface ResizeHandleProps {
  width: number
  onResize(width: number): void
  /** True while dragging (the preview iframe must not swallow the pointer then). */
  onDragging(dragging: boolean): void
}

export function ResizeHandle({ width, onResize, onDragging }: ResizeHandleProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    onDragging(true)
    // The panel is on the right, so dragging left makes it wider.
    const move = (e: globalThis.PointerEvent) => onResize(clampWidth(startWidth + startX - e.clientX))
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      onDragging(false)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuenow={width}
      aria-valuemin={GUIDE_MIN_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(GUIDE_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onResize(clampWidth(width + 20))
        if (event.key === 'ArrowRight') onResize(clampWidth(width - 20))
      }}
    />
  )
}
