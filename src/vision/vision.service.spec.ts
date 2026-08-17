import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVisionService } from './vision.service'

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

describe('createVisionService', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-vision-'))
  const imagePath = join(tempRoot, 'map.png')
  writeFileSync(imagePath, Buffer.from('fake-png-bytes'))

  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns description and tags parsed from the model response', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ description: 'A stormy coastline at dusk.', tags: ['stormy', ' coastline ', 'dusk', ''] }) }],
    })
    const service = createVisionService({ getApiKey: async () => 'sk-test' })
    const result = await service.analyzeImageVibe(imagePath)
    expect(result).toEqual({ description: 'A stormy coastline at dusk.', tags: ['stormy', 'coastline', 'dusk'] })
  })

  it('sends the image as base64 with the media type derived from the extension', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ description: 'x', tags: ['a'] }) }],
    })
    const service = createVisionService({ getApiKey: async () => 'sk-test' })
    await service.analyzeImageVibe(imagePath)
    const params = mockCreate.mock.calls[0]![0]
    const imageBlock = params.messages[0].content.find((b: { type: string }) => b.type === 'image')
    expect(imageBlock.source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: Buffer.from('fake-png-bytes').toString('base64'),
    })
  })

  it('rejects when the API call fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'))
    const service = createVisionService({ getApiKey: async () => 'sk-test' })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow('boom')
  })

  it('rejects when the model refuses instead of returning an empty result', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'refusal', content: [] })
    const service = createVisionService({ getApiKey: async () => 'sk-test' })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow(/declined/i)
  })

  it('rejects when no API key is configured without calling the API', async () => {
    const service = createVisionService({ getApiKey: async () => null })
    await expect(service.analyzeImageVibe(imagePath)).rejects.toThrow(/api key/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects unsupported image formats without calling the API', async () => {
    const bmpPath = join(tempRoot, 'map.bmp')
    writeFileSync(bmpPath, 'x')
    const service = createVisionService({ getApiKey: async () => 'sk-test' })
    await expect(service.analyzeImageVibe(bmpPath)).rejects.toThrow(/unsupported/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
