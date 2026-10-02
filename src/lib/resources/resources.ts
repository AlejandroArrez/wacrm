// ============================================================
// Resource library ("Recursos") — pure helpers.
//
// Approved images and videos advisors download for their own social
// media posts. Rows live in `resources` (migration 046); files in the
// public `resources` bucket, or behind an external link (Drive, etc.)
// for videos over the bucket cap. Everything here is pure so it can be
// unit-tested without Supabase.
// ============================================================

export const RESOURCE_KINDS = ['image', 'video'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export const RESOURCE_FORMATS = ['post', 'story', 'reel', 'other'] as const
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number]

/** Same closed list as the WordPress plugin and R13. */
export const RESOURCE_SEGMENTS = [
  'residente',
  'inversionista',
  'joven',
  'diaspora',
  'patrimonio',
] as const
export type ResourceSegment = (typeof RESOURCE_SEGMENTS)[number]

/** Bucket cap (migration 046). */
export const RESOURCE_MAX_BYTES = 50 * 1024 * 1024

/** MIME types the bucket accepts (migration 046). */
export const RESOURCE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const

export const TITLE_MAX = 120
export const CAPTION_MAX = 2200

export interface Resource {
  id: string
  account_id: string
  title: string
  caption: string | null
  kind: ResourceKind
  format: ResourceFormat
  model_slug: string | null
  segment: ResourceSegment | null
  file_url: string | null
  external_url: string | null
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  active: boolean
  created_at: string
}

/** 'image' / 'video' for an accepted MIME type, null otherwise. */
export function kindFromMime(mime: string | null | undefined): ResourceKind | null {
  const m = (mime ?? '').toLowerCase()
  if (!(RESOURCE_MIME_TYPES as readonly string[]).includes(m)) return null
  return m.startsWith('video/') ? 'video' : 'image'
}

/** Public object URL served by Supabase Storage. */
function isSupabaseObjectUrl(url: string): boolean {
  return /\/storage\/v1\/object\/public\//.test(url)
}

/**
 * Link that makes the browser save the file instead of opening it.
 * Supabase serves `Content-Disposition: attachment` when the URL
 * carries `?download=<name>`. External links are returned as-is (the
 * host decides). Null when the resource has no link at all.
 */
export function resourceDownloadUrl(
  r: Pick<Resource, 'file_url' | 'external_url' | 'file_name' | 'title'>,
): string | null {
  const file = (r.file_url ?? '').trim()
  if (file) {
    if (!isSupabaseObjectUrl(file)) return file
    const name = downloadFileName(r.file_name, r.title, file)
    const sep = file.includes('?') ? '&' : '?'
    return `${file}${sep}download=${encodeURIComponent(name)}`
  }
  const ext = (r.external_url ?? '').trim()
  return ext || null
}

/** True when the download leaves the app (opens in a new tab). */
export function isExternalResource(r: Pick<Resource, 'file_url' | 'external_url'>): boolean {
  return !(r.file_url ?? '').trim() && !!(r.external_url ?? '').trim()
}

/**
 * File name the advisor gets: the uploaded name when known, otherwise
 * the title plus the URL's extension.
 */
export function downloadFileName(
  fileName: string | null | undefined,
  title: string,
  url: string,
): string {
  const clean = (v: string) =>
    v.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  const given = clean(fileName ?? '')
  if (given) return given
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase()
  const base = clean(title) || 'recurso'
  return ext ? `${base}.${ext}` : base
}

/** 1536 → "1.5 KB", 52428800 → "50 MB". Empty string for null. */
export function humanFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10
  return `${rounded} ${units[i]}`
}

/** Filter value for "resources not tied to a model". */
export const GENERAL_MODEL = '__general'

export interface ResourceFilters {
  query: string
  kind: ResourceKind | ''
  format: ResourceFormat | ''
  model: string
  segment: ResourceSegment | ''
  /** Admins can include paused resources; advisors never see them. */
  includeInactive: boolean
}

export const EMPTY_FILTERS: ResourceFilters = {
  query: '',
  kind: '',
  format: '',
  model: '',
  segment: '',
  includeInactive: false,
}

/** Lower-case and strip accents so "diaspora" finds "Diáspora". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Does a resource pass the filters? Model "general" (`__general`)
 * matches resources with no model; segment and model filters let
 * general resources (no segment / no model) through only when the
 * filter is empty.
 */
export function matchesResourceFilters(r: Resource, f: ResourceFilters): boolean {
  if (!r.active && !f.includeInactive) return false
  if (f.kind && r.kind !== f.kind) return false
  if (f.format && r.format !== f.format) return false
  if (f.segment && r.segment !== f.segment) return false
  if (f.model === GENERAL_MODEL) {
    if (r.model_slug) return false
  } else if (f.model && r.model_slug !== f.model) {
    return false
  }
  const q = fold(f.query.trim())
  if (q) {
    const hay = fold(`${r.title} ${r.caption ?? ''} ${r.file_name ?? ''}`)
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false
  }
  return true
}
