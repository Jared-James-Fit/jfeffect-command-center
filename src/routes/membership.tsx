import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createJfSignupCheckout, getJfPublicSettings } from "@/lib/jf-billing.functions";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { getMembershipLaunchGate } from "@/lib/membership-launch-gate.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Eye, EyeOff, Receipt, Check, X as XIcon } from "lucide-react";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { MembershipHero, MemberHeroCta, MemberHeroGhost, HeroDecisionArea, MemberDetailsLink } from "@/components/sales/membership-hero";
import { FeatureGrid } from "@/components/sales/feature-grid";
import { IncludedNotIncluded } from "@/components/sales/included-not-included";
import { OfferComparison } from "@/components/sales/offer-comparison";
import { ProofWall } from "@/components/sales/proof-wall";
import { FaqAccordion } from "@/components/sales/faq-accordion";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { AppPreviewGrid } from "@/components/sales/app-preview-grid";
import { FinalCta } from "@/components/sales/final-cta";
import { Reveal } from "@/components/sales/reveal";
import { ArrowRight, Headphones, CheckCircle2, XCircle, Library, PlayCircle, LineChart as LineChartIcon, BookOpen, Sparkles, Dumbbell, Home as HomeIcon, Flame, Trophy } from "lucide-react";
import { normalizePhoneToE164 } from "@/lib/phone-e164";

function HeroSkeleton() {
  return (
    <section className="container mx-auto grid gap-10 px-4 py-14 md:py-20 lg:grid-cols-2 lg:items-center">
      <div className="space-y-4">
        <div className="h-6 w-40 rounded-full bg-muted/50 animate-pulse" />
        <div className="h-12 w-full max-w-xl rounded-md bg-muted/50 animate-pulse" />
        <div className="h-12 w-3/4 rounded-md bg-muted/50 animate-pulse" />
        <div className="h-5 w-full max-w-md rounded-md bg-muted/40 animate-pulse" />
        <div className="h-12 w-48 rounded-md bg-muted/50 animate-pulse" />
      </div>
      <div className="aspect-[4/3] rounded-2xl bg-muted/40 animate-pulse" />
    </section>
  );
}

