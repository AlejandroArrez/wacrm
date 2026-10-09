import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { parseStudioVideoSign, studioResourcePath } from '@/lib/studio/resource'

const BUCKET = 'resources'

/**
 * POST /api/studio/resource/upload  (admin+)
 *
 * Body: { file_name (.mp4), size }
 * Step 1 of saving a reel to Recursos. A reel is several MB, more than a
 * Vercel request body allows, so the page uploads it straight to the
 * `resources` bucket with the signed URL returned here (valid 2 hours,
 * one object, no overwrite), then calls POST /api/studio/resource with
 * the path to register it.
 *
 * Returns { duplicate: true, id } when this reel is already in the
 * library, else { path, signed_url }.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-res:${userId}`, RATE_LIMITS.studioResource)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseStudioVideoSign(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, code: parsed.code },
        { status: parsed.code === 'too_large' ? 413 : 400 },
      )
    }
    const { fileName } = parsed.value

    const { data: existing, error: findErr } = await supabase
      .from('resources')
      .select('id')
      .eq('account_id', accountId)
      .eq('file_name', fileName)
      .limit(1)
      .maybeSingle()
    if (findErr) {
      console.error('[studio/resource/upload] lookup error:', findErr)
      return NextResponse.json({ error: 'Failed to check the library' }, { status: 500 })
    }
    if (existing) return NextResponse.json({ duplicate: true, id: existing.id })

    const path = studioResourcePath(accountId, fileName)
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[studio/resource/upload] sign error:', error)
      return NextResponse.json({ error: 'Could not prepare the upload', code: 'sign_failed' }, { status: 502 })
    }
    return NextResponse.json({ duplicate: false, path, signed_url: data.signedUrl })
  } catch (err) {
    return toErrorResponse(err)
  }
}
