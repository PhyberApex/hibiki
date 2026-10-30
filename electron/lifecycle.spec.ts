import { createUncaughtExceptionHandler, exitWithError } from './lifecycle'

const spies = {
  error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
}

afterEach(() => jest.clearAllMocks())

describe('exitWithError', () => {
  it('logs the failure, tears down, then exits with code 1', async () => {
    const order: string[] = []
    const app = {
      exit: jest.fn(() => order.push('exit')),
    }
    const teardown = jest.fn(async () => {
      order.push('teardown')
    })
    const err = new Error('boot failed')

    await exitWithError({ app, teardown }, 'Failed to start embedded app', err)

    expect(order).toEqual(['teardown', 'exit'])
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(spies.error).toHaveBeenCalledWith('[app]', 'Failed to start embedded app', err)
  })

  it('still exits with code 1 when teardown rejects', async () => {
    const app = {
      exit: jest.fn(),
    }
    const teardown = jest.fn().mockRejectedValue(new Error('hung'))

    await exitWithError({ app, teardown }, 'web-dist/index.html not found')

    expect(app.exit).toHaveBeenCalledWith(1)
    expect(spies.error).toHaveBeenCalledWith('[app]', 'web-dist/index.html not found')
  })
})

function fakeDialog() {
  let resolveBox: () => void = () => {}
  return {
    showErrorBox: jest.fn(),
    showMessageBox: jest.fn(() => new Promise<{ response: number }>((resolve) => {
      resolveBox = () => resolve({ response: 0 })
    })),
    closeBox: () => resolveBox(),
  }
}

describe('createUncaughtExceptionHandler', () => {
  it('shows the blocking error box before the app is ready', () => {
    const dialog = fakeDialog()
    const handler = createUncaughtExceptionHandler({
      dialog,
      isReady: () => false,
      getWindow: () => null,
    })
    const err = new Error('early')

    handler(err)

    expect(spies.error).toHaveBeenCalledWith('[app]', 'Uncaught exception in the main process:', err)
    expect(dialog.showErrorBox).toHaveBeenCalledWith('Hibiki ran into an unexpected error', expect.stringContaining(err.stack!))
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('surfaces a non-blocking message box mid-session, attached to the main window', () => {
    const dialog = fakeDialog()
    const win = {
      isDestroyed: () => false,
    }
    const handler = createUncaughtExceptionHandler({
      dialog,
      isReady: () => true,
      getWindow: () => win,
    })

    handler(new Error('mid-session'))

    expect(dialog.showErrorBox).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
      type: 'error',
      message: 'Hibiki ran into an unexpected error',
    }))
  })

  it('opens the message box without a parent when the main window is gone', () => {
    const dialog = fakeDialog()
    const handler = createUncaughtExceptionHandler({
      dialog,
      isReady: () => true,
      getWindow: () => ({
        isDestroyed: () => true,
      }),
    })

    handler(new Error('no window'))

    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    expect(dialog.showMessageBox.mock.calls[0]).toHaveLength(1)
  })

  it('keeps one message box open at a time and logs every exception', async () => {
    const dialog = fakeDialog()
    const handler = createUncaughtExceptionHandler({
      dialog,
      isReady: () => true,
      getWindow: () => null,
    })

    handler(new Error('first'))
    handler(new Error('second'))
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(2)

    dialog.closeBox()
    await new Promise(resolve => setImmediate(resolve))
    handler(new Error('third'))
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('logs a message box that fails to open and lets the next exception try again', async () => {
    const dialog = fakeDialog()
    dialog.showMessageBox.mockRejectedValueOnce(new Error('no display'))
    const handler = createUncaughtExceptionHandler({
      dialog,
      isReady: () => true,
      getWindow: () => null,
    })

    handler(new Error('first'))
    await new Promise(resolve => setImmediate(resolve))

    expect(spies.warn).toHaveBeenCalledWith('[app]', 'Could not show the error dialog', expect.any(Error))
    handler(new Error('second'))
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
  })
})
