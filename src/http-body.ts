/** Thrown by `readBoundedText` when a response body is larger than its cap. */
export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Response body is larger than ${maxBytes} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

/** The minimum of a fetch `Response` that `readBoundedText` reads. */
export interface BoundedResponse {
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}

/**
 * The response body as UTF-8 text, refusing it once it passes `maxBytes`: up
 * front from a declared `Content-Length`, else as soon as the streamed bytes
 * do (#784, #785). `response.json()` has no bound at all, and a timeout only
 * bounds how long a server may keep sending, not how much.
 */
export async function readBoundedText(response: BoundedResponse, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new ResponseTooLargeError(maxBytes)
  }
  if (!response.body)
    return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ResponseTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf-8')
}
