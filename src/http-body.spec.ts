import { readBoundedText, ResponseTooLargeError } from './http-body'

/** A Response whose body arrives in `chunks` and declares no Content-Length. */
function streamedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }))
}

describe('readBoundedText (#785)', () => {
  it('reads a body within the cap', async () => {
    await expect(readBoundedText(new Response('{"ok":true}'), 100)).resolves.toBe('{"ok":true}')
    await expect(readBoundedText(streamedResponse(['ab', 'cd']), 4)).resolves.toBe('abcd')
  })

  it('refuses a declared Content-Length over the cap before reading', async () => {
    const response = new Response('x'.repeat(10), {
      headers: { 'Content-Length': '10' },
    })
    await expect(readBoundedText(response, 5)).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('refuses a streamed body once it passes the cap', async () => {
    await expect(readBoundedText(streamedResponse(['abc', 'def']), 5)).rejects.toThrow('larger than 5 bytes')
  })

  it('reads a missing body as empty', async () => {
    await expect(readBoundedText({
      headers: new Headers(),
      body: null,
    }, 5)).resolves.toBe('')
  })
})
