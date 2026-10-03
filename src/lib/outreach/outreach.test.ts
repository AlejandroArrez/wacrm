import { describe, expect, it } from 'vitest'
import {
  fillTemplate,
  isDailyLimitError,
  queueTab,
  rankTemplates,
  segmentFromTags,
  sourceTags,
  waPhone,
  whatsappLink,
  type OutreachTemplate,
} from './outreach'

describe('waPhone', () => {
  it('adds 52 to 10-digit Mexican numbers', () => {
    expect(waPhone('378 104 7695')).toBe('523781047695')
  })
  it('drops the legacy 1 after 52', () => {
    expect(waPhone('+52 1 33 1234 5678')).toBe('523312345678')
  })
  it('keeps full international numbers', () => {
    expect(waPhone('+52 33 1234 5678')).toBe('523312345678')
    expect(waPhone('+1 (213) 555-0100')).toBe('12135550100')
  })
  it('rejects numbers that are too short or empty', () => {
    expect(waPhone('12345')).toBeNull()
    expect(waPhone(null)).toBeNull()
  })
})

describe('whatsappLink', () => {
  it('builds wa.me and WhatsApp Web links with the text encoded', () => {
    expect(whatsappLink('523312345678', 'Hola Ana & co')).toBe(
      'https://wa.me/523312345678?text=Hola%20Ana%20%26%20co',
    )
    expect(whatsappLink('523312345678', 'Hola', 'web')).toBe(
      'https://web.whatsapp.com/send?phone=523312345678&text=Hola',
    )
  })
})

describe('fillTemplate', () => {
  const body = 'Hola {nombre}, soy {asesor} de Porta Magna. Mi número: {telefono_asesor}.'
  it('uses first names and the advisor phone', () => {
    expect(
      fillTemplate(body, {
        contactName: 'Ana Sofía López',
        advisorName: 'Alejandro Arrez',
        advisorPhone: '378 104 7695',
      }),
    ).toBe('Hola Ana, soy Alejandro de Porta Magna. Mi número: 378 104 7695.')
  })
  it('tidies punctuation when a value is missing', () => {
    expect(fillTemplate('Hola {nombre}, ¿cómo estás?', { contactName: null, advisorName: null, advisorPhone: null })).toBe(
      'Hola, ¿cómo estás?',
    )
  })
  it('is case-insensitive and keeps line breaks', () => {
    expect(fillTemplate('Hola {NOMBRE}\n\nSaludos', { contactName: 'Javier', advisorName: '', advisorPhone: '' })).toBe(
      'Hola Javier\n\nSaludos',
    )
  })
})

describe('segment and source tags', () => {
  it('reads the segment ignoring accents and case', () => {
    expect(segmentFromTags(['web', 'Diáspora'])).toBe('diaspora')
    expect(segmentFromTags(['web'])).toBeNull()
  })
  it('keeps only origin and campaign tags', () => {
    expect(sourceTags(['web', 'origen:lista-espera', 'campaña:presentacion', 'residente'])).toEqual([
      'origen:lista-espera',
      'campaña:presentacion',
    ])
  })
})

describe('queueTab', () => {
  it('classifies prospects', () => {
    expect(queueTab({ has_chat: false, attempts: 0, last_result: null })).toBe('pending')
    expect(queueTab({ has_chat: true, attempts: 0, last_result: null })).toBe('chatting')
    expect(queueTab({ has_chat: false, attempts: 1, last_result: 'sent' })).toBe('followup')
    expect(queueTab({ has_chat: true, attempts: 2, last_result: 'meeting' })).toBe('done')
  })
})

describe('rankTemplates', () => {
  const tpl = (id: string, over: Partial<OutreachTemplate> = {}): OutreachTemplate => ({
    id,
    account_id: 'a',
    name: id,
    body: 'x',
    segment: null,
    campaign_tag: null,
    active: true,
    sort_order: 0,
    ...over,
  })
  const all = [
    tpl('general'),
    tpl('inversionista', { segment: 'inversionista' }),
    tpl('residente', { segment: 'residente' }),
    tpl('feria', { campaign_tag: 'campaña:feria' }),
    tpl('apagada', { active: false }),
  ]
  it('puts campaign, then segment, then general first; others last', () => {
    expect(rankTemplates(all, ['residente', 'campaña:feria']).map((t) => t.id)).toEqual([
      'feria',
      'residente',
      'general',
      'inversionista',
    ])
  })
  it('without tags, general templates lead', () => {
    expect(rankTemplates(all, [])[0].id).toBe('general')
  })
})

describe('isDailyLimitError', () => {
  it('detects the cap raised by the database', () => {
    expect(isDailyLimitError({ message: 'outreach_daily_limit: 20 de 20' })).toBe(true)
    expect(isDailyLimitError({ hint: 'daily_limit' })).toBe(true)
    expect(isDailyLimitError({ message: 'other' })).toBe(false)
    expect(isDailyLimitError(null)).toBe(false)
  })
})
