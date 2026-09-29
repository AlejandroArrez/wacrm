import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      // Cap reached: instead of going silent, hand the thread to a human
      // and tell the customer someone will follow up.
      await handOffConversation(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        handoffAgentId: config.handoffAgentId,
        assignedAgentId: conv.assigned_agent_id,
        summary: buildHandoffSummary({
          messages: await buildConversationContext(db, conversationId),
          replyCount: conv.ai_reply_count ?? 0,
        }),
      })
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread, hand it to a human, and tell the customer so the
      // thread doesn't just go silent. See handOffConversation.
      await handOffConversation(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        handoffAgentId: config.handoffAgentId,
        assignedAgentId: conv.assigned_agent_id,
        summary: buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
        }),
      })
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/** Default text sent to the customer when the bot hands a thread to a
 *  human. Override per deployment with `AI_HANDOFF_MESSAGE`; set it to
 *  `off` to hand off silently (the previous behaviour). */
const DEFAULT_HANDOFF_MESSAGE =
  'Gracias. Un asesor se pone en contacto contigo a la brevedad.'

export function aiHandoffMessage(): string | null {
  const raw = process.env.AI_HANDOFF_MESSAGE
  if (raw === undefined) return DEFAULT_HANDOFF_MESSAGE
  const trimmed = raw.trim()
  if (!trimmed || trimmed.toLowerCase() === 'off') return null
  return trimmed
}

/**
 * Hand a conversation from the bot to a human:
 *   (a) pause the bot on this thread (sticky until re-enabled),
 *   (b) route it to the configured handoff agent — null leaves it in
 *       the shared queue; never stomps an existing assignment,
 *   (c) leave a short internal note for whoever picks it up,
 *   (d) tell the customer a person will follow up (best-effort — a
 *       failed send must not undo the handoff).
 * Assigning fires the `on_conversation_assigned` trigger, which
 * notifies the agent.
 */
async function handOffConversation(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    handoffAgentId: string | null
    assignedAgentId: string | null
    summary: string
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.summary,
  }
  if (args.handoffAgentId && !args.assignedAgentId) {
    update.assigned_agent_id = args.handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', args.conversationId)

  const text = aiHandoffMessage()
  if (!text) return
  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.warn('[ai auto-reply] handoff message failed (handoff kept):', err)
  }
}

/** Human-readable label for a non-text inbound, used in the handoff note. */
const NON_TEXT_LABEL: Record<string, string> = {
  audio: 'una nota de voz o audio',
  image: 'una imagen',
  video: 'un video',
  document: 'un documento',
  sticker: 'un sticker',
  location: 'una ubicación',
}

/** Inbound types the bot cannot read and should hand to a human. */
export function isNonTextHandoffType(type: string): boolean {
  return type in NON_TEXT_LABEL
}

/**
 * The customer sent something the bot can't read (voice note, photo,
 * document…). Rather than ignore it, hand the thread to a human — but
 * only when the bot would otherwise own this thread: auto-reply on, no
 * message-level automation, no human assigned, not already handed off.
 * Owns its try/catch and never throws, like dispatchInboundToAiReply.
 */
export async function dispatchNonTextInboundHandoff(args: {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  messageType: string
}): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId, messageType } =
    args
  try {
    if (!isNonTextHandoffType(messageType)) return
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return
    if (conv.ai_autoreply_disabled) return

    const replies = conv.ai_reply_count ?? 0
    const summary =
      `🤖 El agente pasó la conversación: el cliente envió ${NON_TEXT_LABEL[messageType]}` +
      (replies > 0 ? ` después de ${replies} ${replies === 1 ? 'respuesta' : 'respuestas'} del agente.` : '.')

    await handOffConversation(db, {
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      handoffAgentId: config.handoffAgentId,
      assignedAgentId: conv.assigned_agent_id,
      summary,
    })
  } catch (err) {
    console.error('[ai auto-reply] non-text handoff failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
