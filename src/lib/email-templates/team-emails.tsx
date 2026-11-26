import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import { BrandFooter, BrandHeader } from "./brand";
import { LinkHeadsUp } from "./link-heads-up";
import type { TemplateEntry } from "./registry";

/*
 * A team invite (a specialist: game day coach, performance specialist) and the
 * code that proves the invite's email is theirs when they opened a link that
 * was texted or copied. The emailed link carries that proof itself.
 */

const first = (v: unknown) => String(v ?? "").trim() || "there";

type InviteProps = {
  first_name?: string;
  title?: string;
  athlete?: string;
  setup_url?: string;
  days?: number;
};

const InviteEmail = (p: InviteProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Set up your JF Effect team account</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>Hey {first(p.first_name)},</Heading>
        <Text style={text}>
          I set you up as {p.title ? `a ${p.title}` : "part of the team"} on JF Effect
          {p.athlete
            ? ` so you can study ${p.athlete}'s lifting: the footage, the training and the numbers`
            : ""}
          .
        </Text>
        <Text style={text}>It's view-only. Nothing you do there changes anyone's training.</Text>
        <Section style={ctaSection}>
          <Button style={button} href={p.setup_url || "https://jfeffect.com"}>
            Set up my account
          </Button>
          <LinkHeadsUp />
        </Section>
        <Hr style={hr} />
        <Text style={sign}>Jared</Text>
        <Text style={footer}>This link is just for you. It works for {p.days ?? 7} days.</Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const teamInviteTemplate = {
  identity: "support",
  component: InviteEmail,
  subject: (d: Record<string, any>) =>
    `${first(d?.first_name)}, your JF Effect team account is ready`,
  displayName: "Team invite (specialist)",
  previewData: {
    first_name: "Jesse",
    title: "Game Day Coach",
    athlete: "Jared",
    setup_url: "https://jfeffect.com/staff-setup?token=demo",
    days: 7,
  },
} satisfies TemplateEntry;

type CodeProps = { first_name?: string; code?: string };

const CodeEmail = (p: CodeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your JF Effect code: {p.code || ""}</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>Your code</Heading>
        <Text style={text}>
          Enter this to finish setting up your JF Effect team account, {first(p.first_name)}.
        </Text>
        <Text style={codeStyle}>{p.code || "000000"}</Text>
        <Text style={footer}>
          It works for 15 minutes. Didn't ask for it? You can ignore this email.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const teamCodeTemplate = {
  identity: "support",
  component: CodeEmail,
  subject: (d: Record<string, any>) =>
    `${String(d?.code ?? "").trim() || "Your"} is your JF Effect code`,
  displayName: "Team setup code",
  previewData: { first_name: "Jesse", code: "482913" },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Inter, Arial, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const h1 = { fontSize: "24px", fontWeight: "bold" as const, color: "#0b0b0b", margin: "0 0 16px" };
const text = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 14px" };
const ctaSection = { margin: "20px 0 24px" };
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
const codeStyle = {
  fontSize: "34px",
  fontWeight: "bold" as const,
  letterSpacing: "8px",
  color: "#0b0b0b",
  margin: "8px 0 18px",
};
const hr = { borderColor: "#e5e5e5", margin: "24px 0" };
const sign = { fontSize: "15px", color: "#0b0b0b", fontWeight: "bold" as const, margin: "0 0 4px" };
const footer = { fontSize: "12px", color: "#7a7a7a", margin: "6px 0 0" };
