import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  card: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendMedia: h.engineSendMedia,
  engineSendInteractiveButtons: h.engineSendInteractiveButtons,
}))

import { handleModelCardReply, sendModelCards } from './server'
import type { ModelCard } from './format'

function fakeDb(): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: h.card, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const base: ModelCard = {
  id: 'c1',
  account_id: 'acc-1',
  slug: 'atrium',
  name: 'Atrium',
  area_m2: '74.44',
  terrace_m2: '7.78',
  bedrooms: '2.0',
  bathrooms: '1.0',
  floors_text: '7 a 14',
  description: null,
  image_url: 'https://x/atrium.jpg',
  brochure_url: 'https://x/atrium.pdf',
  brochure_filename: null,
  active: true,
  sort_order: 1,
}

function run(action: 'brochure' | 'visit' | 'advisor') {
  const handlers = { replyWithAi: vi.fn().mockResolvedValue(undefined), handOff: vi.fn().mockResolvedValue(undefined) }
  return handleModelCardReply({
    db: fakeDb(),
    accountId: 'acc-1',
    userId: 'u1',
    conversationId: 'conv-1',
    contactId: 'ct-1',
    slug: 'atrium',
    action,
    handlers,
  }).then(() => handlers)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.card = { ...base }
  h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: 'm2' })
})

describe('handleModelCardReply', () => {
  it('sends the brochure PDF as a document', async () => {
    const handlers = await run('brochure')
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document', link: 'https://x/atrium.pdf', filename: 'Brochure Atrium.pdf' }),
    )
    expect(handlers.handOff).not.toHaveBeenCalled()
  })

  it('hands off when the card has no brochure', async () => {
    h.card = { ...base, brochure_url: null }
    const handlers = await run('brochure')
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(handlers.handOff).toHaveBeenCalledWith(expect.stringContaining('brochure de Atrium'))
  })

  it('lets the AI follow up on a visit request', async () => {
    const handlers = await run('visit')
    expect(handlers.replyWithAi).toHaveBeenCalled()
    expect(handlers.handOff).not.toHaveBeenCalled()
  })

  it('hands off when the customer asks for an advisor', async () => {
    const handlers = await run('advisor')
    expect(handlers.handOff).toHaveBeenCalledWith(expect.stringContaining('ficha de Atrium'))
  })

  it('never throws when sending fails', async () => {
    h.engineSendMedia.mockRejectedValue(new Error('Meta 400'))
    await expect(run('brochure')).resolves.toBeDefined()
  })
})

describe('sendModelCards', () => {
  it('sends an image-header card and keeps going after a failure', async () => {
    h.engineSendInteractiveButtons
      .mockRejectedValueOnce(new Error('bad image'))
      .mockResolvedValueOnce({ whatsapp_message_id: 'ok' })
    const sent = await sendModelCards(
      { accountId: 'acc-1', userId: 'u1', conversationId: 'conv-1', contactId: 'ct-1' },
      [base, { ...base, slug: 'vertice', name: 'Vértice' }],
    )
    expect(sent).toBe(1)
    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ headerImageUrl: 'https://x/atrium.jpg', aiGenerated: true }),
    )
  })
})
