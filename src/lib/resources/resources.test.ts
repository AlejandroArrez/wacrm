import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  GENERAL_MODEL,
  downloadFileName,
  humanFileSize,
  isExternalResource,
  kindFromMime,
  matchesResourceFilters,
  resourceDownloadUrl,
  type Resource,
} from './resources'

const SB = 'https://abc.supabase.co/storage/v1/object/public/resources/account-1/123-atrium.jpg'

function res(over: Partial<Resource> = {}): Resource {
  return {
    id: 'r1',
    account_id: 'a1',
    title: 'Atrium · fachada',
    caption: 'Tu nuevo hogar en Tepatitlán #PortaMagna',
    kind: 'image',
    format: 'post',
    model_slug: 'atrium',
    segment: 'residente',
    file_url: SB,
    external_url: null,
    file_name: 'atrium fachada.jpg',
    file_size: 1024,
    mime_type: 'image/jpeg',
    active: true,
    created_at: '2026-10-02T00:00:00Z',
    ...over,
  }
}

describe('kindFromMime', () => {
  it('maps the accepted types', () => {
    expect(kindFromMime('image/jpeg')).toBe('image')
    expect(kindFromMime('IMAGE/PNG')).toBe('image')
    expect(kindFromMime('video/mp4')).toBe('video')
    expect(kindFromMime('video/quicktime')).toBe('video')
  })
  it('rejects anything the bucket refuses', () => {
    expect(kindFromMime('image/gif')).toBeNull()
    expect(kindFromMime('application/pdf')).toBeNull()
    expect(kindFromMime('')).toBeNull()
    expect(kindFromMime(null)).toBeNull()
  })
})

describe('resourceDownloadUrl', () => {
  it('adds ?download= with the original file name for Supabase files', () => {
    expect(resourceDownloadUrl(res())).toBe(`${SB}?download=atrium%20fachada.jpg`)
  })
  it('falls back to the title plus extension', () => {
    expect(resourceDownloadUrl(res({ file_name: null }))).toBe(
      `${SB}?download=${encodeURIComponent('Atrium · fachada.jpg')}`,
    )
  })
  it('appends with & when the URL already has a query', () => {
    expect(resourceDownloadUrl(res({ file_url: `${SB}?v=2` }))).toBe(
      `${SB}?v=2&download=atrium%20fachada.jpg`,
    )
  })
  it('leaves other hosts and external links untouched', () => {
    expect(resourceDownloadUrl(res({ file_url: '/img/a.jpg' }))).toBe('/img/a.jpg')
    const drive = 'https://drive.google.com/file/d/x/view'
    expect(resourceDownloadUrl(res({ file_url: null, external_url: drive }))).toBe(drive)
  })
  it('is null without any link', () => {
    expect(resourceDownloadUrl(res({ file_url: null, external_url: null }))).toBeNull()
  })
})

describe('isExternalResource', () => {
  it('is true only for link-only resources', () => {
    expect(isExternalResource(res())).toBe(false)
    expect(isExternalResource(res({ file_url: null, external_url: 'https://x.com/v' }))).toBe(true)
  })
})

describe('downloadFileName', () => {
  it('strips characters browsers reject', () => {
    expect(downloadFileName('a/b:c?.mp4', 't', 'u')).toBe('a b c .mp4')
  })
  it('uses "recurso" when the title is empty and there is no extension', () => {
    expect(downloadFileName(null, '  ', 'https://x/y')).toBe('recurso')
  })
})

describe('humanFileSize', () => {
  it('formats bytes', () => {
    expect(humanFileSize(null)).toBe('')
    expect(humanFileSize(512)).toBe('512 B')
    expect(humanFileSize(1536)).toBe('1.5 KB')
    expect(humanFileSize(50 * 1024 * 1024)).toBe('50 MB')
  })
})

describe('matchesResourceFilters', () => {
  it('passes everything active with empty filters', () => {
    expect(matchesResourceFilters(res(), EMPTY_FILTERS)).toBe(true)
  })
  it('hides paused resources unless asked', () => {
    expect(matchesResourceFilters(res({ active: false }), EMPTY_FILTERS)).toBe(false)
    expect(
      matchesResourceFilters(res({ active: false }), { ...EMPTY_FILTERS, includeInactive: true }),
    ).toBe(true)
  })
  it('filters by kind, format, segment and model', () => {
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, kind: 'video' })).toBe(false)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, format: 'reel' })).toBe(false)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, segment: 'diaspora' })).toBe(false)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, model: 'vertice' })).toBe(false)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, model: 'atrium' })).toBe(true)
  })
  it('"general" matches only resources without a model', () => {
    const f = { ...EMPTY_FILTERS, model: GENERAL_MODEL }
    expect(matchesResourceFilters(res(), f)).toBe(false)
    expect(matchesResourceFilters(res({ model_slug: null }), f)).toBe(true)
  })
  it('searches title and caption ignoring accents and case', () => {
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, query: 'TEPATITLAN' })).toBe(true)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, query: 'atrium fachada' })).toBe(true)
    expect(matchesResourceFilters(res(), { ...EMPTY_FILTERS, query: 'vertice' })).toBe(false)
  })
})
