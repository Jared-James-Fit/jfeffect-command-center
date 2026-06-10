import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createJfSignupCheckout, getJfPublicSettings } from "@/lib/jf-billing.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/signup/jf")({
  component: SignupJf,
  head: () => ({
    meta: [
      { title: "Join JF Membership — Workouts, Recipes & Tracking" },
      { name: "description", content: "Get instant access to self-guided programs, tracking, recipes, and resources. $29/month with a 3-day free trial." },
      { property: "og:title", content: "JF Membership — $29/mo, 3-day free trial" },
      { property: "og:description", content: "Self-guided workouts, recipes, tracking, resources, and community." },
    ],
  }),
});

const INCLUDED = [
  "Self-guided workout plans", "Workout tracking", "Exercise library", "Recipe library",
  "Nutrition resources", "Resource library", "Events", "Announcements",
  "Progress tracking", "Community / group chats",
];
const NOT_INCLUDED = [
  "1:1 coaching", "Custom workout programming", "Custom nutrition targets",
  "Lift reviews", "Weekly check-in reviews", "Manual coach feedback",
];

function SignupJf() {
  const getSettings = useServerFn(getJfPublicSettings);
  const createCheckout = useServerFn(createJfSignupCheckout);
  const { data: settings } = useQuery({ queryKey: ["jf-public-settings"], queryFn: () => getSettings() });

  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    password: "", confirm: "", terms: false, sms_consent: false,
  });
  const [busy, setBusy] = useState(false);

  const cancelled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cancelled");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link to="/" className="font-bold text-lg">JF Effect</Link>
          <Link to="/auth"><Button variant="ghost" size="sm">Sign in</Button></Link>
        </div>
      </header>
      <main className="container mx-auto grid gap-8 px-4 py-10 lg:grid-cols-2">
        {/* Left: pitch */}
        <section className="space-y-6">
          <div>
            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 border border-emerald-500/30">
              <Sparkles className="h-3 w-3" /> JF Membership
            </div>
            <h1 className="mt-3 text-4xl font-bold">{settings?.monthly_price_display ?? "$29/month"}</h1>
            <p className="mt-2 text-muted-foreground">
              {settings?.trial_days ?? 3}-day free trial. Cancel anytime before it ends.
            </p>
          </div>

          <Card className="border-emerald-500/30 bg-emerald-500/5 p-5">
            <div className="text-xs uppercase tracking-wider text-emerald-300/80 font-semibold mb-3">What's included</div>
            <ul className="space-y-1.5 text-sm">
              {INCLUDED.map((x) => (
                <li key={x} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{x}</li>
              ))}
            </ul>
          </Card>

          <Card className="border-border p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Not included</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {NOT_INCLUDED.map((x) => (
                <li key={x} className="flex items-center gap-2"><XCircle className="h-4 w-4" />{x}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs">Need coaching? You can upgrade after signup.</p>
          </Card>

          {settings?.refund_policy && (
            <Card className="border-border p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Refund / cancellation policy</div>
              <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{settings.refund_policy}</p>
            </Card>
          )}
        </section>

        {/* Right: form */}
        <section>
          <Card className="p-6 sticky top-6">
            <h2 className="text-xl font-semibold">Create your account</h2>
            <p className="text-sm text-muted-foreground mt-1">Start your free trial. No charge for {settings?.trial_days ?? 3} days.</p>
            {cancelled && (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                Checkout was cancelled. You can try again below.
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
              <Button type="submit" size="lg" disabled={busy} className="mt-2">
                {busy ? "Starting checkout…" : `Start ${settings?.trial_days ?? 3}-day free trial`}
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                You'll be redirected to Stripe to enter card details. You won't be charged until the trial ends.
              </p>
            </form>
          </Card>
        </section>
      </main>
    </div>
  );
}