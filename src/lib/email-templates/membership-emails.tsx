import * as React from 'react'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr } from '@react-email/components'
import { BrandFooter, BrandHeader } from './brand'
import { LinkHeadsUp } from './link-heads-up'
import type { TemplateEntry } from './registry'

/*
 * The three emails of free membership by application (membership-apply.ts):
 * got it, you're approved (the activation link), and the code that proves
 * the email is theirs when they opened a link the coach DM'd or texted.
 * Written the way Jared talks: short, direct, no fluff.
 */

const first = (v: unknown) => String(v ?? '').trim() || 'there'

/* ---------- 1. Received ---------- */

type ReceivedProps = { first_name?: string; contact_line?: string; coaching?: boolean; booking_url?: string }

const ReceivedEmail = (p: ReceivedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Got your application. Here's what happens next.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>Got it, {first(p.first_name)}.</Heading>
        <Text style={text}>
          Your JF Effect application is in. I read every one myself, usually within a day.
        </Text>
        <Text style={text}>{p.contact_line || 'I might reach out first to say hi and hear about your goals.'}</Text>
        <Text style={text}>
          Once you're approved you'll get an email from me with your link. Tap it, set a password and you're in. No card, no
          catch.
        </Text>
        {p.coaching && p.booking_url ? (
          <Section style={noteSection}>
            <Text style={noteText}>
              You said you're interested in coaching. If you'd rather talk it through on a quick video call, grab a time here:{' '}
              {p.booking_url}
            </Text>
          </Section>
        ) : null}
        <Hr style={hr} />
        <Text style={sign}>Jared</Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
)

export const receivedTemplate = {
  identity: 'support',
  component: ReceivedEmail,
  subject: 'Got your JF Effect application',
  displayName: 'Membership application received',
  previewData: { first_name: 'Devin', contact_line: "I might send you a quick DM on Instagram to say hi first.", coaching: true, booking_url: 'https://jfeffect.com/book/discovery-call' },
} satisfies TemplateEntry

/* ---------- 2. Approved ---------- */

type ApprovedProps = { first_name?: string; activate_url?: string; note?: string }

const ApprovedEmail = (p: ApprovedProps) => {
  const url = p.activate_url || 'https://jfeffect.com/activate'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You're approved. Set your password and you're in.</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>You're in, {first(p.first_name)}.</Heading>
          <Text style={text}>
            I approved your JF Effect membership. Tap below, pick a password, and you're straight into the app.
          </Text>
          {p.note ? (
            <Section style={noteSection}>
              <Text style={noteText}>{p.note}</Text>
            </Section>
          ) : null}
          <Section style={ctaSection}>
            <Button style={button} href={url}>Set my password</Button>
            <LinkHeadsUp />
          </Section>
          <Text style={text}>
            Inside you'll find programs written by me, a log that tracks every set and PR, and the Crew: people who'll notice
            when you hit one.
          </Text>
          <Hr style={hr} />
          <Text style={sign}>Jared</Text>
          <Text style={footer}>This link is just for you. It works for 30 days.</Text>
          <BrandFooter />
        </Container>
      </Body>
    </Html>
  )
}

export const approvedTemplate = {
  identity: 'support',
  component: ApprovedEmail,
  subject: (d: Record<string, any>) => `${first(d?.first_name)}, you're approved for JF Effect`,
  displayName: 'Membership approved (activation link)',
  previewData: { first_name: 'Devin', activate_url: 'https://jfeffect.com/activate?a=demo' },
} satisfies TemplateEntry

/* ---------- 3. Code ---------- */

type CodeProps = { first_name?: string; code?: string }

const CodeEmail = (p: CodeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your JF Effect code: {p.code || ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>Your code</Heading>
        <Text style={text}>Enter this to finish setting up your JF Effect account, {first(p.first_name)}.</Text>
        <Text style={codeStyle}>{p.code || '000000'}</Text>
        <Text style={footer}>It works for 15 minutes. Didn't ask for it? You can ignore this email.</Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
)

export const codeTemplate = {
  identity: 'support',
  component: CodeEmail,
  subject: (d: Record<string, any>) => `${String(d?.code ?? '').trim() || 'Your'} is your JF Effect code`,
  displayName: 'Membership activation code',
  previewData: { first_name: 'Devin', code: '482913' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const ctaSection = { margin: '20px 0 24px' }
const noteSection = { backgroundColor: '#f5f5f5', borderRadius: '10px', padding: '14px 16px', margin: '0 0 18px' }
const noteText = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: 0, whiteSpace: 'pre-wrap' as const }
const button = {
  backgroundColor: '#0b0b0b', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const,
  borderRadius: '10px', padding: '12px 22px', textDecoration: 'none', display: 'inline-block',
}
const codeStyle = { fontSize: '34px', fontWeight: 'bold' as const, letterSpacing: '8px', color: '#0b0b0b', margin: '8px 0 18px' }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const sign = { fontSize: '15px', color: '#0b0b0b', fontWeight: 'bold' as const, margin: '0 0 4px' }
const footer = { fontSize: '12px', color: '#7a7a7a', margin: '6px 0 0' }
