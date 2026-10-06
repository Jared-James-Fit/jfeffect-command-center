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

export interface AgreementSignedProps {
  first_name?: string
  typed_name?: string
  version?: string
  signed_at_label?: string
  fingerprint?: string
  view_url?: string
  support_email?: string
}

const AgreementSignedEmail = (p: AgreementSignedProps) => {
  const firstName = p.first_name?.trim() || 'there'
  const viewUrl = p.view_url || 'https://jfeffect.com/portal/agreements'
  const support = p.support_email || 'jaredjamesfit@gmail.com'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your signed JF Effect Coaching Agreement is saved in your account.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You're all set, {firstName}.</Heading>
          <Text style={text}>
            Thanks for signing the JF Effect Coaching Agreement. It now covers every service and
            purchase you make with me, and your signed copy is saved in your account.
          </Text>

          <Section style={recordSection}>
            <Text style={recordLine}>
              <strong>Signed by:</strong> {p.typed_name || firstName}
            </Text>
            <Text style={recordLine}>
              <strong>Agreement version:</strong> {p.version || '2.0'}
            </Text>
            {p.signed_at_label ? (
              <Text style={recordLine}>
                <strong>Signed:</strong> {p.signed_at_label}
              </Text>
            ) : null}
            {p.fingerprint ? (
              <Text style={recordLine}>
                <strong>Document fingerprint:</strong> {p.fingerprint}
              </Text>
            ) : null}
          </Section>

          <Section style={ctaSection}>
            <Button style={button} href={viewUrl}>
              View my signed copy
            </Button>
          </Section>

          <Text style={text}>
            You can open it any time in the app under Account, then Coaching Agreement. Keep this
            email as your receipt.
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            Something look wrong? Email{' '}
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
  component: AgreementSignedEmail,
  subject: 'Your signed JF Effect Coaching Agreement',
  displayName: 'Coaching Agreement signed (receipt)',
  previewData: {
    first_name: 'Jane',
    typed_name: 'Jane Doe',
    version: '2.0',
    signed_at_label: 'October 6, 2026 at 3:05 p.m. CT',
    fingerprint: 'fb4251e1e593',
    view_url: 'https://jfeffect.com/portal/agreements',
    support_email: 'jaredjamesfit@gmail.com',
  },
} satisfies TemplateEntry

export default AgreementSignedEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const link = { color: '#0b0b0b', textDecoration: 'underline' }
const ctaSection = { margin: '20px 0 24px' }
const recordSection = {
  backgroundColor: '#f5f5f5',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '0 0 20px',
}
const recordLine = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: '0 0 4px' }
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
