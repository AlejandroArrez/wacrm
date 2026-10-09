import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError, type AiUsage } from '@/lib/ai/types'
import { generateStudioCopy, parseStudioBody, studioModel } from '@/lib/studio/claude'

// Copy for three variants with a photo can take most of a minute.
export const maxDuration = 120

/**
 * POST /api/studio/copy  (admin+)
 *
 * Body: { prompt, image?: { media_type, data } }
 * Returns: { result } — the JSON object the content generator renders
 * as variants. Uses the account's Anthropic key from Settings → AI
 * assistant (independent of the WhatsApp bot's on/off switch) and logs
 * the spend per user as mode 'studio'.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const userLimit = checkRateLimit(`studio:${userId}`, RATE_LIMITS.studio)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(`studio-acct:${accountId}`, RATE_LIMITS.studioAccount)
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const parsed = parseStudioBody(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, code: parsed.code },
        { status: parsed.code === 'too_large' ? 413 : 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
      console.error('[studio/copy] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config || config.provider !== 'anthropic') {
      return NextResponse.json(
        {
          error: 'The content generator needs an Anthropic key in Settings → AI assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const model = studioModel()
    const log = (usage: AiUsage | null) => {
      try {
        void logAiUsage(supabaseAdmin(), {
          accountId,
          conversationId: null,
          mode: 'studio',
          provider: 'anthropic',
          model,
          usage,
          userId,
        })
      } catch (logErr) {
        console.error('[studio/copy] usage log skipped:', logErr)
      }
    }

    try {
      const { result, usage } = await generateStudioCopy({
        apiKey: config.apiKey,
        model,
        request: parsed.value,
      })
      log(usage)
      return NextResponse.json({ result })
    } catch (err) {
      // Tokens spent on a refusal or a malformed reply still count.
      const usage = (err as { usage?: AiUsage | null })?.usage ?? null
      if (usage) log(usage)
      throw err
    }
  } catch (err) {
    if (err instanceof AiError) {
      const code = err.code === 'timeout' || err.code === 'network_error' || err.code === 'provider_error'
        ? 'upstream_error'
        : err.code
      return NextResponse.json({ error: err.message, code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
