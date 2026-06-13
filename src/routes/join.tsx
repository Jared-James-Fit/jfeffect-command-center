import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createJfSignupCheckout, getJfPublicSettings } from "@/lib/jf-billing.functions";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { getMembershipLaunchGate } from "@/lib/membership-launch-gate.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Receipt } from "lucide-react";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { MembershipHero, MemberHeroCta, MemberHeroGhost } from "@/components/sales/membership-hero";
import { FeatureTabs } from "@/components/sales/feature-tabs";
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

function mergeTaxFaq(items: Array<{ q: string; a: string }>) {
  const taxQ = "Are taxes included?";
  const taxA = "Taxes are calculated at checkout where applicable based on your location.";
  const has = items.some((f) => (f.q ?? "").trim().toLowerCase() === taxQ.toLowerCase());
  return has ? items : [...items, { q: taxQ, a: taxA }];
}

function SignupJf() {
  const getSettings = useServerFn(getJfPublicSettings);
  const createCheckout = useServerFn(createJfSignupCheckout);
  const fetchPage = useServerFn(getPublicSalesPage);
  const fetchGate = useServerFn(getMembershipLaunchGate);

  const { data: settings } = useQuery({ queryKey: ["jf-public-settings"], queryFn: () => getSettings() });
  const { data: p } = useQuery({ queryKey: ["public-sales-page", "join"], queryFn: () => fetchPage({ data: { page_key: "join" } }) });
  const { data: gate } = useQuery({ queryKey: ["jf-launch-gate"], queryFn: () => fetchGate() });

  const formRef = useRef<HTMLDivElement>(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    password: "", confirm: "", sms_consent: false,
  });
  // Per-document acceptance state. Keyed by document_id.
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const cancelled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cancelled");
  const checkoutBlocked = (settings && !settings.has_monthly_price) || (gate && !gate.ok);
  const requiredDocs = gate?.required_docs ?? [];
  const allAccepted = requiredDocs.length > 0 && requiredDocs.every((d) => accepted[d.document_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkoutBlocked) {
      return toast.error("Membership checkout is temporarily unavailable. Please contact support.");
    }
    if (!allAccepted) return toast.error("Please accept each required document to continue.");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return toast.error("Passwords don't match.");
    setBusy(true);
    try {
      const r = await createCheckout({ data: {
        first_name: form.first_name, last_name: form.last_name, email: form.email,
        phone: form.phone || undefined, password: form.password,
        sms_consent: !!(form.phone && form.sms_consent),
        origin: window.location.origin,
        legal_acceptances: requiredDocs.map((d) => ({
          document_id: d.document_id,
          version_id: d.version_id,
        })),
        acknowledgement_text: "I have read and agree to the documents listed at JF Membership checkout.",
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

  return (
    <SalesPageShell>
      <MembershipHero
        priceChip={settings?.monthly_price_display ?? "$29/month USD"}
        headline={p?.hero_headline ?? "Train with the JF Effect system. On your own time, inside the app."}
        sub={p?.hero_subheadline ?? "Self-guided programs, workout tracking, analytics, recipes and education — all in one place. No application required. Cancel anytime."}
        heroImage={p?.hero_image_url ?? null}
        primary={<MemberHeroCta onClick={scrollToForm}>{ctaLabel}</MemberHeroCta>}
        secondary={
          <Link to="/coaching">
            <MemberHeroGhost>{p?.secondary_cta_label ?? "Need more support? Apply for Coaching"}</MemberHeroGhost>
          </Link>
        }
        trialNote={`${trialDays}-day free trial · ${settings?.monthly_price_display ?? "$29/month USD"} after · cancel anytime`}
      />

      <FeatureTabs />

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

      <FaqAccordion items={mergeTaxFaq(s.faq ?? [])} />

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
          {checkoutBlocked && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Membership checkout is temporarily unavailable.
              {settings?.support_email ? <> Please contact <a className="underline" href={`mailto:${settings.support_email}`}>{settings.support_email}</a>.</> : null}
            </div>
          )}

          {/* Phase 4 — Recurring billing disclosure (always visible above legal acceptances) */}
          {!checkoutBlocked && requiredDocs.length > 0 && (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <Receipt className="h-3.5 w-3.5" /> Recurring billing
              </div>
              <ul className="mt-2 space-y-1 text-xs text-foreground">
                <li>· {settings?.monthly_price_display ?? "$29/month USD"} after a {trialDays}-day free trial</li>
                <li>· Due today: $0 (you won't be charged until your trial ends)</li>
                <li>· First charge: {new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString()}</li>
                <li>· Billing renews automatically every month until you cancel</li>
                <li>· Cancel anytime — access continues until the end of your current billing period</li>
              </ul>
            </div>
          )}
          <form onSubmit={submit} className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
              <div><Label>Last name</Label><Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
            </div>
            <div><Label>Email</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone (optional)</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  required minLength={8}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>Confirm password</Label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  required minLength={8}
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {/* Phase 4 — per-document legal acceptances (server-validated). */}
            {requiredDocs.length > 0 && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Required agreements
                </div>
                {requiredDocs.map((d) => (
                  <label key={d.document_id} className="flex items-start gap-2 text-xs text-foreground">
                    <Checkbox
                      checked={!!accepted[d.document_id]}
                      onCheckedChange={(c) => setAccepted((s) => ({ ...s, [d.document_id]: !!c }))}
                    />
                    <span>
                      I agree to the{" "}
                      {d.public_read_allowed ? (
                        <Link to="/legal/$slug" params={{ slug: d.slug }} target="_blank" className="underline">
                          {d.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{d.title}</span>
                      )}
                      <span className="ml-1 text-muted-foreground">(v{d.version_number})</span>.
                    </span>
                  </label>
                ))}
              </div>
            )}
            {form.phone && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox checked={form.sms_consent} onCheckedChange={(c) => setForm({ ...form, sms_consent: !!c })} />
                <span>I agree to receive transactional and marketing SMS. Msg/data rates may apply. Reply STOP to opt out.</span>
              </label>
            )}
            <Button
              type="submit"
              size="lg"
              disabled={busy || !!checkoutBlocked || !allAccepted}
              className="mt-2 h-12 text-base font-bold"
            >
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