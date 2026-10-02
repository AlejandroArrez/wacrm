import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRANDING,
  DEFAULT_BRAND_NAME,
  brandingFromRow,
  pickBrandImage,
} from './branding'

describe('brandingFromRow', () => {
  it('falls back to the defaults for a missing or empty row', () => {
    expect(brandingFromRow(null)).toEqual(DEFAULT_BRANDING)
    expect(brandingFromRow({})).toEqual(DEFAULT_BRANDING)
    expect(brandingFromRow({ brand_name: '   ', brand_logo_url: '' })).toEqual(DEFAULT_BRANDING)
  })

  it('trims and maps every column', () => {
    expect(
      brandingFromRow({
        brand_name: ' Porta Magna ',
        brand_logo_url: '/branding/porta-magna/logo.png',
        brand_logo_dark_url: '/branding/porta-magna/logo-dark.png',
        brand_icon_url: '/branding/porta-magna/icon.png',
        brand_icon_dark_url: null,
      }),
    ).toEqual({
      name: 'Porta Magna',
      logoUrl: '/branding/porta-magna/logo.png',
      logoDarkUrl: '/branding/porta-magna/logo-dark.png',
      iconUrl: '/branding/porta-magna/icon.png',
      iconDarkUrl: null,
    })
  })

  it('keeps the default name when only images are set', () => {
    expect(brandingFromRow({ brand_logo_url: '/x.png' }).name).toBe(DEFAULT_BRAND_NAME)
  })
})

describe('pickBrandImage', () => {
  const b = {
    ...DEFAULT_BRANDING,
    logoUrl: 'light-logo',
    logoDarkUrl: 'dark-logo',
    iconUrl: 'light-icon',
    iconDarkUrl: null,
  }

  it('uses the variant for the mode', () => {
    expect(pickBrandImage(b, 'logo', 'light')).toBe('light-logo')
    expect(pickBrandImage(b, 'logo', 'dark')).toBe('dark-logo')
  })

  it('falls back to the other variant when one is missing', () => {
    expect(pickBrandImage(b, 'icon', 'dark')).toBe('light-icon')
    expect(pickBrandImage({ ...b, logoUrl: null }, 'logo', 'light')).toBe('dark-logo')
  })

  it('returns null when nothing is uploaded', () => {
    expect(pickBrandImage(DEFAULT_BRANDING, 'logo', 'dark')).toBeNull()
  })
})
