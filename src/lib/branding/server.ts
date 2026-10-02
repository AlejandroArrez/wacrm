import 'server-only'
import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { brandingFromRow, DEFAULT_BRANDING, type Branding } from './branding'

/** Cache tag busted by POST /api/branding/refresh after an admin saves. */
export const BRANDING_CACHE_TAG = 'branding'

const BRANDING_COLUMNS =
  'brand_name, brand_logo_url, brand_logo_dark_url, brand_icon_url, brand_icon_dark_url'

/**
 * Branding for screens shown before we know who the user is (browser
 * tab title, login page). Each deployment serves one company, so this
 * reads the account named in `BRANDING_ACCOUNT_ID`, or the oldest
 * account when that isn't set. Never throws: any problem (missing env,
 * migration 046 not applied yet) falls back to the default branding.
 */
async function loadDeploymentBranding(): Promise<Branding> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return DEFAULT_BRANDING
  try {
    const db = createClient(url, key, { auth: { persistSession: false } })
    const accountId = process.env.BRANDING_ACCOUNT_ID?.trim()
    const query = db.from('accounts').select(BRANDING_COLUMNS)
    const { data, error } = accountId
      ? await query.eq('id', accountId).maybeSingle()
      : await query.order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (error || !data) return DEFAULT_BRANDING
    return brandingFromRow(data)
  } catch {
    return DEFAULT_BRANDING
  }
}

export const getDeploymentBranding = unstable_cache(
  loadDeploymentBranding,
  ['deployment-branding'],
  { tags: [BRANDING_CACHE_TAG], revalidate: 300 },
)
