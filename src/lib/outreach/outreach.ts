// ============================================================
// Respuesta manual — pure helpers (migration 047).
//
// The CRM never sends these messages. It fills a template, opens
// WhatsApp (wa.me or WhatsApp Web) on the advisor's own device, and
// records the attempt and its outcome. Pure so it can be unit-tested.
// ============================================================

export const OUTREACH_SEGMENTS = [
  'residente',
  'inversionista',
  'joven',
  'diaspora',
  'patrimonio',
] as const
export type OutreachSegment = (typeof OUTREACH_SEGMENTS)[number]

export const OUTREACH_RESULTS = [
  'sent',
  'replied',
  'meeting',
  'wrong_number',
  'not_interested',
] as const
export type OutreachResult = (typeof OUTREACH_RESULTS)[number]

/** Results the advisor can pick after sending (everything but `sent`). */
export const FINAL_RESULTS: OutreachResult[] = [
  'replied',
  'meeting',
  'wrong_number',
  'not_interested',
]

export const TEMPLATE_NAME_MAX = 60
export const TEMPLATE_BODY_MAX = 1000
export const MESSAGE_MAX = 2000
export const DEFAULT_DAILY_LIMIT = 20

export interface OutreachTemplate {
  id: string
  account_id: string
  name: string
  body: string
  segment: OutreachSegment | null
  campaign_tag: string | null
  active: boolean
  sort_order: number
}

/** Row of the `outreach_queue` view. */
export interface OutreachQueueRow {
  contact_id: string
  account_id: string
  name: string | null
  phone: string
  phone_normalized: string | null
  owner_id: string | null
  created_at: string
  has_chat: boolean
  last_attempt_id: string | null
  last_attempt_at: string | null
  last_result: OutreachResult | null
  last_attempt_by: string | null
  attempts: number
  tags: string[]
}

export type QueueTab = 'pending' | 'followup' | 'done' | 'chatting'
export const QUEUE_TABS: QueueTab[] = ['pending', 'followup', 'done', 'chatting']

/**
 * Which tab a prospect belongs to:
 *   pending  — never contacted by hand and never wrote to the CRM number
 *   followup — contacted, no answer recorded yet
 *   done     — contacted, with an outcome
 *   chatting — wrote to the CRM's WhatsApp on their own (handled in Inbox)
 */
export function queueTab(r: Pick<OutreachQueueRow, 'has_chat' | 'attempts' | 'last_result'>): QueueTab {
  if (r.attempts > 0) return r.last_result === 'sent' || !r.last_result ? 'followup' : 'done'
  return r.has_chat ? 'chatting' : 'pending'
}

/** Lower-case, accents stripped: "Diáspora" → "diaspora". */
export function foldTag(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/** The prospect's segment, read from its tags (first match wins). */
export function segmentFromTags(tags: readonly string[]): OutreachSegment | null {
  for (const t of tags) {
    const f = foldTag(t)
    if ((OUTREACH_SEGMENTS as readonly string[]).includes(f)) return f as OutreachSegment
  }
  return null
}

/** Tags that tell where the prospect came from ("origen:", "campaña:"). */
export function sourceTags(tags: readonly string[]): string[] {
  return tags.filter((t) => /^(origen|campa(ñ|n)a):/i.test(t.trim()))
}

/**
 * Digits wa.me accepts. Mexican numbers: 10 digits get the 52 country
 * code, and the legacy mobile prefix 521 becomes 52. Null when the
 * number is too short to be real.
 */
export function waPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 10) d = `52${d}`
  else if (d.length === 13 && d.startsWith('521')) d = `52${d.slice(3)}`
  return d.length >= 11 && d.length <= 15 ? d : null
}

export type OpenWith = 'app' | 'web'

/** Link that opens a chat with the text typed in (not sent). */
export function whatsappLink(phoneDigits: string, text: string, openWith: OpenWith = 'app'): string {
  const q = encodeURIComponent(text)
  return openWith === 'web'
    ? `https://web.whatsapp.com/send?phone=${phoneDigits}&text=${q}`
    : `https://wa.me/${phoneDigits}?text=${q}`
}

export interface TemplateVars {
  /** Prospect's full name (may be empty). */
  contactName: string | null
  /** Advisor's full name. */
  advisorName: string | null
  /** Advisor's WhatsApp number as typed in their profile. */
  advisorPhone: string | null
}

export const TEMPLATE_VARIABLES = ['{nombre}', '{asesor}', '{telefono_asesor}'] as const

function firstWord(s: string | null | undefined): string {
  return (s ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Fill a template. {nombre} and {asesor} use first names. When a value
 * is missing the placeholder disappears and the punctuation around it
 * is tidied ("Hola {nombre}, …" → "Hola, …").
 */
export function fillTemplate(body: string, v: TemplateVars): string {
  const values: Record<string, string> = {
    nombre: firstWord(v.contactName),
    asesor: firstWord(v.advisorName),
    telefono_asesor: (v.advisorPhone ?? '').trim(),
  }
  return body
    .replace(/\{(nombre|asesor|telefono_asesor)\}/gi, (_, k: string) => values[k.toLowerCase()] ?? '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * Active templates ordered for a prospect: campaign match first, then
 * segment match, then general ones; templates aimed at a different
 * segment or campaign go last (still selectable).
 */
export function rankTemplates(
  templates: readonly OutreachTemplate[],
  tags: readonly string[],
): OutreachTemplate[] {
  const folded = new Set(tags.map(foldTag))
  const segment = segmentFromTags(tags)
  const score = (t: OutreachTemplate): number => {
    let s = 0
    if (t.campaign_tag) s += folded.has(foldTag(t.campaign_tag)) ? 4 : -4
    if (t.segment) s += t.segment === segment ? 2 : -2
    return s
  }
  return templates
    .filter((t) => t.active)
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.t.sort_order - b.t.sort_order || a.i - b.i)
    .map((x) => x.t)
}

/** True when the error came from the daily cap in migration 047. */
export function isDailyLimitError(err: { message?: string; hint?: string } | null | undefined): boolean {
  if (!err) return false
  return err.hint === 'daily_limit' || /outreach_daily_limit/.test(err.message ?? '')
}
