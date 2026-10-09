import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  isStudioPathFor,
  parseStudioResource,
  parseStudioVideoCommit,
  studioResourcePath,
  STUDIO_VIDEO_MAX_BYTES,
} from '@/lib/studio/resource'

const BUCKET = 'resources'

/**
 * POST /api/studio/resource  (admin+)
 *
 * Saves one piece from the content generator into Recursos, the library
 * advisors download from. The page blocks pieces with red brand-check
 * errors before calling this.
 *
 * Two bodies:
 *  - Image (ad format or carousel slide):
 *      { image (base64 JPEG), file_name, title, format, segment?, model_slug? }
 *    Validated, uploaded and registered here.
 *  - Reel already uploaded through /api/studio/resource/upload:
 *      { path, file_name (.mp4), title, segment?, model_slug? }
 *    Checked against Storage and registered here.
 *
 * Same file name = same piece ID, version and format → not duplicated.
 * Returns { id, duplicate }.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-res:${userId}`, RATE_LIMITS.studioResource)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const isVideo = !!body && typeof body === 'object' && 'path' in body
    const storage = supabaseAdmin().storage.from(BUCKET)

    if (isVideo) {
      const parsed = parseStudioVideoCommit(body)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 })
      const v = parsed.value
      if (!isStudioPathFor(accountId, v.fileName, v.path)) {
        return NextResponse.json({ error: 'path does not match this piece', code: 'bad_request' }, { status: 400 })
      }

      const dup = await findExisting(supabase, accountId, v.fileName)
      if (dup.error) return dup.error
      if (dup.id) {
        // A second commit of the same reel: drop the extra upload.
        await storage.remove([v.path]).catch(() => undefined)
        return NextResponse.json({ id: dup.id, duplicate: true })
      }

      const { data: info, error: infoErr } = await storage.info(v.path)
      if (infoErr || !info) {
        return NextResponse.json({ error: 'The video was not uploaded', code: 'not_uploaded' }, { status: 400 })
      }
      const meta = info as { size?: number; contentType?: string }
      const size = typeof meta.size === 'number' ? meta.size : 0
      if (size <= 0 || size > STUDIO_VIDEO_MAX_BYTES || (meta.contentType && meta.contentType !== 'video/mp4')) {
        await storage.remove([v.path]).catch(() => undefined)
        return NextResponse.json({ error: 'The uploaded file is not a valid video', code: 'bad_upload' }, { status: 400 })
      }

      const { data: { publicUrl } } = storage.getPublicUrl(v.path)
      return insertRow(supabase, storage, v.path, {
        account_id: accountId,
        title: v.title,
        kind: 'video',
        format: 'reel',
        model_slug: v.modelSlug,
        segment: v.segment,
        file_url: publicUrl,
        file_name: v.fileName,
        file_size: size,
        mime_type: 'video/mp4',
      })
    }

    const parsed = parseStudioResource(body)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, code: parsed.code },
        { status: parsed.code === 'too_large' ? 413 : 400 },
      )
    }
    const p = parsed.value

    const dup = await findExisting(supabase, accountId, p.fileName)
    if (dup.error) return dup.error
    if (dup.id) return NextResponse.json({ id: dup.id, duplicate: true })

    const path = studioResourcePath(accountId, p.fileName)
    const { error: upErr } = await storage.upload(path, p.bytes, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    })
    if (upErr) {
      console.error('[studio/resource] upload error:', upErr)
      return NextResponse.json({ error: 'Upload failed', code: 'upload_failed' }, { status: 502 })
    }
    const { data: { publicUrl } } = storage.getPublicUrl(path)

    return insertRow(supabase, storage, path, {
      account_id: accountId,
      title: p.title,
      kind: 'image',
      format: p.format,
      model_slug: p.modelSlug,
      segment: p.segment,
      file_url: publicUrl,
      file_name: p.fileName,
      file_size: p.bytes.length,
      mime_type: 'image/jpeg',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type Session = Awaited<ReturnType<typeof requireRole>>['supabase']
type Bucket = ReturnType<ReturnType<typeof supabaseAdmin>['storage']['from']>

async function findExisting(
  supabase: Session,
  accountId: string,
  fileName: string,
): Promise<{ id?: string; error?: NextResponse }> {
  const { data, error } = await supabase
    .from('resources')
    .select('id')
    .eq('account_id', accountId)
    .eq('file_name', fileName)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[studio/resource] lookup error:', error)
    return { error: NextResponse.json({ error: 'Failed to check the library' }, { status: 500 }) }
  }
  return { id: data?.id as string | undefined }
}

/** Insert through the caller's session so RLS (admin-only insert) applies
 *  and created_by is the person who pressed the button. On failure the
 *  uploaded object is removed so nothing orphaned stays in the bucket. */
async function insertRow(
  supabase: Session,
  storage: Bucket,
  path: string,
  row: Record<string, unknown>,
): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('resources')
    .insert({ ...row, caption: null, active: true })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[studio/resource] insert error:', error)
    await storage.remove([path]).catch(() => undefined)
    return NextResponse.json({ error: 'Could not create the resource', code: 'insert_failed' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id, duplicate: false })
}
