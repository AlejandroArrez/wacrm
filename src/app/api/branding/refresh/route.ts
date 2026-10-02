import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { BRANDING_CACHE_TAG } from '@/lib/branding/server'

/**
 * Called by Settings → Brand right after an admin saves, so the browser
 * tab title and the login page pick up the change on the next request
 * instead of after the cache window.
 */
export async function POST() {
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  revalidateTag(BRANDING_CACHE_TAG, { expire: 0 })
  return NextResponse.json({ ok: true })
}
