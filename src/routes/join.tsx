import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createJfSignupCheckout, getJfPublicSettings } from "@/lib/jf-billing.functions";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { SalesHero, HeroCta, HeroCtaGhost } from "@/components/sales/sales-hero";
import { AppPreviewGrid } from "@/components/sales/app-preview-grid";
import { FeatureGrid } from "@/components/sales/feature-grid";
import { IncludedNotIncluded } from "@/components/sales/included-not-included";
import { ComparisonCard } from "@/components/sales/comparison";
import { ProofWall } from "@/components/sales/proof-wall";
import { FaqAccordion } from "@/components/sales/faq-accordion";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";

export const Route = createFileRoute("/join")({
  component: SignupJf,
  head: () => ({
    meta: [
      { title: "Join JF Membership — Workouts, Recipes & Tracking" },
      { name: "description", content: "Get instant access to self-guided programs, tracking, recipes, and resources. $29/month with a 3-day free trial." },
      { property: "og:title", content: "JF Membership — $29/mo, 3-day free trial" },
      { property: "og:description", content: "Self-guided workouts, recipes, tracking, resources, and community." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/join" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JF Membership — $29/mo, 3-day free trial" },
      { name: "twitter:description", content: "Self-guided workouts, recipes, tracking, resources, and community." },
    ],
  }),
});

function SignupJf() {
  const getSettings = useServerFn(getJfPublicSettings);
  const createCheckout = useServerFn(createJfSignupCheckout);
  const fetchPage = useServerFn(getPublicSalesPage);

  const { data: settings } = useQuery({ queryKey: ["jf-public-settings"], queryFn: () => getSettings() });
  const { data: p } = useQuery({ queryKey: ["public-sales-page", "join"], queryFn: () => fetchPage({ data: { page_key: "join" } }) });

  const formRef = useRef<HTMLDivElement>(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    password: "", confirm: "", terms: false, sms_consent: false,
  });
  const [busy, setBusy] = useState(false);

  const cancelled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cancelled");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settings && !settings.has_monthly_price) {
      return toast.error("Membership checkout is temporarily unavailable. Please contact support.");
    }
    if (!form.terms) return toast.error("Please accept the terms.");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return toast.error("Passwords don't match.");
    setBusy(true);
    try {
      const r = await createCheckout({ data: {
        first_name: form.first_name, last_name: form.last_name, email: form.email,
        phone: form.phone || undefined, password: form.password,
        sms_consent: !!(form.phone && form.sms_consent),
        origin: window.location.origin,
      }});
      window.location.assign(r.url);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start checkout.");
      setBusy(false);
    }
  };

  const s = p?.sections ?? {};
  const trialDays = settings?.trial_days ?? 3;
  const ctaLabel = p?.primary_cta_label ?? `Start ${trialDays}-Day Free Trial`;

  const previewItems = (p?.visuals ?? [])
    .filter((v) => v.slot === "app_preview" && v.visible !== false)
    .map((v) => ({ label: v.alt || "Preview", url: v.url }));
  const previewFallback = [
    "Plan library", "Workout tracking", "Exercise library", "Recipes",
    "Resources", "Events", "Progress tracking", "Member dashboard",
  ].map((label) => ({ label }));

  return (
    <SalesPageShell>
      <SalesHero
      eyebrow={`JF Membership · ${settings?.monthly_price_display ?? "$29/month USD"}`}
        headline={p?.hero_headline ?? "Train with the JF Effect system without full coaching."}
        sub={p?.hero_subheadline ?? "Get self-guided workout plans, tracking tools, exercise demos, recipes, nutrition resources, events, and member-only updates inside the JF Effect app."}
        image={p?.hero_image_url ?? null}
        primary={<HeroCta onClick={scrollToForm}>{ctaLabel}</HeroCta>}
        secondary={<Link to="/coaching"><HeroCtaGhost>{p?.secondary_cta_label ?? "Apply for Coaching"}</HeroCtaGhost></Link>}
      />

      <AppPreviewGrid
        title="Everything you get inside the app"
        items={previewItems.length > 0 ? previewItems : previewFallback}
      />

      {Array.isArray(s.features) && s.features.length > 0 && (
        <FeatureGrid title="What's inside Membership" items={s.features} />
      )}

      <IncludedNotIncluded
        includedTitle="What's included"
        notIncludedTitle="Not included"
        included={s.included ?? []}
        notIncluded={s.not_included ?? []}
      />

      {s.comparison?.left && s.comparison?.right && (
        <ComparisonCard left={s.comparison.left} right={s.comparison.right} />
      )}

      <ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      />

      <FaqAccordion items={s.faq ?? []} />

      {/* Signup form */}
      <Section className="!pt-4">
        <div ref={formRef} id="cta" />
        <Card className="mx-auto max-w-xl p-6 md:p-8">
          <h2 className="text-2xl font-black tracking-tight">Create your account</h2>
          <p className="mt-1 text-sm text-foreground">
            {trialDays} days free, then {settings?.monthly_price_display ?? "$29/month USD"}.
          </p>
          <p className="text-xs text-muted-foreground">Taxes calculated at checkout where applicable.</p>
          {cancelled && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Checkout was cancelled. You can try again below.
            </div>
          )}
          {settings && !settings.has_monthly_price && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Membership checkout is temporarily unavailable. Please contact support.
            </div>
          )}
          <form onSubmit={submit} className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
              <div><Label>Last name</Label><Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
            </div>
            <div><Label>Email</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone (optional)</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Password</Label><Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><Label>Confirm password</Label><Input type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={form.terms} onCheckedChange={(c) => setForm({ ...form, terms: !!c })} />
              <span>I agree to the terms and refund/cancellation policy.</span>
            </label>
            {form.phone && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox checked={form.sms_consent} onCheckedChange={(c) => setForm({ ...form, sms_consent: !!c })} />
                <span>I agree to receive transactional and marketing SMS. Msg/data rates may apply. Reply STOP to opt out.</span>
              </label>
            )}
            <Button type="submit" size="lg" disabled={busy || (settings && !settings.has_monthly_price)} className="mt-2 h-12 text-base font-bold">
              {busy ? "Starting checkout…" : ctaLabel}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              You'll be redirected to Stripe to enter card details. You won't be charged until the trial ends.
            </p>
            <p className="text-[11px] text-center text-muted-foreground">
              Taxes calculated at checkout where applicable.
            </p>
          </form>
          {settings?.refund_policy && (
            <div className="mt-6 border-t border-border pt-4">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Refund / cancellation policy</div>
              <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{settings.refund_policy}</p>
            </div>
          )}
        </Card>
      </Section>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={ctaLabel} onClick={scrollToForm} />
    </SalesPageShell>
  );
}