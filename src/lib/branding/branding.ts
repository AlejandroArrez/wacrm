// ============================================================
// Branding — the CRM's display name, logo and icon (migration 046).
//
// Each account can rename the CRM and upload its own logo (shown in
// the expanded sidebar) and icon (collapsed sidebar + browser tab),
// with optional dark-mode variants. "By Strato" is always shown under
// the logo and is not configurable.
// ============================================================

/** Name shown when an account hasn't set its own. */
export const DEFAULT_BRAND_NAME = 'CRM STRATO'

/** Fixed credit shown under the logo. */
export const BRAND_CREDIT = 'By Strato'

export interface Branding {
  name: string
  logoUrl: string | null
  logoDarkUrl: string | null
  iconUrl: string | null
  iconDarkUrl: string | null
}

export const DEFAULT_BRANDING: Branding = {
  name: DEFAULT_BRAND_NAME,
  logoUrl: null,
  logoDarkUrl: null,
  iconUrl: null,
  iconDarkUrl: null,
}

/** Columns of `accounts` that carry the branding. */
export interface BrandingColumns {
  brand_name?: string | null
  brand_logo_url?: string | null
  brand_logo_dark_url?: string | null
  brand_icon_url?: string | null
  brand_icon_dark_url?: string | null
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t ? t : null
}

/** Row (or partial row) → Branding, with defaults for anything empty. */
export function brandingFromRow(row: BrandingColumns | null | undefined): Branding {
  if (!row) return DEFAULT_BRANDING
  return {
    name: clean(row.brand_name) ?? DEFAULT_BRAND_NAME,
    logoUrl: clean(row.brand_logo_url),
    logoDarkUrl: clean(row.brand_logo_dark_url),
    iconUrl: clean(row.brand_icon_url),
    iconDarkUrl: clean(row.brand_icon_dark_url),
  }
}

/**
 * The image to show for a theme mode. Dark mode prefers the dark
 * variant and falls back to the light one (a logo that disappears on
 * a dark background is still better than no logo — the admin sees it
 * and uploads a dark version).
 */
export function pickBrandImage(
  branding: Branding,
  kind: 'logo' | 'icon',
  mode: 'light' | 'dark',
): string | null {
  const light = kind === 'logo' ? branding.logoUrl : branding.iconUrl
  const dark = kind === 'logo' ? branding.logoDarkUrl : branding.iconDarkUrl
  return mode === 'dark' ? dark ?? light : light ?? dark
}
