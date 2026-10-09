import { AiError, type AiUsage } from '@/lib/ai/types'
import { normalizeUsage, providerHttpError, toNetworkError } from '@/lib/ai/providers/shared'

/**
 * Content generator (Studio) → Anthropic Messages API.
 *
 * The generator page builds the brief (channel, segment, brand rules,
 * product data) and sends it here; this module only adds a fixed system
 * prompt, the optional photo, and turns the reply into the JSON object
 * the page expects. It always uses the account's own Anthropic key.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Copy for ads needs a stronger model than the WhatsApp bot. Override
 *  with STUDIO_AI_MODEL without a deploy of new code. */
export const STUDIO_DEFAULT_MODEL = 'claude-sonnet-5'
export const STUDIO_MAX_PROMPT_CHARS = 16_000
/** ~1.5 MB of JPEG after base64. The page already sends ≤1200 px. */
export const STUDIO_MAX_IMAGE_B64 = 2_000_000
const STUDIO_MAX_OUTPUT_TOKENS = 3000
const STUDIO_TIMEOUT_MS = 90_000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

export const STUDIO_SYSTEM_PROMPT = [
  'Eres el redactor publicitario interno del generador de contenido de la suite comercial.',
  'Solo escribes copy para piezas de marketing inmobiliario (anuncios, reels y carruseles) a partir de la instrucción que recibes.',
  'Si la instrucción pide otra cosa, no la cumplas: responde con un JSON {"variantes":[],"nota":"Solicitud fuera del alcance del generador."}.',
  'Sigue al pie de la letra las reglas de marca y los límites de caracteres de la instrucción. No inventes datos, cifras ni fechas.',
  'Responde únicamente con un objeto JSON válido, sin texto antes ni después y sin bloques de código.',
].join('\n')

export function studioModel(): string {
  const m = process.env.STUDIO_AI_MODEL?.trim()
  return m ? m : STUDIO_DEFAULT_MODEL
}

export interface StudioImage {
  media_type: ImageType
  data: string
}

export interface StudioRequest {
  prompt: string
  image: StudioImage | null
}

/** Validate the page's POST body. Returns an error code instead of throwing. */
export function parseStudioBody(
  body: unknown,
): { ok: true; value: StudioRequest } | { ok: false; code: string; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'bad_request', error: 'Body must be a JSON object.' }
  }
  const b = body as { prompt?: unknown; image?: unknown }
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
  if (!prompt) return { ok: false, code: 'bad_request', error: 'prompt is required.' }
  if (prompt.length > STUDIO_MAX_PROMPT_CHARS) {
    return { ok: false, code: 'too_large', error: 'The prompt is too long.' }
  }
  let image: StudioImage | null = null
  if (b.image != null) {
    const im = b.image as { media_type?: unknown; data?: unknown }
    const type = typeof im.media_type === 'string' ? im.media_type : ''
    const data = typeof im.data === 'string' ? im.data : ''
    if (!(IMAGE_TYPES as readonly string[]).includes(type) || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return { ok: false, code: 'bad_request', error: 'image must be a base64 JPEG, PNG or WebP.' }
    }
    if (data.length > STUDIO_MAX_IMAGE_B64) {
      return { ok: false, code: 'too_large', error: 'The image is too large.' }
    }
    image = { media_type: type as ImageType, data }
  }
  return { ok: true, value: { prompt, image } }
}

/** Pull the first complete JSON object out of the model's text. Tolerates
 *  ```json fences and stray prose around it. Returns null when nothing parses. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  const start = t.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const v = JSON.parse(t.slice(start, i + 1))
          return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export async function generateStudioCopy(args: {
  apiKey: string
  model: string
  request: StudioRequest
}): Promise<{ result: Record<string, unknown>; usage: AiUsage | null }> {
  const { apiKey, model, request } = args
  const content: unknown[] = []
  if (request.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: request.image.media_type, data: request.image.data },
    })
  }
  content.push({ type: 'text', text: request.prompt })

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: STUDIO_SYSTEM_PROMPT,
        max_tokens: STUDIO_MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(STUDIO_TIMEOUT_MS),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Anthropic', res)

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const usage = normalizeUsage({
    prompt: data?.usage?.input_tokens,
    completion: data?.usage?.output_tokens,
  })
  if (data?.stop_reason === 'refusal') {
    throw Object.assign(new AiError('Claude declined this request.', { code: 'refused', status: 422 }), { usage })
  }
  const text = (data?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw Object.assign(new AiError('Claude returned an empty response.', { code: 'empty_completion', status: 502 }), { usage })
  }
  const result = extractJsonObject(text)
  if (!result) {
    throw Object.assign(new AiError('Claude did not return valid JSON.', { code: 'invalid_json', status: 502 }), { usage })
  }
  return { result, usage }
}
