import { logInfo } from './audio/audio-element-diagnostics'

/**
 * Chromium navigates the window to whatever is dropped on it when nothing
 * cancels the drop, and the window carries the preload (#638). Drop zones
 * cancel their own `dragover`/`drop`; this cancels the rest and shows the
 * drag as not droppable there.
 */
export function installStrayDropGuard(target: Document = document): () => void {
  const onDragOver = (event: Event) => {
    if (event.defaultPrevented)
      return
    event.preventDefault()
    const { dataTransfer } = event as DragEvent
    if (dataTransfer)
      dataTransfer.dropEffect = 'none'
  }
  const onDrop = (event: Event) => {
    if (event.defaultPrevented)
      return
    event.preventDefault()
    logInfo('[drop] Ignored a drop outside a drop zone')
  }
  target.addEventListener('dragover', onDragOver)
  target.addEventListener('drop', onDrop)
  return () => {
    target.removeEventListener('dragover', onDragOver)
    target.removeEventListener('drop', onDrop)
  }
}
