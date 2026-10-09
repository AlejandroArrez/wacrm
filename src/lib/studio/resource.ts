import { RESOURCE_SEGMENTS, TITLE_MAX, type ResourceSegment } from '@/lib/resources/resources'

/**
 * Content generator → Resources library: validation for the "Guardar"
 * button. The page sends one rendered JPEG plus the piece's metadata;
 * the route uploads it to the public `resources` bucket and creates the
 * row advisors see in Recursos.
 */

/** Decoded JPEG cap. Vercel rejects request bodies over 4.5 MB, and
 *  base64 adds a third, so 3 MB of image is the safe ceiling. */
export const STUDIO_RESOURCE_MAX_BYTES = 3 * 1024 * 1024

export interface StudioResourceInput {
  bytes: Buffer
  fileName: string
  title: string
  format: 'post' | 'story'
  segment: ResourceSegment | null
  modelSlug: string | null
}

export function parseStudioResource(
  body: unknown,
): { ok: true; value: StudioResourceInput } | { ok: false; code: string; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, code: 'bad_request', error: 'Body must be a JSON object.' }
  const b = body as Record<string, unknown>

  const image = typeof b.image === 'string' ? b.image : ''
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return { ok: false, code: 'bad_request', error: 'image must be a base64 JPEG.' }
  }
  if (image.length > Math.ceil((STUDIO_RESOURCE_MAX_BYTES * 4) / 3) + 4) {
    return { ok: false, code: 'too_large', error: 'The image is too large.' }
  }
  const bytes = Buffer.from(image, 'base64')
  // JPEG magic number: FF D8 FF.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, code: 'bad_request', error: 'image must be a JPEG.' }
  }

  const rawName = typeof b.file_name === 'string' ? b.file_name.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,196}\.jpg$/.test(rawName)) {
    return { ok: false, code: 'bad_request', error: 'file_name must be a .jpg name with letters, numbers, dot, dash or underscore.' }
  }

  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
  if (!title) return { ok: false, code: 'bad_request', error: 'title is required.' }

  const format = b.format === 'story' ? 'story' : b.format === 'post' ? 'post' : null
  if (!format) return { ok: false, code: 'bad_request', error: "format must be 'post' or 'story'." }

  const segment =
    typeof b.segment === 'string' && (RESOURCE_SEGMENTS as readonly string[]).includes(b.segment)
      ? (b.segment as ResourceSegment)
      : null
  const modelSlug =
    typeof b.model_slug === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(b.model_slug) ? b.model_slug : null

  return { ok: true, value: { bytes, fileName: rawName, title, format, segment, modelSlug } }
}

/** Same account-scoped layout the rest of the app uses
 *  (`account-<id>/…`, see lib/storage/upload-media), under `generador/`. */
export function studioResourcePath(accountId: string, fileName: string, now = Date.now()): string {
  const base = fileName.replace(/\.jpg$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'pieza'
  return `account-${accountId}/generador/${now}-${base}.jpg`
}
