import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { LinkHeadsUp } from './link-heads-up'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  /** The 6-digit code, for the setup page when they added their own email there. */
  token?: string
}

export const InviteEmail = ({
  siteName,
  confirmationUrl,
  token,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {token ? `Your ${siteName} code is ${token}` : `Your ${siteName} account is ready`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your {siteName} account is ready</Heading>
        <Text style={text}>
          Tap below and pick a password. That's it, you're in.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Set up my account
        </Button>
        <LinkHeadsUp />
        {token ? (
          <>
            <Text style={codeLabel}>Or enter this code on the setup page:</Text>
            <Text style={code}>{token}</Text>
          </>
        ) : null}
        <Text style={footer}>
          Not expecting this? You can ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const codeLabel = { fontSize: '14px', color: '#55575d', margin: '25px 0 6px' }
const code = {
  fontSize: '28px',
  fontWeight: 'bold' as const,
  letterSpacing: '6px',
  color: '#000000',
  margin: '0 0 10px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
