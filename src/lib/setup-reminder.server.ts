/**
 * Server-only helper that renders the "Finish setting up your JF Effect app"
 * email and enqueues it on the transactional queue. Mirrors the membership
 * onboarding sender but with a per-day idempotency key so admins can re-send.
 *
 * NEVER import from `*.functions.ts` at module scope or from the browser —
 * relies on the service-role client.
 */
import * as React from 'react'
import { render } from '@react-email/components'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'jfeffect-command-center'
const SENDER_DOMAIN = 'notify.jfeffect.com'
const FROM_DOMAIN = 'jfeffect.com'

type MemberLike = {
  id: string
  email: string | null
  full_name: string | null
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function firstNameOf(m: MemberLike): string {
  const fn = m.full_name?.split(' ')[0]?.trim()
  if (fn) return fn
  const local = m.email?.split('@')[0]
  return local || 'there'
}

export type SetupReminderEmailResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'no_email' | 'suppressed' | 'no_template' | 'already_sent_today' | 'failed'; error?: string }

export async function sendSetupReminderEmail(
  supabaseAdmin: any,
  member: MemberLike,
  origin: string,
  opts: { force?: boolean; customNote?: string } = {},
): Promise<SetupReminderEmailResult> {
  try {
    if (!member.email) return { sent: false, reason: 'no_email' }
    const template = TEMPLATES['setup-reminder']
    if (!template) return { sent: false, reason: 'no_template' }

    const recipient = member.email
    const normalizedEmail = recipient.toLowerCase()

    const day = new Date().toISOString().slice(0, 10)
    const dedupeKey = `setup_reminder:${member.id}:${day}:email`

    if (!opts.force) {
      const { data: dupe } = await supabaseAdmin
        .from('notification_dedupe')
        .select('key').eq('key', dedupeKey).eq('channel', 'email').maybeSingle()
      if (dupe) return { sent: false, reason: 'already_sent_today' }
    }

    const { data: suppressed } = await supabaseAdmin
      .from('suppressed_emails').select('id').eq('email', normalizedEmail).maybeSingle()
    if (suppressed) return { sent: false, reason: 'suppressed' }

    // Unsubscribe token (one per email)
    let unsubscribeToken: string
    const { data: existingToken } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token, used_at').eq('email', normalizedEmail).maybeSingle()
    if (existingToken?.token && !existingToken.used_at) {
      unsubscribeToken = existingToken.token
    } else {
      const fresh = generateToken()
      await supabaseAdmin
        .from('email_unsubscribe_tokens')
        .upsert({ token: fresh, email: normalizedEmail }, { onConflict: 'email', ignoreDuplicates: true })
      const { data: stored } = await supabaseAdmin
        .from('email_unsubscribe_tokens').select('token').eq('email', normalizedEmail).maybeSingle()
      unsubscribeToken = stored?.token ?? fresh
    }

    const baseOrigin = origin || 'https://jfeffect.com'
    const templateData = {
      first_name: firstNameOf(member),
      app_url: `${baseOrigin}/auth`,
      install_url: `${baseOrigin}/install`,
      support_email: 'jaredjamesfit@gmail.com',
      custom_note: opts.customNote?.trim() || undefined,
    }

    const element = React.createElement(template.component, templateData)
    const html = await render(element)
    const plainText = await render(element, { plainText: true })
    const subject = typeof template.subject === 'function'
      ? template.subject(templateData) : template.subject

    const messageId = crypto.randomUUID()

    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'setup-reminder',
      recipient_email: recipient,
      status: 'pending',
    })

    const { error: enqueueError } = await supabaseAdmin.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: messageId,
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text: plainText,
        purpose: 'transactional',
        label: 'setup-reminder',
        idempotency_key: dedupeKey,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      await supabaseAdmin.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'setup-reminder',
        recipient_email: recipient,
        status: 'failed',
        error_message: 'enqueue failed: ' + enqueueError.message,
      })
      return { sent: false, reason: 'failed', error: enqueueError.message }
    }

    await supabaseAdmin.from('notification_dedupe').insert({
      key: dedupeKey,
      channel: 'email',
      member_id: member.id,
      metadata: { template: 'setup-reminder', message_id: messageId },
    }).then(() => {}, () => {})

    return { sent: true, messageId }
  } catch (e: any) {
    console.error('[setup-reminder-email] failed', e)
    return { sent: false, reason: 'failed', error: e?.message ?? String(e) }
  }
}