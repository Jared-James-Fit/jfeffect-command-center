import * as React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

/*
 * A two-step sign-in code sent by email (two-step.ts, the email backup): for a
 * team login that doesn't have its phone. The code first, then what to do if
 * it wasn't them: someone has their password.
 */

type Props = { code?: string }

const TwoStepCodeEmail = (p: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your JF Effect sign-in code: {p.code || ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your sign-in code</Heading>
        <Text style={text}>Enter this to confirm it's you signing in to JF Effect.</Text>
        <Text style={codeStyle}>{p.code || '000000'}</Text>
        <Text style={text}>It expires in 10 minutes. Never share it, not even with us.</Text>
        <Text style={footer}>
          Didn't just sign in? Someone has your password. Change it now in Account, and use Face ID or a text to
          sign in.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const twoStepCodeTemplate = {
  component: TwoStepCodeEmail,
  subject: (d: Record<string, any>) => `${String(d?.code ?? '').trim() || 'Your'} is your JF Effect sign-in code`,
  displayName: 'Two-step sign-in code',
  previewData: { code: '482913' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const codeStyle = { fontSize: '34px', fontWeight: 'bold' as const, letterSpacing: '8px', color: '#0b0b0b', margin: '8px 0 18px' }
const footer = { fontSize: '12px', color: '#7a7a7a', lineHeight: '1.5', margin: '6px 0 0' }
