// ============================================================
// Model cards ("fichas de modelos") — pure helpers.
//
// A model card is an interactive WhatsApp message the AI agent sends
// when a prospect shows interest in a specific unit type: image
// header, a short spec body and up to 3 reply buttons. Everything
// here is pure so it can be unit-tested without Meta or Supabase.
// ============================================================

/**
 * Row of `model_cards` (migration 045). Numeric columns arrive from
 * PostgREST as strings ("74.44"), so every reader goes through Number().
 */
export interface ModelCard {
  id: string
  account_id: string
  slug: string
  name: string
  area_m2: number | string | null
  terrace_m2: number | string | null
  bedrooms: number | string | null
  bathrooms: number | string | null
  floors_text: string | null
  description: string | null
  /** Absolute URL, or a path served by the app (`/fichas/...`). */
  image_url: string | null
  brochure_url: string | null
  /** File name the customer sees on the PDF. Optional. */
  brochure_filename: string | null
  active: boolean
  sort_order: number
}

/** The three actions a card can offer. */
export type CardAction = 'brochure' | 'visit' | 'advisor'

/** Every card reply id starts with this prefix: `card:<slug>:<action>`. */
export const CARD_REPLY_PREFIX = 'card:'

/** Marker the model writes to attach a card: `[[FICHA:atrium]]`. */
export const CARD_MARKER_RE = /\[\[FICHA:([a-z0-9][a-z0-9-]{0,39})\]\]/gi

/** Most cards the agent may attach to a single reply. */
export const MAX_CARDS_PER_REPLY = 2

/** Visible button labels (Meta caps titles at 20 chars). */
export const CARD_BUTTON_TITLES: Record<CardAction, string> = {
  brochure: 'Ver brochure',
  visit: 'Agendar visita',
  advisor: 'Hablar con un asesor',
}

/** Meta caps the interactive body at 1024 chars. */
const BODY_MAX = 1024

/** 74.44 → "74.44", 80 → "80", 1.5 → "1.5". Accepts PostgREST strings. */
function num(v: number | string): string {
  const n = Number(v)
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/** A filled-in numeric column (not null, not empty, finite). */
function has(v: number | string | null | undefined): v is number | string {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

/**
 * "6 a 14" → "Pisos 6 a 14", "6" → "Piso 6"; text that already starts
 * with "Piso"/"Pisos" (or any other wording) is kept as typed.
 */
export function floorsLabel(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  if (!/^\d/.test(t)) return t
  return /^\d+$/.test(t) ? `Piso ${t}` : `Pisos ${t}`
}

function plural(v: number | string, one: string, many: string): string {
  return `${num(v)} ${Number(v) === 1 ? one : many}`
}

/**
 * Card body text. Only the fields that are filled in appear — an empty
 * field is left out rather than shown as "0" or "ND".
 *
 *   *Atrium* · 74.44 m²
 *   2 recámaras · 1 baño · terraza de 7.78 m²
 *   Pisos 7 a 14
 *
 *   Estar de más de 30 m², cocina, comedor…
 */
export function buildCardBody(card: Pick<
  ModelCard,
  'name' | 'area_m2' | 'terrace_m2' | 'bedrooms' | 'bathrooms' | 'floors_text' | 'description'
>): string {
  const title = has(card.area_m2)
    ? `*${card.name.trim()}* · ${num(card.area_m2)} m²`
    : `*${card.name.trim()}*`

  const specs: string[] = []
  if (has(card.bedrooms)) specs.push(plural(card.bedrooms, 'recámara', 'recámaras'))
  if (has(card.bathrooms)) specs.push(plural(card.bathrooms, 'baño', 'baños'))
  if (has(card.terrace_m2) && Number(card.terrace_m2) > 0) {
    specs.push(`terraza de ${num(card.terrace_m2)} m²`)
  }

  const lines = [title]
  if (specs.length) lines.push(specs.join(' · '))
  const floors = floorsLabel(card.floors_text)
  if (floors) lines.push(floors)

  let body = lines.join('\n')
  const desc = card.description?.trim()
  if (desc) body += `\n\n${desc}`
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`
  return body
}

/** Reply-button id for a card action. */
export function cardReplyId(slug: string, action: CardAction): string {
  return `${CARD_REPLY_PREFIX}${slug}:${action}`
}

/** Buttons for a card. "Ver brochure" only appears when a PDF exists. */
export function cardButtons(card: Pick<ModelCard, 'slug' | 'brochure_url'>): {
  id: string
  title: string
}[] {
  const actions: CardAction[] = card.brochure_url
    ? ['brochure', 'visit', 'advisor']
    : ['visit', 'advisor']
  return actions.map((a) => ({
    id: cardReplyId(card.slug, a),
    title: CARD_BUTTON_TITLES[a],
  }))
}

/** Parse `card:<slug>:<action>`; null for anything else. */
export function parseCardReplyId(
  id: string | null | undefined,
): { slug: string; action: CardAction } | null {
  if (!id || !id.startsWith(CARD_REPLY_PREFIX)) return null
  const m = /^card:([a-z0-9][a-z0-9-]{0,39}):(brochure|visit|advisor)$/.exec(id)
  if (!m) return null
  return { slug: m[1], action: m[2] as CardAction }
}

/**
 * Pull `[[FICHA:slug]]` markers out of model output. Returns the text
 * without markers and the requested slugs (lower-cased, de-duplicated,
 * in order, capped at MAX_CARDS_PER_REPLY). Unknown slugs are filtered
 * later against the account's active cards.
 */
export function extractCardMarkers(raw: string): { text: string; slugs: string[] } {
  const slugs: string[] = []
  for (const m of raw.matchAll(CARD_MARKER_RE)) {
    const s = m[1].toLowerCase()
    if (!slugs.includes(s)) slugs.push(s)
  }
  const text = raw
    .replace(CARD_MARKER_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, slugs: slugs.slice(0, MAX_CARDS_PER_REPLY) }
}

/** Short description of a card for the system prompt. */
export function cardPromptLine(card: Pick<
  ModelCard,
  'slug' | 'name' | 'area_m2' | 'bedrooms' | 'floors_text'
>): string {
  const bits: string[] = []
  if (has(card.area_m2)) bits.push(`${num(card.area_m2)} m²`)
  if (has(card.bedrooms)) bits.push(plural(card.bedrooms, 'recámara', 'recámaras'))
  const floors = floorsLabel(card.floors_text)
  if (floors) bits.push(floors)
  return `- ${card.slug}: ${card.name}${bits.length ? ` (${bits.join(', ')})` : ''}`
}

/**
 * File name the customer sees on the brochure: the admin's own name
 * when set (".pdf" added if missing), otherwise "Brochure <Modelo>.pdf".
 */
export function brochureFileName(name: string, custom?: string | null): string {
  const clean = (v: string) => v.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  const c = custom ? clean(custom) : ''
  if (c) return /\.pdf$/i.test(c) ? c : `${c}.pdf`
  return `Brochure ${clean(name) || 'modelo'}.pdf`
}

/**
 * Meta downloads the header image by URL, so it must be absolute. Rows
 * may hold a path served by the app itself (`/fichas/...`); resolve it
 * against the deployment's public URL. Null when that's impossible —
 * the card then goes out with a text header instead.
 */
export function absoluteMediaUrl(
  url: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const u = (url ?? '').trim()
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  if (!u.startsWith('/')) return null
  const raw =
    env.NEXT_PUBLIC_SITE_URL?.trim() ||
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    env.VERCEL_URL?.trim() ||
    ''
  if (!raw) return null
  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
  return `${base}${u}`
}
