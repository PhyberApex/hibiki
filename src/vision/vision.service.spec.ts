import type { VisionProviderConfig } from './vision.service'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenAICompatibleVisionProvider, createVisionService, MAX_VIBE_TAG_LENGTH, MAX_VIBE_TAGS, MAX_VISION_IMAGE_BYTES, MAX_VISION_RESPONSE_BYTES, normalizeAnalysis, OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL } from './vision.service'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  const MockAnthropic = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })) as jest.Mock & { APIError: typeof MockAPIError, AuthenticationError: typeof MockAPIError }
  MockAnthropic.APIError = MockAPIError
  MockAnthropic.AuthenticationError = class extends MockAPIError {}
  return { __esModule: true, default: MockAnthropic }
})

/** What a vision endpoint answers: `body` as a JSON `Response`. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('createVisionService', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-vision-'))
  const imagePath = join(tempRoot, 'map.png')
  writeFileSync(imagePath, Buffer.from('fake-png-bytes'))

  function withProviderConfig(config: VisionProviderConfig) {
    return createVisionService({
      getProviderConfig: async () => config,
    })
  }

  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns description and tags parsed from the Claude response', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: 'A stormy coastline at dusk.',
            tags: ['stormy', ' coastline ', 'dusk', ''],
          }),
        },
      ],
    })
    const service = withProviderConfig({ provider: 'claude', apiKey: 'sk-test' })
    const result = await service.analyzeImageVibe(imagePath)
    expect(result).toEqual({
      description: 'A stormy coastline at dusk.',
      tags: ['stormy', 'coastline', 'dusk'],
    })
  })

  it('sends the image as base64 with the media type derived from the extension', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: 'x',
            tags: ['a'],
          }),
        },
      ],
    })
    const service = withProviderConfig({ provider: 'claude', apiKey: 'sk-test' })
    await service.analyzeImageVibe(imagePath)
    const params = mockCreate.mock.calls[0]![0]
    const imageBlock = params.messages[0].content.find((b: { type: string }) => b.type === 'image')
    expect(imageBlock.source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: Buffer.from('fake-png-bytes').toString('base64'),
    })
  })

  it('rejects when the Claude API call fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'))
    const service = withProviderConfig({ provider: 'claude', apiKey: 'sk-test' })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow('boom')
  })

  it('rejects when the model refuses instead of returning an empty result', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'refusal', content: [] })
    const service = withProviderConfig({ provider: 'claude', apiKey: 'sk-test' })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow(/declined/i)
  })

  it('rejects when no Claude API key is configured without calling the API', async () => {
    const service = withProviderConfig({ provider: 'claude', apiKey: null })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow(/api key/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses an image over the size cap without reading it into a request (#785)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const bigPath = join(tempRoot, 'big.png')
    writeFileSync(bigPath, Buffer.alloc(2048))
    const service = createVisionService({
      getProviderConfig: async () => ({ provider: 'claude', apiKey: 'sk-test' }),
      maxImageBytes: 1024,
    })
    await expect(service.analyzeImageVibe(bigPath)).rejects.toThrow(/takes images up to 0\.0 MB/)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[vision]', expect.stringContaining('2048-byte image: over the 1024-byte limit'))
    warn.mockRestore()
  })

  it('caps images at a few MB by default (#785)', () => {
    expect(MAX_VISION_IMAGE_BYTES).toBeGreaterThanOrEqual(1024 * 1024)
    expect(MAX_VISION_IMAGE_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('rejects unsupported image formats without calling the API', async () => {
    const bmpPath = join(tempRoot, 'map.bmp')
    writeFileSync(bmpPath, 'x')
    const service = withProviderConfig({ provider: 'claude', apiKey: 'sk-test' })
    await expect(service.analyzeImageVibe(bmpPath)).rejects.toThrow(/unsupported/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('dispatches to the OpenAI-compatible provider without requiring a key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              description: 'x',
              tags: ['a'],
            }),
          },
        },
      ],
    }))
    const service = createVisionService({
      getProviderConfig: async () => ({
        provider: 'openai-compatible',
        apiKey: null,
        baseUrl: 'http://localhost:11434/v1',
        model: 'local-vision',
      }),
      createProvider: config => createOpenAICompatibleVisionProvider({ ...config, fetchImpl }),
    })
    const result = await service.analyzeImageVibe(imagePath)
    expect(result).toEqual({
      description: 'x',
      tags: ['a'],
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('createOpenAICompatibleVisionProvider', () => {
  const imageBuffer = Buffer.from('fake-png-bytes')

  const publicLookup = jest.fn().mockResolvedValue([
    { address: '104.18.6.192', family: 4 },
  ])

  function provider(overrides: Partial<{ apiKey: string | null, baseUrl: string, model: string }> = {}, fetchImpl = jest.fn(), lookupImpl = publicLookup) {
    return {
      fetchImpl,
      instance: createOpenAICompatibleVisionProvider({
        apiKey: overrides.apiKey,
        baseUrl: overrides.baseUrl ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
        model: overrides.model ?? OPENAI_COMPATIBLE_DEFAULT_MODEL,
        fetchImpl,
        lookupImpl,
      }),
    }
  }

  it('posts the image inline as a data URL and requests structured JSON output', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              description: 'A misty swamp.',
              tags: ['misty', 'swamp'],
            }),
          },
        },
      ],
    }))
    const { instance } = provider({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }, fetchImpl)

    const result = await instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })

    expect(result).toEqual({
      description: 'A misty swamp.',
      tags: ['misty', 'swamp'],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Authorization': 'Bearer sk-test', 'Content-Type': 'application/json' }),
      }),
    )
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.model).toBe('gpt-6-astra')
    expect(requestBody.response_format).toEqual(expect.objectContaining({ type: 'json_schema' }))
    const imagePart = requestBody.messages[0].content.find((p: { type: string }) => p.type === 'image_url')
    expect(imagePart.image_url.url).toBe(`data:image/png;base64,${imageBuffer.toString('base64')}`)
  })

  it('omits the Authorization header when no key is configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({ description: 'x', tags: [] }),
          },
        },
      ],
    }))
    const { instance } = provider({ apiKey: null }, fetchImpl)
    await instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('reports an HTTP error from the endpoint with a readable message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid_api_key',
    })
    const { instance } = provider({ apiKey: 'bad-key' }, fetchImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow(/HTTP 401/)
  })

  it('reports only the status code, never the error body, so a response cannot be read back through the UI or log', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Incorrect API key provided: sk-echoed-secret, ami-id: i-0abc',
    })
    const { instance } = provider({ apiKey: 'sk-echoed-secret' }, fetchImpl)
    const error = await instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' }).catch(err => err as Error)
    expect(error.message).toBe('The vision endpoint returned an error (HTTP 401).')
  })

  it('reports an unreachable endpoint by origin only, never path or credentials', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('fetch failed'))
    const { instance } = provider({ apiKey: 'sk-test', baseUrl: 'http://localhost:1/secret-path/v1' }, fetchImpl)
    const error = await instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' }).catch(err => err as Error)
    expect(error.message).toMatch(/couldn't reach/i)
    expect(error.message).toContain('http://localhost:1')
    expect(error.message).not.toContain('secret-path')
  })

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'https://evil.test/collect?x=',
    'https://api.openai.com/v1#',
    'http://box.lan/v1',
    'ftp://example.com/v1',
  ])('refuses %s without sending a request', async (baseUrl) => {
    const fetchImpl = jest.fn()
    const { instance } = provider({ apiKey: 'sk-test', baseUrl }, fetchImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not follow redirects, so the image cannot be bounced to an unchecked host', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 307, type: 'basic' })
    const { instance } = provider({ apiKey: 'sk-test' }, fetchImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow(/redirected the request/)
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
  })

  it('refuses a public-looking host that resolves to link-local space without sending a request', async () => {
    const fetchImpl = jest.fn()
    const lookupImpl = jest.fn().mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ])
    const { instance } = provider({ apiKey: 'sk-test', baseUrl: 'https://rebind.example/v1' }, fetchImpl, lookupImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow(/private, loopback or link-local/)
    expect(lookupImpl).toHaveBeenCalledWith('rebind.example')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a non-JSON model response with a readable message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      choices: [
        {
          message: { content: 'not json' },
        },
      ],
    }))
    const { instance } = provider({ apiKey: 'sk-test' }, fetchImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow(/couldn't understand/i)
  })

  it('reports a malformed (non-text) model response with a readable message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ choices: [] }))
    const { instance } = provider({ apiKey: 'sk-test' }, fetchImpl)
    await expect(instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })).rejects.toThrow(/couldn't understand/i)
  })

  it('trims a trailing slash from a custom Base URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({ description: 'x', tags: [] }),
          },
        },
      ],
    }))
    const { instance } = provider({ apiKey: 'sk-test', baseUrl: 'http://localhost:11434/v1/' }, fetchImpl)
    await instance.analyzeImage({ data: imageBuffer, mediaType: 'image/png' })
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything())
  })
})

describe('normalizeAnalysis (#785)', () => {
  it('keeps at most MAX_VIBE_TAGS tags', () => {
    const tags = Array.from({ length: 10_000 }, (_, i) => `tag ${i}`)
    expect(normalizeAnalysis({ description: 'x', tags }).tags).toEqual(tags.slice(0, MAX_VIBE_TAGS))
  })

  it('drops tags longer than MAX_VIBE_TAG_LENGTH', () => {
    const long = 'a'.repeat(MAX_VIBE_TAG_LENGTH + 1)
    const edge = 'b'.repeat(MAX_VIBE_TAG_LENGTH)
    expect(normalizeAnalysis({
      description: 'x',
      tags: [long, edge, 'stormy'],
    }).tags).toEqual([edge, 'stormy'])
  })

  it('cuts an overlong description', () => {
    expect(normalizeAnalysis({
      description: 'x'.repeat(100_000),
      tags: [],
    }).description.length).toBeLessThanOrEqual(1000)
  })
})

describe('openAI-compatible response cap (#785)', () => {
  it('refuses an answer larger than MAX_VISION_RESPONSE_BYTES', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('x'.repeat(MAX_VISION_RESPONSE_BYTES + 1), { status: 200 }))
    const instance = createOpenAICompatibleVisionProvider({
      apiKey: 'sk-test',
      baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
      model: OPENAI_COMPATIBLE_DEFAULT_MODEL,
      fetchImpl,
      lookupImpl: jest.fn().mockResolvedValue([
        { address: '104.18.6.192', family: 4 },
      ]),
    })
    await expect(instance.analyzeImage({
      data: Buffer.from('x'),
      mediaType: 'image/png',
    })).rejects.toThrow(/larger than \d+ bytes/)
  })
})
