import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

export interface VibeAnalysis {
  description: string
  tags: string[]
}

export type VisionImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export interface VisionImage {
  data: Buffer
  mediaType: VisionImageMediaType
}

/** A vision-capable model backend. Kept provider-agnostic so a second provider can slot in without touching the IPC surface. */
export interface VisionProvider {
  analyzeImage: (image: VisionImage) => Promise<VibeAnalysis>
}

export type VisionProviderId = 'claude' | 'openai-compatible'

/** The selected Vision Provider plus whatever it needs to run an analysis. `baseUrl`/`model` only matter for `openai-compatible`. */
export interface VisionProviderConfig {
  provider: VisionProviderId
  apiKey: string | null
  baseUrl?: string
  model?: string
}

const MEDIA_TYPES_BY_EXTENSION: Record<string, VisionImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const CLAUDE_MODEL = 'claude-opus-5'

export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/** OpenAI's flagship vision-capable model per their current docs, pinned the same way `CLAUDE_MODEL` is. */
export const OPENAI_COMPATIBLE_DEFAULT_MODEL = 'gpt-6-astra'

const VIBE_PROMPT = `You are helping a tabletop game master pick background music and ambient soundscapes for the scene shown in this image.
Describe the scene's atmosphere in one or two sentences, then list 5 to 10 short free-form tags capturing its mood, setting, weather, and time of day (for example "stormy", "candlelit tavern", "eerie forest", "night", "tense").
Tags should be lowercase, one to three words each, and useful for matching against a sound library.`

const VIBE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'One or two sentences describing the atmosphere of the scene.' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short lowercase tags for mood, setting, weather, and time of day.',
    },
  },
  required: ['description', 'tags'],
  additionalProperties: false,
} as const

function normalizeAnalysis(raw: unknown): VibeAnalysis {
  const candidate = raw as Partial<VibeAnalysis> | null
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''
  const tags = Array.isArray(candidate?.tags)
    ? candidate.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(t => t.length > 0)
    : []
  return { description, tags }
}

export function createClaudeVisionProvider(apiKey: string): VisionProvider {
  const client = new Anthropic({ apiKey })
  return {
    async analyzeImage(image) {
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: VIBE_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } },
            { type: 'text', text: VIBE_PROMPT },
          ],
        }],
      })
      if (response.stop_reason === 'refusal')
        throw new Error('The vision model declined to analyze this image.')
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')
      return normalizeAnalysis(JSON.parse(text))
    },
  }
}

export interface OpenAICompatibleProviderOptions {
  apiKey?: string | null
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}

/** Speaks the OpenAI Chat Completions wire format, so it reaches OpenAI itself plus any compatible gateway or local server. */
export function createOpenAICompatibleVisionProvider(options: OpenAICompatibleProviderOptions): VisionProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`

  return {
    async analyzeImage(image) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (options.apiKey)
        headers.Authorization = `Bearer ${options.apiKey}`

      const requestBody = {
        model: options.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: VIBE_PROMPT },
            { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data.toString('base64')}` } },
          ],
        }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'vibe_analysis', schema: VIBE_SCHEMA, strict: true },
        },
      }

      let response: Response
      try {
        response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(requestBody) })
      }
      catch {
        throw new Error(`Couldn't reach the vision endpoint at ${options.baseUrl}. Check the Base URL and that the server is running.`)
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`The vision endpoint returned an error (HTTP ${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`)
      }

      const unreadable = new Error('The vision endpoint returned a response Hibiki couldn\'t understand.')

      let payload: unknown
      try {
        payload = await response.json()
      }
      catch {
        throw unreadable
      }

      const content = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
      if (typeof content !== 'string')
        throw unreadable

      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      }
      catch {
        throw unreadable
      }

      return normalizeAnalysis(parsed)
    },
  }
}

export function resolveImageMediaType(imagePath: string): VisionImageMediaType | null {
  return MEDIA_TYPES_BY_EXTENSION[extname(imagePath).toLowerCase()] ?? null
}

function defaultCreateProvider(config: VisionProviderConfig): VisionProvider {
  if (config.provider === 'openai-compatible') {
    return createOpenAICompatibleVisionProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
      model: config.model ?? OPENAI_COMPATIBLE_DEFAULT_MODEL,
    })
  }
  return createClaudeVisionProvider(config.apiKey ?? '')
}

export interface VisionServiceOptions {
  getProviderConfig: () => Promise<VisionProviderConfig>
  createProvider?: (config: VisionProviderConfig) => VisionProvider
}

export function createVisionService(options: VisionServiceOptions) {
  const createProvider = options.createProvider ?? defaultCreateProvider

  return {
    async analyzeImageVibe(imagePath: string): Promise<VibeAnalysis> {
      const providerConfig = await options.getProviderConfig()
      if (providerConfig.provider === 'claude' && !providerConfig.apiKey?.trim())
        throw new Error('Vision API key is not configured. Add it in Settings to use Vision to Vibe.')
      const mediaType = resolveImageMediaType(imagePath)
      if (!mediaType)
        throw new Error('Unsupported image format. Use a PNG, JPEG, GIF, or WebP image.')
      const data = await readFile(imagePath)
      return createProvider(providerConfig).analyzeImage({ data, mediaType })
    },
  }
}

export type VisionService = ReturnType<typeof createVisionService>