export const Route = createFileRoute("/membership")({
  component: SignupJf,
  head: () => ({
    meta: [
      { title: "The JF Effect Training App | Self-Guided Membership" },
      { name: "description", content: "The full JF Effect system in your pocket. Structured plans, tracking, demos, analytics and nutrition\u2014train on your schedule. 3-day free trial, then $29/month." },
      { property: "og:title", content: "JF Effect — Self-Guided Membership" },
      { property: "og:description", content: "The full JF Effect system in your pocket. Structured plans, tracking, demos, analytics and nutrition. 3-day free trial, then $29/month." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/membership" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JF Effect — Self-Guided Membership" },
      { name: "twitter:description", content: "The full JF Effect system in your pocket. Structured plans, tracking, demos, analytics and nutrition. 3-day free trial, then $29/month." },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/membership" }],
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
    password: "", confirm: "",
  });
  const [bundledAccepted, setBundledAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    setCancelled(new URLSearchParams(window.location.search).has("cancelled"));
  }, []);
  const [firstChargeLabel, setFirstChargeLabel] = useState<string | null>(null);
  const checkoutBlocked = (settings && !settings.has_monthly_price) || (gate && !gate.ok);
  const requiredDocs = gate?.required_docs ?? [];

  // Validation helpers
  const nameValid = (v: string) => v.trim().length >= 1 && v.trim().length <= 80;
  const emailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const phoneE164 = normalizePhoneToE164(form.phone);
  const phoneValid = phoneE164 !== null;
  const pwValid = form.password.length >= 8;
  const pwMatch = form.password.length > 0 && form.password === form.confirm;

  const allDocsReady = requiredDocs.length === 5;

  const formValid =
    nameValid(form.first_name) && nameValid(form.last_name) &&
    emailValid(form.email) && phoneValid && pwValid && pwMatch &&
    bundledAccepted && allDocsReady && !checkoutBlocked;

  // Build the *exact* bundled acknowledgement statement displayed to the user.
  const monthlyPrice = settings?.monthly_price_display ?? "$29 USD/month";
  const trialDaysLocal = settings?.trial_days ?? 3;
  const bundledStatement = `I agree to the JF Membership Terms, recurring billing, and cancellation policy, and acknowledge the Privacy Policy. Billing: ${trialDaysLocal}-day free trial, then ${monthlyPrice} plus applicable taxes, renews automatically until cancelled.`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ first_name: true, last_name: true, email: true, phone: true, password: true, confirm: true });
    if (checkoutBlocked) {
      return toast.error(gate?.message ?? "Membership checkout is temporarily unavailable. Please contact support.");
    }
    if (!bundledAccepted) return toast.error("Please review and accept the membership terms before continuing.");
    if (!nameValid(form.first_name) || !nameValid(form.last_name)) return toast.error("First and last name are required.");
    if (!emailValid(form.email)) return toast.error("Please enter a valid email address.");
    if (!phoneValid) return toast.error("Please enter a valid phone number. Use 10 digits for US/Canada, or include the country code for international.");
    if (!pwValid) return toast.error("Password must be at least 8 characters.");
    if (!pwMatch) return toast.error("Passwords don't match.");
    if (!allDocsReady) return toast.error("Membership agreements aren't loaded yet. Please refresh and try again.");
    setBusy(true);
    try {
      const r = await createCheckout({ data: {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        phone: phoneE164 ?? form.phone.trim(),
        password: form.password,
        sms_consent: false,
        origin: window.location.origin,
        legal_acceptances: requiredDocs.map((d) => ({
          document_id: d.document_id,
          version_id: d.version_id,
        })),
        acknowledgement_text: bundledStatement,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
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
  const pausedLabel = "Signups Temporarily Paused";

  const featuresRef = useRef<HTMLDivElement>(null);
  const scrollToFeatures = () => featuresRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    setFirstChargeLabel(
      new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString(),
    );
  }, [trialDays]);

  // Map slug -> doc for inline checkbox links
  const docBySlug: Record<string, typeof requiredDocs[number] | undefined> = {};
  for (const d of requiredDocs) docBySlug[d.slug] = d;
  function DocLink({ slug, children }: { slug: string; children: React.ReactNode }) {
    const d = docBySlug[slug];
    if (!d || !d.public_read_allowed) return <span className="font-semibold underline-offset-2">{children}</span>;
    return (
      <Link to="/legal/$slug" params={{ slug: d.slug }} target="_blank" className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80">
        {children}
      </Link>
    );
  }

  return (
    <SalesPageShell pageId="membership-join">
      {p === undefined ? (
        <HeroSkeleton />
      ) : (
      <MembershipHero
        priceChip={settings?.monthly_price_display ?? "$29/month USD"}
        headline={"Stop winging it. Start training like it matters."}
        sub={"The same system I use with my own clients\u2014structured plans, tracking, exercise demos, analytics and nutrition, all in the app. You show up, the plan's already there, and you always know exactly what to do next."}
        heroImage={null}
        decisionArea={
          <HeroDecisionArea
            onCoachingClick={() => { window.location.href = "/coaching"; }}
          />
        }
        primary={<MemberHeroCta onClick={scrollToForm}>{`Start ${trialDays}-Day Free Trial`}</MemberHeroCta>}
        secondary={
          <Link to="/coaching">
            <MemberHeroGhost>Explore Private Coaching</MemberHeroGhost>
          </Link>
        }
        trialNote={`${trialDays}-day free trial · Then ${settings?.monthly_price_display ?? "$29/month USD"} · Cancel anytime`}
        detailsLink={<MemberDetailsLink onClick={scrollToFeatures} />}
      />
      )}

      {/* Coaching callout — sits directly under the hero so Private Coaching
          is visible as a real path within five seconds of landing. */}
      <Section className="!py-8">
        <Link to="/coaching" className="block">
          <div className="mx-auto max-w-5xl rounded-2xl border border-primary/30 bg-gradient-to-br from-[#0F1116] via-[#0B0D12] to-[#0B0D12] p-5 md:p-6 shadow-[0_20px_60px_-20px_rgba(220,38,38,0.35)] hover:border-primary/50 transition-colors">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/15 text-primary">
                  <Headphones className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-black tracking-tight md:text-lg">
                    Want Me in Your Corner Directly?
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Private Coaching means a plan built for you, weekly check-ins, real adjustments, and direct access to me.
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
                    Application required · I keep the roster small on purpose
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <Button size="lg" variant="outline" className="h-11 px-5 text-sm font-bold">
                  View Private Coaching <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </Link>
      </Section>

      {/* Offer comparison surfaced early so visitors see both paths within 5s. */}
      {/* 2. Compare to doing it alone */}
      <div ref={featuresRef} id="features" />
      <Reveal><CompareAloneSection /></Reveal>

      {/* 3. What's included — premium feature cards */}
      <Reveal>
        <FeatureGrid
          title="What's included"
          items={Array.isArray(s.features) && s.features.length > 0 ? s.features : DEFAULT_FEATURES}
        />
      </Reveal>

      {/* 4. Program library showcase */}
      <Reveal><ProgramLibraryShowcase categories={Array.isArray(s.library_categories) && s.library_categories.length > 0 ? s.library_categories : DEFAULT_LIBRARY} programCount={s.program_count ?? ""} /></Reveal>

      {/* 5. Why people stick with it */}
      <Reveal><WhyStickSection /></Reveal>

      {/* 6. Who it's for / not for */}
      <Reveal>
        <IncludedNotIncluded
          includedTitle="This is for you if"
          notIncludedTitle="This is NOT for you if"
          included={Array.isArray(s.who_for) && s.who_for.length > 0 ? s.who_for : DEFAULT_WHO_FOR}
          notIncluded={Array.isArray(s.not_for) && s.not_for.length > 0 ? s.not_for : DEFAULT_NOT_FOR}
        />
      </Reveal>

      {/* 7. App preview */}
      <Reveal>
        <AppPreviewGrid
          title="Here's exactly what you get when you log in."
          sub="Previews are illustrations of the live app interface."
          items={Array.isArray(s.app_previews) && s.app_previews.length > 0 ? s.app_previews : DEFAULT_APP_PREVIEWS}
        />
      </Reveal>

      {/* 8. Proof wall */}
      <Reveal><ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      /></Reveal>

      {/* 9. Coaching vs Membership */}
      <Reveal><OfferComparison accent="membership" /></Reveal>
      <Section className="!pt-0">
        <p className="mx-auto max-w-3xl text-center text-sm text-muted-foreground md:text-base">
          Most people are in the right place right here. But if you want a plan built specifically for you, with weekly check-ins and a coach in your corner, that's{" "}
          <Link to="/coaching" className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80">Private Coaching</Link> — application only.
        </p>
      </Section>

      {/* 10. FAQ */}
      <Reveal><FaqAccordion items={mergeTaxFaq(Array.isArray(s.faq) && s.faq.length > 0 ? s.faq : DEFAULT_FAQ)} /></Reveal>

      {/* 11. Final CTA */}
      <Reveal>
        <FinalCta
          headline="Stop starting over."
          primary={
            <Button size="lg" onClick={scrollToForm} className="h-12 px-6 text-base font-bold">
              {`Start ${trialDays}-Day Free Trial`}
            </Button>
          }
          secondary={
            <span className="ml-1 text-xs text-muted-foreground">{trialDays}-day free trial · Cancel anytime</span>
          }
        />
      </Reveal>

      {/* Signup form */}
      <Section className="!pt-4">
        <div ref={formRef} id="cta" />
        <Card className="mx-auto max-w-xl p-4 md:p-8">
          <h2 className="text-2xl font-black tracking-tight">Create your account</h2>
          <p className="mt-1 text-sm text-foreground">
            $0 today. After your {trialDays}-day trial, your membership renews automatically at {settings?.monthly_price_display ?? "$29 USD/month"} plus applicable taxes until cancelled.
          </p>
          {cancelled && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Checkout was cancelled. You can try again below.
            </div>
          )}
          {checkoutBlocked && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              {gate?.message ?? "Membership checkout is temporarily unavailable."}
              {settings?.support_email ? <> Please contact <a className="underline" href={`mailto:${settings.support_email}`}>{settings.support_email}</a>.</> : null}
            </div>
          )}

          <form onSubmit={submit} className="mt-4 grid gap-3">
            <fieldset disabled={!!checkoutBlocked} className="contents">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="first_name">First name</Label>
                <Input id="first_name" required autoComplete="given-name" value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, first_name: true }))} />
                {touched.first_name && !nameValid(form.first_name) && <FieldError>First name is required.</FieldError>}
              </div>
              <div>
                <Label htmlFor="last_name">Last name</Label>
                <Input id="last_name" required autoComplete="family-name" value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, last_name: true }))} />
                {touched.last_name && !nameValid(form.last_name) && <FieldError>Last name is required.</FieldError>}
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" inputMode="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
              {touched.email && !emailValid(form.email) && <FieldError>Please enter a valid email.</FieldError>}
            </div>
            <div>
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" type="tel" required autoComplete="tel" inputMode="tel"
                placeholder="+1 555 123 4567"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                10 digits for US/Canada (we'll add +1). For international, include the country code starting with +.
                {phoneE164 && form.phone.trim() !== phoneE164 && (
                  <> Saved as <span className="font-mono font-semibold">{phoneE164}</span>.</>
                )}
              </p>
              {touched.phone && !phoneValid && <FieldError>Enter a valid phone number — 10 digits for US/Canada, or include the country code with a + prefix.</FieldError>}
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  required minLength={8}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
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
              <p className="mt-1 text-[11px] text-muted-foreground">At least 8 characters.</p>
              {touched.password && !pwValid && <FieldError>Password must be at least 8 characters.</FieldError>}
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  required minLength={8}
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
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
              {form.confirm.length > 0 && (
                pwMatch ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check className="h-3 w-3" /> Passwords match</p>
                ) : (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-400"><XIcon className="h-3 w-3" /> Passwords don't match</p>
                )
              )}
            </div>

            {/* Compact billing summary */}
            {!checkoutBlocked && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  <Receipt className="h-3.5 w-3.5" /> Billing
                </div>
                <p className="mt-1 text-xs leading-relaxed text-foreground">
                  <span className="font-bold">$0 today.</span> First charge {firstChargeLabel ?? `in ${trialDays} days`} — {settings?.monthly_price_display ?? "$29/month USD"} plus applicable taxes.
                </p>
              </div>
            )}

            {/* Single bundled legal acceptance */}
            {!checkoutBlocked && allDocsReady && (
              <div className="rounded-md border border-border p-3">
                <label className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                  <Checkbox
                    className="mt-0.5"
                    checked={bundledAccepted}
                    onCheckedChange={(c) => setBundledAccepted(!!c)}
                    aria-label="I agree to the membership terms"
                  />
                  <span>
                    I agree to the{" "}
                    <DocLink slug="membership-agreement">JF Membership Terms</DocLink>,{" "}
                    <DocLink slug="recurring-billing-disclosure">recurring billing</DocLink>, and{" "}
                    <DocLink slug="cancellation-and-refund-policy">cancellation policy</DocLink>, and acknowledge the{" "}
                    <DocLink slug="privacy-policy">Privacy Policy</DocLink>.
                  </span>
                </label>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "membership-agreement" }}
                  target="_blank"
                  className="mt-2 inline-block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Review all membership terms
                </Link>
              </div>
            )}

            {/* Concise cancellation summary */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Cancel anytime through your billing page. Access remains active until the end of your current trial or billing period.{" "}
              {docBySlug["cancellation-and-refund-policy"]?.public_read_allowed && (
                <Link to="/legal/$slug" params={{ slug: "cancellation-and-refund-policy" }} target="_blank" className="underline">
                  Cancellation &amp; Refund Policy
                </Link>
              )}
            </p>

            <Button
              type="submit"
              size="lg"
              disabled={busy || !formValid}
              className="mt-2 inline-flex w-full h-12 text-base font-bold md:w-auto"
            >
              {busy ? "Starting checkout…" : checkoutBlocked ? pausedLabel : ctaLabel}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              You'll be redirected to Stripe to enter card details. You won't be charged until the trial ends.
            </p>
            </fieldset>
          </form>
        </Card>
      </Section>

      <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }} className="md:hidden" />
      <StickyMobileCta
        label={checkoutBlocked ? pausedLabel : (busy ? "Starting checkout…" : ctaLabel)}
        disabled={!!checkoutBlocked || busy || !formValid}
        paused={!!checkoutBlocked}
        onClick={() => {
          if (checkoutBlocked) return;
          if (!formValid) { scrollToForm(); return; }
          submit(new Event("submit") as unknown as React.FormEvent);
        }}
      />
    </SalesPageShell>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] font-medium text-rose-400">{children}</p>;
}
