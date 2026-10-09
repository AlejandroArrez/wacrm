import { describe, expect, it } from 'vitest'
import { parseStudioResource, studioResourcePath, STUDIO_RESOURCE_MAX_BYTES } from './resource'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64')
const ok = { image: JPEG, file_name: 'PM_META_4x5_FEED_TRASCIENDE_PLAZA_v1_P261009-ABC.jpg', title: 'Plaza · 4:5', format: 'post' }

describe('parseStudioResource', () => {
  it('accepts a valid piece and keeps known segment and model', () => {
    const r = parseStudioResource({ ...ok, segment: 'patrimonio', model_slug: 'atrium-2-0' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.format).toBe('post')
      expect(r.value.segment).toBe('patrimonio')
      expect(r.value.modelSlug).toBe('atrium-2-0')
      expect(r.value.bytes.length).toBe(6)
    }
  })
  it('drops unknown segment and bad model slug instead of failing', () => {
    const r = parseStudioResource({ ...ok, segment: 'otro', model_slug: 'Atrium 2.0' })
    expect(r.ok && r.value.segment === null && r.value.modelSlug === null).toBe(true)
  })
  it('rejects non-JPEG data, bad names, missing title and wrong format', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    expect(parseStudioResource({ ...ok, image: png })).toMatchObject({ ok: false })
    expect(parseStudioResource({ ...ok, file_name: '../x.jpg' })).toMatchObject({ ok: false })
    expect(parseStudioResource({ ...ok, file_name: 'x.png' })).toMatchObject({ ok: false })
    expect(parseStudioResource({ ...ok, title: '   ' })).toMatchObject({ ok: false })
    expect(parseStudioResource({ ...ok, format: 'reel' })).toMatchObject({ ok: false })
  })
  it('rejects images over the size cap', () => {
    const big = 'A'.repeat(Math.ceil((STUDIO_RESOURCE_MAX_BYTES * 4) / 3) + 100)
    expect(parseStudioResource({ ...ok, image: big })).toMatchObject({ ok: false, code: 'too_large' })
  })
  it('caps the title length', () => {
    const r = parseStudioResource({ ...ok, title: 'x'.repeat(300) })
    expect(r.ok && r.value.title.length).toBe(120)
  })
})

describe('studioResourcePath', () => {
  it('keeps the account folder first', () => {
    expect(studioResourcePath('acc-1', 'PM_x.jpg', 123)).toBe('account-acc-1/generador/123-PM_x.jpg')
  })
})
