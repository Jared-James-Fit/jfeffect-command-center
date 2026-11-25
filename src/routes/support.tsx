import { createFileRoute, Link } from "@tanstack/react-router";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { Block, Group, Heading } from "@/components/sales/apple";
import { shareMeta } from "@/lib/share-meta";

export const SUPPORT_EMAIL = "support@jfeffect.com";

const TITLE = "Support | JF Effect";
const DESCRIPTION = "Help with signing in, your account and data, the Crew, coaching and billing. Email support@jfeffect.com.";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      ...shareMeta({ title: TITLE, description: DESCRIPTION, path: "/support" }),
    ],
  }),
  component: SupportPage,
});

function Mail({ subject }: { subject?: string }) {
  const href = `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return (
    <a href={href} className="font-medium text-primary underline-offset-4 hover:underline">
      {SUPPORT_EMAIL}
    </a>
  );
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 md:p-6">
      <h3 className="text-[17px] font-semibold">{title}</h3>
      <div className="mt-1.5 space-y-2 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

function SupportPage() {
  return (
    <SalesPageShell pageId="support">
      <Block narrow>
        <Heading
          align="left"
          title="Support"
          sub="Help with your JF Effect account and the app."
        />
        <div className="mb-8 rounded-2xl bg-card p-5 ring-1 ring-border/70 md:p-6">
          <div className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Contact</div>
          <p className="mt-1 text-[17px]">
            <Mail />
          </p>
          <p className="mt-1 text-[15px] text-muted-foreground">We reply within 1–2 business days.</p>
        </div>

        <Group>
          <Item title="Signing in or resetting your password">
            <p>
              On the sign-in screen tap <span className="font-medium text-foreground">Forgot password?</span> and
              we'll email you a link to set a new one. If you still can't get in, email <Mail subject="Can't sign in" />.
            </p>
          </Item>
          <Item title="Deleting your account">
            <p>
              In the app go to <span className="font-medium text-foreground">Account → Privacy &amp; data → Delete my account</span>.
              Your account is held for 30 days, so you can sign back in and restore it. After that it's deleted for good.{" "}
              <Link to="/account-deletion" className="font-medium text-primary underline-offset-4 hover:underline">
                More on account deletion
              </Link>
              .
            </p>
          </Item>
          <Item title="AI processing consent">
            <p>
              You choose whether AI features may process your information. Change it any time in{" "}
              <span className="font-medium text-foreground">Account → Privacy &amp; data → AI processing</span>.
            </p>
          </Item>
          <Item title="Reporting or blocking someone in the Crew">
            <p>
              Tap <span className="font-medium text-foreground">⋯</span> on any post, story, comment or profile to
              report it or block the person. The JF Effect team reviews every report within 24 hours.
            </p>
          </Item>
          <Item title="Coaching questions">
            <p>Message your coach in the app. They'll answer you there.</p>
          </Item>
          <Item title="Billing">
            <p>
              Email <Mail subject="Billing question" /> and we'll help.
            </p>
          </Item>
        </Group>

        <p className="mt-8 text-[15px] text-muted-foreground">
          <Link to="/legal/$slug" params={{ slug: "privacy-policy" }} className="font-medium text-primary underline-offset-4 hover:underline">
            Privacy policy
          </Link>
          <span className="mx-2">·</span>
          <Link to="/legal/$slug" params={{ slug: "terms-of-service" }} className="font-medium text-primary underline-offset-4 hover:underline">
            Terms of service
          </Link>
        </p>
      </Block>
    </SalesPageShell>
  );
}
