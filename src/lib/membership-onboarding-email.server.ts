/**
 * Server-only helper that renders the membership-onboarding email template
 * and enqueues it for delivery via the existing transactional email queue.
 *
 * Used by the Stripe webhook on `subscription_purchased`. Honours admin
 * enable/disable toggle, suppression list, and the
 * `membership_onboarding:<member_id>:email` dedupe key.
 *
 * NEVER import this from `*.functions.ts` at module scope, and NEVER from
 * client/browser code — it relies on service-role credentials.
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
  setup_token: string | null
  user_id: string | null
  trial_end_at: string | null
  current_period_end: string | null
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function formatInTz(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'long', day: 'numeric',
    }).format(d)
  } catch {
    return null
  }
}

function firstNameOf(member: MemberLike): string {
  const fn = member.full_name?.split(' ')[0]?.trim()
  if (fn) return fn
  const local = member.email?.split('@')[0]
  return local || 'there'
}

export type OnboardingSendResult =
  | { sent: true; queued: true; messageId: string }
  | { sent: false; reason: 'disabled' | 'no_email' | 'already_sent' | 'suppressed' | 'no_template' | 'failed'; error?: string }

/**
 * Render + enqueue the membership onboarding email for a member.
 * Idempotent on `membership_onboarding:<member.id>:email`.
 */
export async function sendMembershipOnboardingEmail(
  supabaseAdmin: any,
  member: MemberLike,
  origin: string,
): Promise<OnboardingSendResult> {
  try {
    const dedupeKey = `membership_onboarding:${member.id}:email`

    // 0. Dedupe — skip if already sent
    const { data: dupe } = await supabaseAdmin
      .from('notification_dedupe')
      .select('key').eq('key', dedupeKey).eq('channel', 'email').maybeSingle()
    if (dupe) return { sent: false, reason: 'already_sent' }

    // 1. Load admin-editable content / toggle
    const { data: settings } = await supabaseAdmin
      .from('membership_onboarding_email_settings')
      .select('*').eq('id', true).maybeSingle()
    if (!settings || settings.enabled === false) return { sent: false, reason: 'disabled' }

    if (!member.email) return { sent: false, reason: 'no_email' }

    const template = TEMPLATES['membership-onboarding']
    if (!template) return { sent: false, reason: 'no_template' }

    const recipient = member.email
    const normalizedEmail = recipient.toLowerCase()

    // 2. Suppression
    const { data: suppressed } = await supabaseAdmin
      .from('suppressed_emails').select('id').eq('email', normalizedEmail).maybeSingle()
    if (suppressed) return { sent: false, reason: 'suppressed' }

    // 3. Unsubscribe token (one per email)
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

    // 4. Build template data
    const tz = settings.trial_timezone || 'America/Winnipeg'
    const setupLink = member.setup_token && !member.user_id
      ? `${origin}/member-setup?token=${member.setup_token}`
      : null
    const loginLink = `${origin}/auth`
    const billingLink = `${origin}/m/billing`
    const trialEndDisplay = formatInTz(member.trial_end_at, tz)
    // First billing is when the trial ends (or current_period_end if no trial)
    const firstBillingDisplay = trialEndDisplay
      ?? formatInTz(member.current_period_end, tz)

    const templateData = {
      first_name: firstNameOf(member),
      product_name: settings.product_name,
      welcome_message: settings.welcome_message,
      setup_link: setupLink,
      app_login_link: loginLink,
      billing_link: billingLink,
      monthly_price_display: settings.monthly_price_display,
      trial_end_display: trialEndDisplay,
      first_billing_display: firstBillingDisplay,
      cancel_instructions: settings.cancel_instructions,
      support_email: settings.support_email,
      next_step: settings.next_step,
    }

    // 5. Render
    const element = React.createElement(template.component, templateData)
    const html = await render(element)
    const plainText = await render(element, { plainText: true })
    const subject = typeof template.subject === 'function'
      ? template.subject(templateData) : template.subject

    const messageId = crypto.randomUUID()
    const subjectWithName = (settings.subject || subject).replace(/\{first_name\}/g, templateData.first_name)

    // 6. Log pending
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'membership-onboarding',
      recipient_email: recipient,
      status: 'pending',
    })

    // 7. Enqueue
    const { error: enqueueError } = await supabaseAdmin.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload: {
        message_id: messageId,
        to: recipient,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: subjectWithName,
        html,
        text: plainText,
        purpose: 'transactional',
        label: 'membership-onboarding',
        idempotency_key: dedupeKey,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      await supabaseAdmin.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'membership-onboarding',
        recipient_email: recipient,
        status: 'failed',
        error_message: 'enqueue failed: ' + enqueueError.message,
      })
      return { sent: false, reason: 'failed', error: enqueueError.message }
    }

    // 8. Claim dedupe slot
    await supabaseAdmin.from('notification_dedupe').insert({
      key: dedupeKey,
      channel: 'email',
      member_id: member.id,
      metadata: { template: 'membership-onboarding', message_id: messageId },
    }).then(() => {}, () => {})

    return { sent: true, queued: true, messageId }
  } catch (e: any) {
    console.error('[membership-onboarding-email] failed', e)
    return { sent: false, reason: 'failed', error: e?.message ?? String(e) }
  }
}