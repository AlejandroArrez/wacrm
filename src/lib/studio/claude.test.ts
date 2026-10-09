import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractJsonObject,
  generateStudioCopy,
  parseStudioBody,
  STUDIO_DEFAULT_MODEL,
  STUDIO_MAX_PROMPT_CHARS,
  studioModel,
} from './claude'

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"variantes":[],"nota":"x"}')).toEqual({ variantes: [], nota: 'x' })
  })
  it('strips code fences and prose', () => {
    const t = 'Aquí va:\n```json\n{"a":{"b":"c}"},"n":1}\n```\nListo.'
    expect(extractJsonObject(t)).toEqual({ a: { b: 'c}' }, n: 1 })
  })
  it('returns null on broken or missing JSON', () => {
    expect(extractJsonObject('sin json')).toBeNull()
    expect(extractJsonObject('{"a": ')).toBeNull()
    expect(extractJsonObject('[1,2]')).toBeNull()
  })
})

describe('parseStudioBody', () => {
  it('requires a prompt', () => {
    expect(parseStudioBody({})).toMatchObject({ ok: false, code: 'bad_request' })
    expect(parseStudioBody(null)).toMatchObject({ ok: false })
  })
  it('caps the prompt length', () => {
    expect(parseStudioBody({ prompt: 'x'.repeat(STUDIO_MAX_PROMPT_CHARS + 1) })).toMatchObject({ ok: false, code: 'too_large' })
  })
  it('accepts a base64 jpeg and rejects other types', () => {
    const ok = parseStudioBody({ prompt: 'hola', image: { media_type: 'image/jpeg', data: 'QUJD' } })
    expect(ok).toMatchObject({ ok: true, value: { prompt: 'hola', image: { media_type: 'image/jpeg' } } })
    expect(parseStudioBody({ prompt: 'hola', image: { media_type: 'image/gif', data: 'QUJD' } })).toMatchObject({ ok: false })
    expect(parseStudioBody({ prompt: 'hola', image: { media_type: 'image/png', data: '<script>' } })).toMatchObject({ ok: false })
  })
})

describe('studioModel', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('defaults and can be overridden', () => {
    vi.stubEnv('STUDIO_AI_MODEL', '')
    expect(studioModel()).toBe(STUDIO_DEFAULT_MODEL)
    vi.stubEnv('STUDIO_AI_MODEL', 'claude-opus-5')
    expect(studioModel()).toBe('claude-opus-5')
  })
})

describe('generateStudioCopy', () => {
  afterEach(() => vi.restoreAllMocks())
  it('sends system prompt, image and text, and parses the JSON reply', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"variantes":[{"enfoque":"A"}]}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      }), { status: 200 }),
    )
    const out = await generateStudioCopy({
      apiKey: 'k', model: 'm',
      request: { prompt: 'Escribe', image: { media_type: 'image/jpeg', data: 'QUJD' } },
    })
    expect(out.result).toEqual({ variantes: [{ enfoque: 'A' }] })
    expect(out.usage?.totalTokens).toBe(150)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('api.anthropic.com')
    const body = JSON.parse(String(opts.body))
    expect(body.model).toBe('m')
    expect(typeof body.system).toBe('string')
    expect(body.messages[0].content[0].type).toBe('image')
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'Escribe' })
  })
  it('flags invalid JSON but keeps the usage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'no es json' }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 }),
    )
    await expect(generateStudioCopy({ apiKey: 'k', model: 'm', request: { prompt: 'x', image: null } }))
      .rejects.toMatchObject({ code: 'invalid_json', usage: { totalTokens: 10 } })
  })
  it('maps a bad key to invalid_key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
    )
    await expect(generateStudioCopy({ apiKey: 'k', model: 'm', request: { prompt: 'x', image: null } }))
      .rejects.toMatchObject({ code: 'invalid_key' })
  })
})
