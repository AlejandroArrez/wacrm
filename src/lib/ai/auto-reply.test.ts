import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  loadAccountMetaCredentials: vi.fn(),
  sendTypingIndicator: vi.fn(),
  loadActiveModelCards: vi.fn(),
  sendModelCards: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  loadAccountMetaCredentials: h.loadAccountMetaCredentials,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: h.sendTypingIndicator,
}))
vi.mock('@/lib/model-cards/server', () => ({
  loadActiveModelCards: h.loadActiveModelCards,
  sendModelCards: h.sendModelCards,
  handleModelCardReply: vi.fn(),
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import {
  dispatchInboundToAiReply,
  dispatchNonTextInboundHandoff,
  aiHandoffMessage,
} from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'wamid.inbound-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.loadAccountMetaCredentials.mockResolvedValue({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  })
  h.sendTypingIndicator.mockResolvedValue(undefined)
  h.loadActiveModelCards.mockResolvedValue([])
  h.sendModelCards.mockResolvedValue(0)
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off (no LLM call) when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: aiHandoffMessage() }),
    )
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — typing indicator (#527)', () => {
  it('shows "typing…" on the inbound wamid before calling the LLM', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAccountMetaCredentials).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
    )
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      messageId: 'wamid.inbound-1',
    })
    // Ordering: the indicator goes out while the customer waits on the
    // model, not after the reply is already generated.
    const typingOrder = h.sendTypingIndicator.mock.invocationCallOrder[0]
    const llmOrder = h.generateReply.mock.invocationCallOrder[0]
    expect(typingOrder).toBeLessThan(llmOrder)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('still sends the reply when the indicator request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sendTypingIndicator.mockRejectedValue(new Error('Meta API error: 400'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('typing indicator failed'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('still sends the reply when the WhatsApp credentials cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.loadAccountMetaCredentials.mockRejectedValue(
      new Error('WhatsApp not configured for this account'),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('skips the indicator when no inbound wamid is supplied', async () => {
    const { inboundMessageId: _omit, ...legacyArgs } = ARGS
    void _omit
    await dispatchInboundToAiReply(legacyArgs)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not fire when a gate short-circuits before the LLM', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadAccountMetaCredentials).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and tells the customer on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        text: 'Gracias. Un asesor se pone en contacto contigo a la brevedad.',
      }),
    )
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('handoff message', () => {
  const saved = process.env.AI_HANDOFF_MESSAGE
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_HANDOFF_MESSAGE
    else process.env.AI_HANDOFF_MESSAGE = saved
  })

  it('uses AI_HANDOFF_MESSAGE when set', async () => {
    process.env.AI_HANDOFF_MESSAGE = 'Un asesor te contacta pronto.'
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Un asesor te contacta pronto.' }),
    )
  })

  it('hands off silently when AI_HANDOFF_MESSAGE is "off"', async () => {
    process.env.AI_HANDOFF_MESSAGE = 'off'
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('keeps the handoff when the customer message fails to send', async () => {
    h.engineSendText.mockRejectedValue(new Error('meta down'))
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchNonTextInboundHandoff', () => {
  const NT = {
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    configOwnerUserId: 'user-1',
  }

  it('hands a voice note to the configured agent and tells the customer', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    await dispatchNonTextInboundHandoff({ ...NT, messageType: 'audio' })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('nota de voz')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('ignores text messages', async () => {
    await dispatchNonTextInboundHandoff({ ...NT, messageType: 'text' })
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does nothing when auto-reply is off', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchNonTextInboundHandoff({ ...NT, messageType: 'image' })
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does nothing when a human already owns the thread', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchNonTextInboundHandoff({ ...NT, messageType: 'document' })
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does nothing when the thread was already handed off', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 2,
    }
    await dispatchNonTextInboundHandoff({ ...NT, messageType: 'audio' })
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — model cards', () => {
  const atrium = {
    id: 'card-1',
    account_id: 'acc-1',
    slug: 'atrium',
    name: 'Atrium',
    area_m2: '74.44',
    terrace_m2: '7.78',
    bedrooms: '2.0',
    bathrooms: '1.0',
    floors_text: '7 a 14',
    description: null,
    image_url: '/fichas/porta-magna/atrium.jpg',
    brochure_url: null,
    brochure_filename: null,
    active: true,
    sort_order: 1,
  }

  it('lists the active cards in the system prompt', async () => {
    h.loadActiveModelCards.mockResolvedValue([atrium])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('[[FICHA:slug]]')
    expect(systemPrompt).toContain('- atrium: Atrium')
  })

  it('omits the card instructions when the account has no cards', async () => {
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('[[FICHA:')
  })

  it('sends the text first and then the requested card', async () => {
    h.loadActiveModelCards.mockResolvedValue([atrium])
    h.generateReply.mockResolvedValue({ text: 'Te comparto el Atrium.', handoff: false, cards: ['atrium'] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.sendModelCards).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      [atrium],
    )
    expect(h.engineSendText.mock.invocationCallOrder[0]).toBeLessThan(
      h.sendModelCards.mock.invocationCallOrder[0],
    )
  })

  it('drops slugs that are not active cards', async () => {
    h.loadActiveModelCards.mockResolvedValue([atrium])
    h.generateReply.mockResolvedValue({ text: 'Hola', handoff: false, cards: ['domus'] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendModelCards).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('sends a card-only reply without handing off', async () => {
    h.loadActiveModelCards.mockResolvedValue([atrium])
    h.generateReply.mockResolvedValue({ text: '', handoff: false, cards: ['atrium'] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendModelCards).toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})
