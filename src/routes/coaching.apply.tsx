import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitCoachingApplication } from "@/lib/coaching-applications.functions";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/coaching/apply")({
  component: CoachingApply,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching" },
      { name: "description", content: "Tell us about your goals and we'll get you set up." },
      { property: "og:title", content: "Apply for JF Effect Coaching" },
      { property: "og:description", content: "Tell us about your goals and we'll get you set up." },
    ],
  }),
});

function CoachingApply() {
  if (typeof window !== "undefined") {
    window.location.replace("https://jaredjamesfit.com");
  }
  const submit = useServerFn(submitCoachingApplication);
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "",
    goals: "", training_history: "", schedule: "",
    budget_range: "", timeline: "",
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim()) {
      return toast.error("Name and email are required.");
    }
    setBusy(true);
    try {
      await submit({ data: {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone || undefined,
        goals: form.goals || undefined,
        training_history: form.training_history || undefined,
        schedule: form.schedule || undefined,
        budget_range: form.budget_range || undefined,
        timeline: form.timeline || undefined,
      }});
      setDone(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Submission failed.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <SalesPageShell>
        <Section>
          <Card className="mx-auto max-w-xl p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="mt-4 text-2xl font-black">Application received</h1>
            <p className="mt-2 text-sm text-muted-foreground">We'll review and get back to you. Keep an eye on your email.</p>
            <Button className="mt-6" onClick={() => navigate({ to: "/" })}>Back to home</Button>
          </Card>
        </Section>
      </SalesPageShell>
    );
  }

  return (
    <SalesPageShell>
      <Section className="!py-8">
        <Link to="/coaching" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" />Back to coaching page
        </Link>
        <Card className="mx-auto max-w-2xl p-6 md:p-8">
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">Apply for JF Effect Coaching</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tell us where you are and where you want to go. Takes 2 minutes.</p>
          <form onSubmit={onSubmit} className="mt-6 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Full name *</Label><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Email *</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><Label>Phone (optional)</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Your goals</Label><Textarea rows={3} value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} placeholder="What do you want to achieve in the next 6–12 months?" /></div>
            <div><Label>Training history</Label><Textarea rows={3} value={form.training_history} onChange={(e) => setForm({ ...form, training_history: e.target.value })} placeholder="What's your current and past training look like?" /></div>
            <div><Label>Weekly schedule</Label><Textarea rows={2} value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="Days/times you can train, life constraints…" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Budget range</Label><Input value={form.budget_range} onChange={(e) => setForm({ ...form, budget_range: e.target.value })} placeholder="e.g. $200–500/mo" /></div>
              <div><Label>When do you want to start?</Label><Input value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="ASAP, next month…" /></div>
            </div>
            <Button size="lg" type="submit" disabled={busy} className="mt-2 h-12 text-base font-bold">
              {busy ? "Submitting…" : "Submit application"}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">By submitting you agree to be contacted about your application.</p>
          </form>
        </Card>
      </Section>
    </SalesPageShell>
  );
}