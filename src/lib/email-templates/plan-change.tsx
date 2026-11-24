import * as React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import { LinkHeadsUp } from './link-heads-up'
import type { TemplateEntry } from './registry'

/** A plan change, in writing (plans.server.ts notifyPlanChange): what changed, when, what it costs. */
export interface PlanChangeProps {
  first_name?: string
  headline?: string
  body?: string
  rows?: Array<[string, string]>
  url?: string
  support_email?: string
}

const PlanChangeEmail = (p: PlanChangeProps) => {
  const firstName = p.first_name?.trim() || 'there'
  const url = p.url || 'https://jfeffect.com/portal/plan'
  const support = p.support_email || 'jaredjamesfit@gmail.com'
  const rows = Array.isArray(p.rows) ? p.rows : []
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{p.headline || 'Your JF Effect plan changed'}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{p.headline || 'Your plan changed'}</Heading>
          <Text style={text}>Hi {firstName},</Text>
          {p.body ? <Text style={text}>{p.body}</Text> : null}
          {rows.length ? (
            <Section style={recordSection}>
              {rows.map(([k, v]) => (
                <Text key={k} style={recordLine}>
                  <strong>{k}:</strong> {v}
                </Text>
              ))}
            </Section>
          ) : null}
          <Text style={text}>
            Everything you've logged stays in your account whatever plan you're on: your workouts, PRs, progress and
            nutrition history.
          </Text>
          <Section style={ctaSection}>
            <Button style={button} href={url}>
              See your plan
            </Button>
            <LinkHeadsUp />
          </Section>
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
  component: PlanChangeEmail,
  subject: (data: Record<string, any>) => String(data?.headline || 'Your JF Effect plan changed'),
  displayName: 'Plan change',
  previewData: {
    first_name: 'Jane',
    headline: 'Moving to Nutrition Coaching on Dec 9, 2026',
    body: 'Nothing changes until then. You can undo it any time before.',
    rows: [
      ['From', 'Complete Online Coaching'],
      ['To', 'Nutrition Coaching'],
      ['Takes effect', 'Dec 9, 2026'],
      ['Going forward', '$99 a month + tax'],
    ],
    url: 'https://jfeffect.com/portal/plan',
  },
} satisfies TemplateEntry

export default PlanChangeEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0b0b0b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.55', margin: '0 0 14px' }
const link = { color: '#0b0b0b', textDecoration: 'underline' }
const ctaSection = { margin: '20px 0 24px' }
const recordSection = { backgroundColor: '#f5f5f5', borderRadius: '10px', padding: '14px 16px', margin: '0 0 20px' }
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
