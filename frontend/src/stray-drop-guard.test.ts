import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logInfo } from './audio/audio-element-diagnostics'
import { installStrayDropGuard } from './stray-drop-guard'

vi.mock('./audio/audio-element-diagnostics', () => ({
  logInfo: vi.fn(),
}))

function dragEvent(type: 'dragover' | 'drop'): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: { dropEffect: 'copy' },
  })
  return event
}

describe('installStrayDropGuard', () => {
  let uninstall: () => void
  let zone: HTMLElement
  let elsewhere: HTMLElement

  beforeEach(() => {
    uninstall = installStrayDropGuard(document)
    zone = document.createElement('div')
    zone.addEventListener('dragover', (e) => {
      e.preventDefault()
      ;(e as DragEvent).dataTransfer!.dropEffect = 'copy'
    })
    zone.addEventListener('drop', e => e.preventDefault())
    elsewhere = document.createElement('div')
    document.body.append(zone, elsewhere)
  })

  afterEach(() => {
    uninstall()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('cancels a stray drop so it cannot navigate the window', () => {
    const drop = dragEvent('drop')
    elsewhere.dispatchEvent(drop)

    expect(drop.defaultPrevented).toBe(true)
    expect(logInfo).toHaveBeenCalledWith('[drop] Ignored a drop outside a drop zone')
  })

  it('marks a stray dragover as not droppable', () => {
    const over = dragEvent('dragover')
    elsewhere.dispatchEvent(over)

    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer!.dropEffect).toBe('none')
  })

  it('leaves a drop zone that handles the drag itself alone', () => {
    const over = dragEvent('dragover')
    zone.dispatchEvent(over)
    const drop = dragEvent('drop')
    zone.dispatchEvent(drop)

    expect(over.dataTransfer!.dropEffect).toBe('copy')
    expect(logInfo).not.toHaveBeenCalled()
  })
})
