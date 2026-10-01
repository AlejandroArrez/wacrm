// ============================================================
// Model cards — server side: load, send, and handle button taps.
//
// Runs with the service-role client (webhook / AI auto-reply context).
// Every function owns its errors where the caller can't do anything
// useful with them, so a broken card never costs the customer the
// text reply or the webhook its 200.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  engineSendInteractiveButtons,
  engineSendMedia,
} from '@/lib/flows/meta-send'
import {
  absoluteMediaUrl,
  brochureFileName,
  buildCardBody,
  cardButtons,
  type CardAction,
  type ModelCard,
} from './format'

const CARD_COLUMNS =
  'id, account_id, slug, name, area_m2, terrace_m2, bedrooms, bathrooms, ' +
  'floors_text, description, image_url, brochure_url, brochure_filename, active, sort_order'

/**
 * Active cards for an account, in display order. Returns [] on any
 * error — including the table not existing yet (code deployed before
 * migration 045) — so the agent simply runs without cards.
 */
export async function loadActiveModelCards(
  db: SupabaseClient,
  accountId: string,
): Promise<ModelCard[]> {
  try {
    const { data, error } = await db
      .from('model_cards')
      .select(CARD_COLUMNS)
      .eq('account_id', accountId)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error || !data) return []
    return data as unknown as ModelCard[]
  } catch {
    return []
  }
}

/** One card by slug (active or not — a tap on an old card still works). */
export async function loadModelCardBySlug(
  db: SupabaseClient,
  accountId: string,
  slug: string,
): Promise<ModelCard | null> {
  try {
    const { data, error } = await db
      .from('model_cards')
      .select(CARD_COLUMNS)
      .eq('account_id', accountId)
      .eq('slug', slug)
      .maybeSingle()
    if (error || !data) return null
    return data as unknown as ModelCard
  } catch {
    return null
  }
}

interface SendCardArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  card: ModelCard
}

/**
 * Send one card as an interactive button message with an image header
 * (no header when the card has no usable image URL). Throws on
 * Meta / DB failure — callers decide whether that matters.
 */
export async function sendModelCard(args: SendCardArgs): Promise<void> {
  const { card } = args
  await engineSendInteractiveButtons({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    bodyText: buildCardBody(card),
    buttons: cardButtons(card),
    headerImageUrl: absoluteMediaUrl(card.image_url) ?? undefined,
    aiGenerated: true,
  })
}

/**
 * Send several cards in order, best-effort: one failing card is logged
 * and skipped so the rest still go out.
 */
export async function sendModelCards(
  base: Omit<SendCardArgs, 'card'>,
  cards: ModelCard[],
): Promise<number> {
  let sent = 0
  for (const card of cards) {
    try {
      await sendModelCard({ ...base, card })
      sent++
    } catch (err) {
      console.error(`[model cards] sending "${card.slug}" failed:`, err)
    }
  }
  return sent
}

export interface CardReplyHandlers {
  /** Let the AI answer the tap as if the customer typed it. */
  replyWithAi: () => Promise<void>
  /** Hand the conversation to a human with a note for the advisor. */
  handOff: (note: string) => Promise<void>
}

/**
 * The customer tapped a card button.
 *   brochure → send the PDF (or hand off if the card has none)
 *   visit    → the AI continues the conversation (asks day and time)
 *   advisor  → hand off to a human
 * Owns its try/catch and never throws.
 */
export async function handleModelCardReply(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  slug: string
  action: CardAction
  handlers: CardReplyHandlers
}): Promise<void> {
  const { db, accountId, slug, action, handlers } = args
  try {
    const card = await loadModelCardBySlug(db, accountId, slug)
    const label = card?.name ?? slug

    if (action === 'brochure') {
      const brochureLink = absoluteMediaUrl(card?.brochure_url)
      if (card && brochureLink) {
        await engineSendMedia({
          accountId,
          userId: args.userId,
          conversationId: args.conversationId,
          contactId: args.contactId,
          kind: 'document',
          link: brochureLink,
          filename: brochureFileName(card.name, card.brochure_filename),
          caption: `Brochure ${card.name}`,
        })
        return
      }
      await handlers.handOff(
        `📄 El cliente pidió el brochure de ${label} y la ficha no tiene PDF cargado.`,
      )
      return
    }

    if (action === 'visit') {
      await handlers.replyWithAi()
      return
    }

    await handlers.handOff(`🙋 El cliente pidió hablar con un asesor desde la ficha de ${label}.`)
  } catch (err) {
    console.error('[model cards] reply handling failed:', err)
  }
}
