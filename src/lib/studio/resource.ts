import {
  RESOURCE_MAX_BYTES,
  RESOURCE_SEGMENTS,
  TITLE_MAX,
  type ResourceSegment,
} from '@/lib/resources/resources'

/**
 * Content generator → Resources library: validation for the "Guardar"
 * buttons. Two paths:
 *
 *  - Images (ads, carousel slides): the page sends one rendered JPEG as
 *    base64 and the route uploads it.
 *  - Videos (reels): too big for a Vercel request body, so the page asks
 *    for a signed upload URL, uploads the MP4 straight to Storage, then
 *    asks the route to register it.
 *
 * Either way the row lands in `resources`, the library advisors see.
 */

/** Decoded JPEG cap. Vercel rejects request bodies over 4.5 MB, and
 *  base64 adds a third, so 3 MB of image is the safe ceiling. */
export const STUDIO_RESOURCE_MAX_BYTES = 3 * 1024 * 1024

/** Reels go straight to Storage: the bucket cap (migration 046) applies. */
export const STUDIO_VIDEO_MAX_BYTES = RESOURCE_MAX_BYTES

export const STUDIO_IMAGE_FORMATS = ['post', 'story'] as const
export type StudioImageFormat = (typeof STUDIO_IMAGE_FORMATS)[number]

type Fail = { ok: false; code: string; error: string }
const fail = (code: string, error: string): Fail => ({ ok: false, code, error })

interface StudioMeta {
  fileName: string
  title: string
  segment: ResourceSegment | null
  modelSlug: string | null
}

export interface StudioResourceInput extends StudioMeta {
  bytes: Buffer
  format: StudioImageFormat
}

export interface StudioVideoSign {
  fileName: string
  size: number
}

export interface StudioVideoCommit extends StudioMeta {
  path: string
}

const JPG_NAME = /^[A-Za-z0-9._-]{1,196}\.jpg$/
const MP4_NAME = /^[A-Za-z0-9._-]{1,196}\.mp4$/

function parseMeta(b: Record<string, unknown>, nameRe: RegExp, ext: string): { ok: true; value: StudioMeta } | Fail {
  const fileName = typeof b.file_name === 'string' ? b.file_name.trim() : ''
  if (!nameRe.test(fileName)) {
    return fail('bad_request', `file_name must be a ${ext} name with letters, numbers, dot, dash or underscore.`)
  }
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
  if (!title) return fail('bad_request', 'title is required.')
  const segment =
    typeof b.segment === 'string' && (RESOURCE_SEGMENTS as readonly string[]).includes(b.segment)
      ? (b.segment as ResourceSegment)
      : null
  const modelSlug =
    typeof b.model_slug === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(b.model_slug) ? b.model_slug : null
  return { ok: true, value: { fileName, title, segment, modelSlug } }
}

const asObject = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null

/** Image piece (ad format or carousel slide), sent inline as base64. */
export function parseStudioResource(body: unknown): { ok: true; value: StudioResourceInput } | Fail {
  const b = asObject(body)
  if (!b) return fail('bad_request', 'Body must be a JSON object.')

  const image = typeof b.image === 'string' ? b.image : ''
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) return fail('bad_request', 'image must be a base64 JPEG.')
  if (image.length > Math.ceil((STUDIO_RESOURCE_MAX_BYTES * 4) / 3) + 4) return fail('too_large', 'The image is too large.')
  const bytes = Buffer.from(image, 'base64')
  // JPEG magic number: FF D8 FF.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return fail('bad_request', 'image must be a JPEG.')
  }

  const meta = parseMeta(b, JPG_NAME, '.jpg')
  if (!meta.ok) return meta

  const format = (STUDIO_IMAGE_FORMATS as readonly unknown[]).includes(b.format) ? (b.format as StudioImageFormat) : null
  if (!format) return fail('bad_request', "format must be 'post' or 'story'.")

  return { ok: true, value: { ...meta.value, bytes, format } }
}

/** Step 1 for a reel: name and size, to hand out a signed upload URL. */
export function parseStudioVideoSign(body: unknown): { ok: true; value: StudioVideoSign } | Fail {
  const b = asObject(body)
  if (!b) return fail('bad_request', 'Body must be a JSON object.')
  const fileName = typeof b.file_name === 'string' ? b.file_name.trim() : ''
  if (!MP4_NAME.test(fileName)) return fail('bad_request', 'file_name must be an .mp4 name with letters, numbers, dot, dash or underscore.')
  const size = typeof b.size === 'number' && Number.isFinite(b.size) ? Math.floor(b.size) : 0
  if (size <= 0) return fail('bad_request', 'size is required.')
  if (size > STUDIO_VIDEO_MAX_BYTES) return fail('too_large', 'The video is too large.')
  return { ok: true, value: { fileName, size } }
}

/** Step 2 for a reel: the uploaded path plus the library metadata. */
export function parseStudioVideoCommit(body: unknown): { ok: true; value: StudioVideoCommit } | Fail {
  const b = asObject(body)
  if (!b) return fail('bad_request', 'Body must be a JSON object.')
  const path = typeof b.path === 'string' ? b.path.trim() : ''
  if (!path) return fail('bad_request', 'path is required.')
  const meta = parseMeta(b, MP4_NAME, '.mp4')
  if (!meta.ok) return meta
  return { ok: true, value: { ...meta.value, path } }
}

const baseOf = (fileName: string) =>
  fileName.replace(/\.(jpg|mp4)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'pieza'
const extOf = (fileName: string) => (/\.mp4$/i.test(fileName) ? 'mp4' : 'jpg')

/** Same account-scoped layout the rest of the app uses
 *  (`account-<id>/…`, see lib/storage/upload-media), under `generador/`. */
export function studioResourcePath(accountId: string, fileName: string, now = Date.now()): string {
  return `account-${accountId}/generador/${now}-${baseOf(fileName)}.${extOf(fileName)}`
}

/** True when `path` is one this account's sign step could have issued
 *  for `fileName` — so a commit can't register someone else's object. */
export function isStudioPathFor(accountId: string, fileName: string, path: string): boolean {
  const prefix = `account-${accountId}/generador/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return new RegExp(`^\\d{10,16}-${baseOf(fileName)}\\.${extOf(fileName)}$`).test(rest)
}
