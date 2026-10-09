import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { seesRestrictedSections } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * GET /api/studio/app
 *
 * Serves the content generator (one self-contained HTML page: fonts,
 * logos, product data and the drawing engine inlined) to signed-in
 * members who see restricted sections — never to advisors, never
 * publicly. The /studio page frames it; next.config.ts relaxes
 * X-Frame-Options to SAMEORIGIN for this one path.
 *
 * The file is NOT in the repository: it carries list prices and
 * licensed fonts, and the repository is public. It lives in the
 * private Storage bucket `studio` (migration 049) as `generador.html`.
 * To update the generator, upload a new file there — no deploy needed.
 */
const BUCKET = 'studio'
const OBJECT = 'generador.html'
const CACHE_MS = 5 * 60_000
let cached: { html: string; at: number } | null = null

async function loadGenerator(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.html
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(OBJECT)
  if (error || !data) {
    console.error('[studio/app] generator download failed:', error)
    return cached?.html ?? null
  }
  const html = await data.text()
  cached = { html, at: Date.now() }
  return html
}

export async function GET() {
  try {
    const { role } = await getCurrentAccount()
    if (!seesRestrictedSections(role)) {
      return new NextResponse('Not available for this role.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    const html = await loadGenerator()
    if (!html) {
      return new NextResponse(
        'Falta el generador: sube generador.html al depósito privado «studio» de Supabase Storage.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
      )
    }
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
