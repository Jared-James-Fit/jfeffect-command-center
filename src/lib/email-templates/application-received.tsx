import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BrandFooter, BrandHeader } from "./brand";
import type { TemplateEntry } from "./registry";

/*
 * Sent to someone the moment they submit the coaching application (coaching/apply).
 * Replaces the plain-text email that used to go out from Jared's personal Gmail.
 * Replies land in coaching@jfeffect.com.
 */

export interface ApplicationReceivedProps {
  first_name?: string;
  submitted_at?: string;
  main_goal?: string;
  reference?: string;
}

const first = (v: unknown) => String(v ?? "").trim() || "there";

const ApplicationReceivedEmail = (p: ApplicationReceivedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your application is in. Here's what happens next.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>Application received, {first(p.first_name)}.</Heading>
        <Text style={text}>
          Thanks for applying to JF Effect coaching. I or someone on my team will review your
          answers personally and get back to you within 24 to 48 hours with next steps.
        </Text>

        <Section style={noteSection}>
          {p.submitted_at ? (
            <Text style={noteRow}>
              <b>Submitted:</b> {p.submitted_at}
            </Text>
          ) : null}
          {p.main_goal ? (
            <Text style={noteRow}>
              <b>Main goal:</b> {p.main_goal}
            </Text>
          ) : null}
          {p.reference ? (
            <Text style={noteRow}>
              <b>Reference:</b> {p.reference}
            </Text>
          ) : null}
        </Section>

        <Text style={text}>
          Questions before then? Reply to this email and it comes straight to us.
        </Text>

        <Hr style={hr} />
        <Text style={sign}>Jared McIntyre</Text>
        <Text style={role}>Founder &amp; Head Coach, JF Effect</Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  identity: "coaching",
  component: ApplicationReceivedEmail,
  subject: "Your JF Effect coaching application is in",
  displayName: "Coaching application received (applicant)",
  previewData: {
    first_name: "Devin",
    submitted_at: "Nov 23, 2026, 1:15 p.m. CT",
    main_goal: "Build muscle and get my first powerlifting total",
    reference: "3f2a9c1e-0000-4000-8000-000000000000",
  },
} satisfies TemplateEntry;

export default ApplicationReceivedEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Inter, Arial, Helvetica, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const h1 = { fontSize: "24px", fontWeight: "bold" as const, color: "#0b0b0b", margin: "0 0 16px" };
const text = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 14px" };
const noteSection = {
  backgroundColor: "#f5f5f5",
  borderRadius: "10px",
  padding: "14px 16px",
  margin: "6px 0 20px",
};
const noteRow = { fontSize: "14px", color: "#3a3a3a", lineHeight: "1.5", margin: "0 0 4px" };
const hr = { borderColor: "#e5e5e5", margin: "28px 0 16px" };
const sign = { fontSize: "15px", fontWeight: "bold" as const, color: "#0b0b0b", margin: "0" };
const role = { fontSize: "13px", color: "#7a7a7a", margin: "2px 0 0" };
