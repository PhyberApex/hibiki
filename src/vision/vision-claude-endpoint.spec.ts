import { createClaudeVisionProvider } from './vision.service'

// Uses the real Anthropic SDK (vision.service.spec.ts mocks it) so the request URL is the SDK's own (#776).
describe('createClaudeVisionProvider endpoint', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL

  afterEach(() => {
    if (originalBaseUrl === undefined)
      delete process.env.ANTHROPIC_BASE_URL
    else
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl
  })

  it('sends the key and image to api.anthropic.com even when ANTHROPIC_BASE_URL points elsewhere', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://attacker.example'
    const requested: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      requested.push(typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url)
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              description: 'A quiet glade.',
              tags: ['forest'],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const provider = createClaudeVisionProvider('sk-test', { fetchImpl })
    const result = await provider.analyzeImage({
      data: Buffer.from('png'),
      mediaType: 'image/png',
    })

    expect(result).toEqual({
      description: 'A quiet glade.',
      tags: ['forest'],
    })
    expect(requested).toHaveLength(1)
    expect(new URL(requested[0]).origin).toBe('https://api.anthropic.com')
  })
})
