import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface AgreementRequestedProps {
  first_name?: string
  coach_name?: string
  custom_note?: string
  sign_url?: string
  support_email?: string
  /** True when this is the client's first agreement; false when asking them to sign again. */
  is_first?: boolean
}

const AgreementRequestedEmail = (p: AgreementRequestedProps) => {
  const firstName = p.first_name?.trim() || 'there'
  const coach = p.coach_name?.trim() || 'Coach Jared'
  const signUrl = p.sign_url || 'https://jfeffect.com/portal/agreements?sign=1'
  const support = p.support_email || 'jaredjamesfit@gmail.com'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your JF Effect Coaching Agreement is ready to sign. It takes about 2 minutes.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Please sign your agreement, {firstName}.</Heading>
          <Text style={text}>
            {coach} sent you the JF Effect Coaching Agreement to review and sign in the app. It
            takes about 2 minutes on your phone, and one signature covers everything you buy from
            me, now and later.
          </Text>

          {p.custom_note ? (
            <Section style={noteSection}>
              <Text style={noteText}>{p.custom_note}</Text>
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Button style={button} href={signUrl}>
              Review and sign
            </Button>
          </Section>

          <Text style={text}>
            You will also see a reminder in the app each time you open it until it is signed. Your
            signed copy is saved in your account, and you will get a receipt by email.
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            Questions about anything in it? Reply to this email or write to{' '}
            <Link href={`mailto:${support}`} style={link}>
              {support}
            </Link>
            . This is a service message about your account, not marketing.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AgreementRequestedEmail,
  subject: (data: Record<string, any>) => {
    const first = (data?.first_name || 'there').toString().trim() || 'there'
    return `${first}, please sign your JF Effect Coaching Agreement`
  },
  displayName: 'Coaching Agreement to sign (admin send)',
  previewData: {
    first_name: 'Jane',
    coach_name: 'Coach Jared',
    sign_url: 'https://jfeffect.com/portal/agreements?sign=1',
    support_email: 'jaredjamesfit@gmail.com',
  },
} satisfies TemplateEntry

export default AgreementRequestedEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const link = { color: '#0b0b0b', textDecoration: 'underline' }
const ctaSection = { margin: '20px 0 28px' }
const noteSection = {
  backgroundColor: '#f5f5f5',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '0 0 20px',
}
const noteText = {
  fontSize: '14px',
  color: '#3a3a3a',
  lineHeight: '1.5',
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
}
const button = {
  backgroundColor: '#0b0b0b',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '10px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#e5e5e5', margin: '28px 0' }
const footer = { fontSize: '12px', color: '#7a7a7a', margin: '6px 0 0' }
