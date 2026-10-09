import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { parseStudioResource, studioResourcePath } from '@/lib/studio/resource'

const BUCKET = 'resources'

/**
 * POST /api/studio/resource  (admin+)
 *
 * Body: { image (base64 JPEG), file_name, title, format, segment?, model_slug? }
 * Saves one piece from the content generator into Recursos, the library
 * advisors download from. The page blocks pieces with red brand-check
 * errors before calling this; here we validate, skip duplicates (same
 * file name = same piece ID, version and format) and upload.
 *
 * Returns { id, duplicate }.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-res:${userId}`, RATE_LIMITS.studioResource)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseStudioResource(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, code: parsed.code },
        { status: parsed.code === 'too_large' ? 413 : 400 },
      )
    }
    const p = parsed.value

    // Same piece saved before → don't duplicate it in the library.
    const { data: existing, error: findErr } = await supabase
      .from('resources')
      .select('id')
      .eq('account_id', accountId)
      .eq('file_name', p.fileName)
      .limit(1)
      .maybeSingle()
    if (findErr) {
      console.error('[studio/resource] lookup error:', findErr)
      return NextResponse.json({ error: 'Failed to check the library' }, { status: 500 })
    }
    if (existing) return NextResponse.json({ id: existing.id, duplicate: true })

    const storage = supabaseAdmin().storage.from(BUCKET)
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

    // Insert through the caller's session so RLS (admin-only insert)
    // applies and created_by is the person who pressed the button.
    const { data: row, error: insErr } = await supabase
      .from('resources')
      .insert({
        account_id: accountId,
        title: p.title,
        caption: null,
        kind: 'image',
        format: p.format,
        model_slug: p.modelSlug,
        segment: p.segment,
        file_url: publicUrl,
        file_name: p.fileName,
        file_size: p.bytes.length,
        mime_type: 'image/jpeg',
        active: true,
      })
      .select('id')
      .single()
    if (insErr || !row) {
      console.error('[studio/resource] insert error:', insErr)
      await storage.remove([path]).catch(() => undefined)
      return NextResponse.json({ error: 'Could not create the resource', code: 'insert_failed' }, { status: 500 })
    }

    return NextResponse.json({ id: row.id, duplicate: false })
  } catch (err) {
    return toErrorResponse(err)
  }
}
