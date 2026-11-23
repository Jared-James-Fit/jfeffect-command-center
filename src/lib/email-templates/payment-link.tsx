import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BrandFooter, BrandHeader } from "./brand";
import { LinkHeadsUp } from "./link-heads-up";
import type { TemplateEntry } from "./registry";

/*
 * The Stripe payment link a coach sends from a purchase (admin "Send link", Cleo).
 * Replaces the plain-text email that used to go out from Jared's personal Gmail.
 * Replies land in billing@jfeffect.com.
 */

export interface PaymentLinkProps {
  first_name?: string;
  offer_name?: string;
  payment_url?: string;
  amount_label?: string;
  payment_structure?: string;
}

const first = (v: unknown) => String(v ?? "").trim() || "there";

const PaymentLinkEmail = (p: PaymentLinkProps) => {
  const url = p.payment_url || "https://jfeffect.com";
  const offer = p.offer_name || "your JF Effect program";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your secure payment link for {offer}.</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>Your payment link is ready.</Heading>
          <Text style={text}>
            Hi {first(p.first_name)}, here's your secure Stripe checkout for <b>{offer}</b>.
          </Text>

          {p.amount_label || p.payment_structure ? (
            <Section style={noteSection}>
              {p.amount_label ? (
                <Text style={noteRow}>
                  <b>Amount:</b> {p.amount_label}
                </Text>
              ) : null}
              {p.payment_structure ? (
                <Text style={noteRow}>
                  <b>Payment structure:</b> {p.payment_structure}
                </Text>
              ) : null}
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Button style={button} href={url}>
              Complete payment
            </Button>
            <LinkHeadsUp />
          </Section>

          <Text style={small}>
            Button not working? Paste this into your browser:{" "}
            <Link href={url} style={link}>
              {url}
            </Link>
          </Text>

          <Hr style={hr} />
          <Text style={text}>
            Questions before you pay? Reply to this email and it comes straight to our billing
            inbox.
          </Text>
          <BrandFooter />
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  identity: "billing",
  component: PaymentLinkEmail,
  subject: (data: Record<string, any>) =>
    `Complete your payment for ${String(data?.offer_name || "JF Effect coaching").trim()}`,
  displayName: "Payment link (admin send)",
  previewData: {
    first_name: "Devin",
    offer_name: "6 Month Transformation",
    payment_url: "https://buy.stripe.com/test_example",
    amount_label: "CAD 1,200",
    payment_structure: "6 monthly payments",
  },
} satisfies TemplateEntry;

export default PaymentLinkEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Inter, Arial, Helvetica, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const h1 = { fontSize: "24px", fontWeight: "bold" as const, color: "#0b0b0b", margin: "0 0 16px" };
const text = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 14px" };
const small = {
  fontSize: "13px",
  color: "#7a7a7a",
  lineHeight: "1.5",
  margin: "0 0 14px",
  wordBreak: "break-all" as const,
};
const link = { color: "#0b0b0b", textDecoration: "underline" };
const noteSection = {
  backgroundColor: "#f5f5f5",
  borderRadius: "10px",
  padding: "14px 16px",
  margin: "6px 0 20px",
};
const noteRow = { fontSize: "14px", color: "#3a3a3a", lineHeight: "1.5", margin: "0 0 4px" };
const ctaSection = { margin: "8px 0 20px" };
const button = {
  backgroundColor: "#0b0b0b",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold" as const,
  borderRadius: "10px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const hr = { borderColor: "#e5e5e5", margin: "28px 0 16px" };
