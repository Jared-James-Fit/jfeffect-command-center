import type { ComponentType } from 'react'
import type { EmailIdentityKey } from '@/lib/email-identity'
import { template as membershipOnboarding } from './membership-onboarding'
import { template as setupReminder } from './setup-reminder'
import { template as agreementSigned } from './agreement-signed'
import { template as agreementRequested } from './agreement-requested'
import { approvedTemplate, codeTemplate, receivedTemplate } from './membership-emails'
import { twoStepCodeTemplate } from './two-step-code'
import { template as applicationReceived } from './application-received'
import { template as paymentLink } from './payment-link'
import { template as planChangeTemplate } from './plan-change'
import { teamCodeTemplate, teamInviteTemplate } from './team-emails'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
  /** Which JF Effect department it comes from: sets the From name and Reply-To (default support). */
  identity?: EmailIdentityKey
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'membership-onboarding': membershipOnboarding,
  'setup-reminder': setupReminder,
  'agreement-signed': agreementSigned,
  'agreement-requested': agreementRequested,
  'membership-received': receivedTemplate,
  'membership-approved': approvedTemplate,
  'membership-code': codeTemplate,
  'two-step-code': twoStepCodeTemplate,
  'application-received': applicationReceived,
  'payment-link': paymentLink,
  'plan-change': planChangeTemplate,
  'team-invite': teamInviteTemplate,
  'team-code': teamCodeTemplate,
}
