import * as React from 'react'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text, Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface SetupReminderProps {
  first_name?: string
  app_url?: string
  install_url?: string
  support_email?: string
  custom_note?: string
}

const SetupReminderEmail = (p: SetupReminderProps) => {
  const firstName = p.first_name?.trim() || 'there'
  const appUrl = p.app_url || 'https://jfeffect.com/auth'
  const installUrl = p.install_url || 'https://jfeffect.com/install'
  const support = p.support_email || 'jaredjamesfit@gmail.com'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Finish setting up your JF Effect app — it takes about a minute.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Let's finish setting up your app, {firstName}.</Heading>
          <Text style={text}>
            Your JF Effect account is ready — you just haven't installed the app or finished
            your setup checklist yet. It takes about a minute and means your training, messages,
            and check‑ins live one tap away on your phone.
          </Text>

          {p.custom_note ? (
            <Section style={noteSection}>
              <Text style={noteText}>{p.custom_note}</Text>
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Button style={button} href={installUrl}>Install JF Effect on my phone</Button>
          </Section>

          <Text style={text}>
            Already installed and just need to sign in? <Link href={appUrl} style={link}>Open the app</Link>.
          </Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>What you'll get done</Heading>
          <Text style={textTight}>• Install the app on your phone (Add to Home Screen on iPhone, Install on Android)</Text>
          <Text style={textTight}>• Turn on notifications so you don't miss messages or new workouts</Text>
          <Text style={textTight}>• Confirm your goals and pick your starting program</Text>

          <Hr style={hr} />

          <Text style={footer}>
            Stuck on any step? Reply to this email or write to{' '}
            <Link href={`mailto:${support}`} style={link}>{support}</Link> and I'll walk you through it.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SetupReminderEmail,
  subject: (data: Record<string, any>) => {
    const first = (data?.first_name || 'there').toString().trim() || 'there'
    return `${first}, finish setting up your JF Effect app`
  },
  displayName: 'Setup reminder (admin send)',
  previewData: {
    first_name: 'Jane',
    app_url: 'https://jfeffect.com/auth',
    install_url: 'https://jfeffect.com/install',
    support_email: 'jaredjamesfit@gmail.com',
  },
} satisfies TemplateEntry

export default SetupReminderEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const h2 = { fontSize: '15px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '24px 0 8px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const textTight = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: '0 0 4px' }
const link = { color: '#0b0b0b', textDecoration: 'underline' }
const ctaSection = { margin: '20px 0 28px' }
const noteSection = { backgroundColor: '#f5f5f5', borderRadius: '10px', padding: '14px 16px', margin: '0 0 20px' }
const noteText = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: 0, whiteSpace: 'pre-wrap' as const }
const button = {
  backgroundColor: '#0b0b0b', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const,
  borderRadius: '10px', padding: '12px 22px', textDecoration: 'none', display: 'inline-block',
}
const hr = { borderColor: '#e5e5e5', margin: '28px 0' }
const footer = { fontSize: '12px', color: '#7a7a7a', margin: '6px 0 0' }