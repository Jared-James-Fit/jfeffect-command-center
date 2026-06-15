import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface MembershipOnboardingProps {
  first_name?: string
  product_name?: string
  welcome_message?: string
  setup_link?: string
  app_login_link?: string
  billing_link?: string
  monthly_price_display?: string
  trial_end_display?: string
  first_billing_display?: string
  cancel_instructions?: string
  support_email?: string
  next_step?: string
}

const MembershipOnboardingEmail = (p: MembershipOnboardingProps) => {
  const firstName = p.first_name?.trim() || 'there'
  const productName = p.product_name || 'JF Membership'
  const setupOrLogin = p.setup_link || p.app_login_link || 'https://jfeffect.com/auth'
  const billingLink = p.billing_link || 'https://jfeffect.com/m/billing'
  const price = p.monthly_price_display || '$29 USD/month plus applicable tax'
  const trialEnd = p.trial_end_display
  const firstBilling = p.first_billing_display
  const support = p.support_email || 'jaredjamesfit@gmail.com'
  const welcome = p.welcome_message ||
    "You're officially in. JF Membership gives you Jared's training brain — programs, recipes, articles, and the tools to keep training intelligently for the long haul."
  const nextStep = p.next_step ||
    "Open the app, finish setting up your account, and browse this month's training and recipes."
  const cancel = p.cancel_instructions ||
    `Cancel anytime from Billing in the app, or email ${support} and we'll take care of it before your next charge.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Welcome to {productName} — your trial is live.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome, {firstName}.</Heading>
          <Text style={text}>{welcome}</Text>

          <Section style={ctaSection}>
            <Button style={button} href={setupOrLogin}>
              {p.setup_link ? 'Finish setting up your account' : 'Log in to the app'}
            </Button>
          </Section>

          <Heading as="h2" style={h2}>What you signed up for</Heading>
          <Text style={text}><strong>{productName}</strong></Text>
          <Text style={textTight}>Price: {price}</Text>
          {trialEnd ? <Text style={textTight}>Trial ends: {trialEnd}</Text> : null}
          {firstBilling ? <Text style={textTight}>First billing date: {firstBilling}</Text> : null}
          <Text style={textTight}>
            Manage your subscription: <Link href={billingLink} style={link}>{billingLink}</Link>
          </Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Your next step</Heading>
          <Text style={text}>{nextStep}</Text>

          <Heading as="h2" style={h2}>Cancel anytime</Heading>
          <Text style={text}>{cancel}</Text>

          <Hr style={hr} />

          <Text style={footer}>
            Questions? Reply to this email or write to{' '}
            <Link href={`mailto:${support}`} style={link}>{support}</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MembershipOnboardingEmail,
  subject: (data: Record<string, any>) => {
    const first = (data?.first_name || 'there').toString().trim() || 'there'
    return `Welcome to ${data?.product_name || 'JF Membership'} — ${first}, you're in`
  },
  displayName: 'Membership Onboarding (subscription_purchased)',
  previewData: {
    first_name: 'Jane',
    product_name: 'JF Membership',
    setup_link: 'https://jfeffect.com/member-setup?token=preview',
    billing_link: 'https://jfeffect.com/m/billing',
    monthly_price_display: '$29 USD/month plus applicable tax',
    trial_end_display: 'June 18, 2026',
    first_billing_display: 'June 18, 2026',
    support_email: 'jaredjamesfit@gmail.com',
  },
} satisfies TemplateEntry

export default MembershipOnboardingEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const h2 = { fontSize: '15px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '24px 0 8px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const textTight = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: '0 0 4px' }
const link = { color: '#0b0b0b', textDecoration: 'underline' }
const ctaSection = { margin: '20px 0 28px' }
const button = {
  backgroundColor: '#0b0b0b', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const,
  borderRadius: '10px', padding: '12px 22px', textDecoration: 'none', display: 'inline-block',
}
const hr = { borderColor: '#e5e5e5', margin: '28px 0' }
const footer = { fontSize: '12px', color: '#7a7a7a', margin: '6px 0 0' }