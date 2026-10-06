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
  Text,
} from '@react-email/components'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

// The first email a new client gets. Plain, specific and from a named brand: a generic
// "You've been invited" from a system name reads as spam. The link is also shown as text,
// because Gmail disables buttons in anything it files under Spam.
export const InviteEmail = ({
  siteName,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Set up your {siteName} account to see your training, nutrition and check-ins.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your {siteName} account is ready</Heading>
        <Text style={text}>
          Your coach has set up your {siteName} coaching account. Tap the button to
          create your password. Your training, nutrition and check-ins will all be in
          one place.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Set up my account
        </Button>
        <Text style={small}>
          The page can take a few seconds to open, so give it a moment.
        </Text>
        <Text style={small}>
          Button not working? Copy this link into your browser:
          <br />
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={small}>
          The link works once. If it has expired, ask your coach for a new one.
        </Text>
        <Text style={footer}>
          You're getting this because your coach added you as a client at {siteName}.
          If that isn't you, you can ignore this email.
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
const small = {
  fontSize: '12px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '20px 0 0',
}
const link = { color: '#000000', textDecoration: 'underline', wordBreak: 'break-all' as const }
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
