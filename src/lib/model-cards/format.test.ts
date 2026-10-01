import { describe, expect, it } from 'vitest'
import {
  absoluteMediaUrl,
  brochureFileName,
  floorsLabel,
  buildCardBody,
  cardButtons,
  cardPromptLine,
  extractCardMarkers,
  parseCardReplyId,
} from './format'

const atrium = {
  slug: 'atrium',
  name: 'Atrium',
  area_m2: '74.44',
  terrace_m2: '7.78',
  bedrooms: '2.0',
  bathrooms: '1.0',
  floors_text: '7 a 14',
  description: 'Estar de más de 30 m², cocina, comedor y terraza.',
  brochure_url: null as string | null,
}

describe('buildCardBody', () => {
  it('formats the spec lines in Spanish', () => {
    expect(buildCardBody(atrium)).toBe(
      '*Atrium* · 74.44 m²\n2 recámaras · 1 baño · terraza de 7.78 m²\nPisos 7 a 14\n\nEstar de más de 30 m², cocina, comedor y terraza.',
    )
  })

  it('handles half baths and singulars', () => {
    expect(
      buildCardBody({ ...atrium, name: 'Pórtico', area_m2: 80.85, terrace_m2: 20.85, bedrooms: '1.0', bathrooms: '1.5', floors_text: '6, 8, 10 y 12' }),
    ).toContain('1 recámara · 1.5 baños · terraza de 20.85 m²\nPisos 6, 8, 10 y 12')
  })

  it('leaves out empty fields instead of printing zeros', () => {
    expect(
      buildCardBody({
        name: 'Nuevo',
        area_m2: null,
        terrace_m2: null,
        bedrooms: null,
        bathrooms: null,
        floors_text: '  ',
        description: null,
      }),
    ).toBe('*Nuevo*')
  })

  it('never exceeds the 1024-char Meta body cap', () => {
    expect(buildCardBody({ ...atrium, description: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(1024)
  })
})

describe('cardButtons', () => {
  it('hides "Ver brochure" when there is no PDF', () => {
    expect(cardButtons(atrium).map((b) => b.id)).toEqual([
      'card:atrium:visit',
      'card:atrium:advisor',
    ])
  })

  it('shows three buttons with a brochure, all within 20 chars', () => {
    const btns = cardButtons({ ...atrium, brochure_url: 'https://x/b.pdf' })
    expect(btns.map((b) => b.title)).toEqual(['Ver brochure', 'Agendar visita', 'Hablar con un asesor'])
    for (const b of btns) expect(b.title.length).toBeLessThanOrEqual(20)
  })
})

describe('parseCardReplyId', () => {
  it('parses valid ids', () => {
    expect(parseCardReplyId('card:atrium-2-1:brochure')).toEqual({ slug: 'atrium-2-1', action: 'brochure' })
  })
  it('rejects anything else', () => {
    expect(parseCardReplyId('MENU_SALES')).toBeNull()
    expect(parseCardReplyId('card:atrium:delete')).toBeNull()
    expect(parseCardReplyId(null)).toBeNull()
  })
})

describe('extractCardMarkers', () => {
  it('strips markers, de-duplicates and caps at two', () => {
    const out = extractCardMarkers(
      'Te comparto estos modelos.\n[[FICHA:Atrium]]\n[[FICHA:vertice]]\n[[FICHA:atrium]]\n[[FICHA:portico]]',
    )
    expect(out).toEqual({ text: 'Te comparto estos modelos.', slugs: ['atrium', 'vertice'] })
  })

  it('returns the text untouched when there are no markers', () => {
    expect(extractCardMarkers('Hola, ¿en qué te ayudo?')).toEqual({ text: 'Hola, ¿en qué te ayudo?', slugs: [] })
  })
})

describe('helpers', () => {
  it('builds the prompt line', () => {
    expect(cardPromptLine(atrium)).toBe('- atrium: Atrium (74.44 m², 2 recámaras, Pisos 7 a 14)')
  })
  it('labels floors', () => {
    expect(floorsLabel('6')).toBe('Piso 6')
    expect(floorsLabel('4 y 5')).toBe('Pisos 4 y 5')
    expect(floorsLabel('Pisos 7 a 14')).toBe('Pisos 7 a 14')
    expect(floorsLabel('  ')).toBe('')
  })
  it('builds a safe brochure file name', () => {
    expect(brochureFileName('Atrium 2.1')).toBe('Brochure Atrium 2.1.pdf')
    expect(brochureFileName('a/b')).toBe('Brochure a b.pdf')
    expect(brochureFileName('Atrium', 'Porta Magna Atrium')).toBe('Porta Magna Atrium.pdf')
    expect(brochureFileName('Atrium', 'ficha.PDF')).toBe('ficha.PDF')
  })
  it('makes app paths absolute for Meta', () => {
    const env = { NEXT_PUBLIC_SITE_URL: 'https://crm.example.com/' }
    expect(absoluteMediaUrl('/fichas/porta-magna/atrium.jpg', env)).toBe(
      'https://crm.example.com/fichas/porta-magna/atrium.jpg',
    )
    expect(absoluteMediaUrl('https://cdn.x/a.jpg', env)).toBe('https://cdn.x/a.jpg')
    expect(absoluteMediaUrl('/a.jpg', { VERCEL_URL: 'app-123.vercel.app' })).toBe(
      'https://app-123.vercel.app/a.jpg',
    )
    expect(absoluteMediaUrl('/a.jpg', {})).toBeNull()
    expect(absoluteMediaUrl('relativo.jpg', env)).toBeNull()
    expect(absoluteMediaUrl(null, env)).toBeNull()
  })
})
