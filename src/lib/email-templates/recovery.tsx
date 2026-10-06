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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

// Also the onboarding email for a client whose account already exists, so it reads as
// "set your password", not only "you forgot it". The link is shown as text too, because
// Gmail disables buttons in anything it files under Spam.
export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Set a new password for your {siteName} account.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Set your {siteName} password</Heading>
        <Text style={text}>
          Tap the button to set a new password and get into your {siteName} account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Set my password
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
          The link works once. If it has expired, request a new one from the sign-in page
          or ask your coach.
        </Text>
        <Text style={footer}>
          Didn't ask for this? You can ignore this email. Your password won't change.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

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
