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

const MEDIA_TYPES_BY_EXTENSION: Record<string, VisionImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const CLAUDE_MODEL = 'claude-opus-5'

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

export function resolveImageMediaType(imagePath: string): VisionImageMediaType | null {
  return MEDIA_TYPES_BY_EXTENSION[extname(imagePath).toLowerCase()] ?? null
}

export interface VisionServiceOptions {
  getApiKey: () => Promise<string | null>
  createProvider?: (apiKey: string) => VisionProvider
}

export function createVisionService(options: VisionServiceOptions) {
  const createProvider = options.createProvider ?? createClaudeVisionProvider

  return {
    async analyzeImageVibe(imagePath: string): Promise<VibeAnalysis> {
      const apiKey = (await options.getApiKey())?.trim()
      if (!apiKey)
        throw new Error('Vision API key is not configured. Add it in Settings to use Vision to Vibe.')
      const mediaType = resolveImageMediaType(imagePath)
      if (!mediaType)
        throw new Error('Unsupported image format. Use a PNG, JPEG, GIF, or WebP image.')
      const data = await readFile(imagePath)
      return createProvider(apiKey).analyzeImage({ data, mediaType })
    },
  }
}

export type VisionService = ReturnType<typeof createVisionService>
