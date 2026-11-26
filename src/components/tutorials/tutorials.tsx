import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, LifeBuoy, ListChecks, Mail, PlayCircle, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { markFeatureSeen } from "@/lib/feature-seen";
import { useServiceTier } from "@/lib/service-tier";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import {
  TUTORIALS, tutorialDoneKey, tutorialKey, tutorialStatus, tutorialToShow, tutorialsFor, type Tutorial, type TutorialTier,
} from "@/lib/tutorials/registry";
import { searchKb } from "@/lib/support-cleo/rules";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickLogTips } from "@/components/workout-day/quick-log-tips";
import { MemberSetupWizard } from "@/components/member/member-setup-wizard";
import { cn } from "@/lib/utils";
import { CREW_CONTACT_EMAIL, CREW_TERMS_SLUG } from "@/lib/crew-safety";

/** "Replay this tutorial" from anywhere (the hub): the gate in the portal opens it. */
const OPEN_EVENT = "jf:open-tutorial";
export function openTutorial(id: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
}

/** Which tutorials this login has finished or skipped (server-side, every device). */
export function useTutorialSeen() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["tutorial-seen", user?.id ?? null],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("feature_announcement_views")
        .select("feature_key")
        .eq("user_id", user!.id)
        .like("feature_key", "tutorial:%");
      if (error) throw error;
      return new Set<string>(((data ?? []) as { feature_key: string }[]).map((r) => r.feature_key));
    },
  });
  return { seen: q.data ?? null, loading: q.isLoading };
}

function TutorialSheet({ tutorial, tier, onClose }: { tutorial: Tutorial; tier: TutorialTier; onClose: (finished: boolean) => void }) {
  const steps = tutorial.steps(tier);
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  if (!step) return null;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(false); }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]" data-tutorial={tutorial.id}>
        <SheetHeader className="text-left">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{tutorial.title} · {i + 1} of {steps.length}</div>
          <SheetTitle className="text-[20px]">{step.title}</SheetTitle>
          <SheetDescription className="text-[15px] leading-5 text-foreground/80">{step.body}</SheetDescription>
        </SheetHeader>
        <div className="mt-3 flex items-center gap-1.5" aria-hidden>
          {steps.map((_, k) => <span key={k} className={cn("h-1.5 flex-1 rounded-full", k <= i ? "bg-primary" : "bg-muted")} />)}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => onClose(false)} data-tutorial-skip>Skip</Button>
          <Button onClick={() => (last ? onClose(true) : setI(i + 1))} data-tutorial-next>{last ? "Done" : "Next"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Mounted once in the portal: opens a screen's tutorial on its first visit
 * (after the screen settles, never over another sheet or popup, never in
 * View as client), and any tutorial the hub asks to replay.
 */
export function TutorialGate() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const { tier, loading } = useServiceTier();
  const { seen } = useTutorialSeen();
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ t: Tutorial; replay: boolean } | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const t = TUTORIALS.find((x) => x.id === (e as CustomEvent).detail);
      if (t) setOpen({ t, replay: true });
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  useEffect(() => {
    if (isImpersonating || loading || !tier || !seen || open) return;
    const t = tutorialToShow(pathname, tier, seen);
    if (!t) return;
    // let the screen settle, and never stack on a popup or sheet already open
    const timer = window.setTimeout(() => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      setOpen({ t, replay: false });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname, tier, loading, seen, isImpersonating, open]);

  const close = async (finished: boolean) => {
    const was = open;
    setOpen(null);
    if (!was || !user || isImpersonating) return;
    // skipped or finished, it never opens by itself again (any device)
    await markFeatureSeen(user.id, tutorialKey(was.t.id));
    if (finished) await markFeatureSeen(user.id, tutorialDoneKey(was.t.id));
    qc.invalidateQueries({ queryKey: ["tutorial-seen"] });
  };

  if (!open || !tier) return null;
  if (open.t.id === "logger") return <QuickLogTips onClose={() => void close(true)} videoOn={tier === "coaching"} />;
  return <TutorialSheet tutorial={open.t} tier={tier} onClose={(f) => void close(f)} />;
}

/**
 * Account → Help & Tutorials (and from the Support chat): replay any tutorial
 * for what they have, pick setup back up, search the help answers, or ask Cleo.
 */
export function HelpTutorialsHub() {
  const { tier } = useServiceTier();
  const { seen } = useTutorialSeen();
  const fetchSetup = useServerFn(getMySetupStatus);
  const { data: setup } = useQuery({ queryKey: ["m-setup-status"], queryFn: () => fetchSetup(), staleTime: 60_000, enabled: tier === "self_serve" });
  const [wizard, setWizard] = useState(false);
  const [q, setQ] = useState("");
  const t: TutorialTier = tier ?? "self_serve";
  const list = tutorialsFor(t);
  const results = useMemo(() => (q.trim().length >= 2 ? searchKb(q, t, 4) : []), [q, t]);
  const setupOpen = tier === "self_serve" && (setup as any)?.complete === false;

  return (
    <div className="space-y-5" data-help-hub>
      <section className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help" aria-label="Search help" className="h-10 pl-9 text-base" data-help-search />
        </div>
        {q.trim().length >= 2 && (
          results.length ? (
            <ul className="space-y-2">
              {results.map((a) => (
                <li key={a.id} className="rounded-xl border border-border p-3">
                  <div className="text-[15px] font-semibold">{a.title}</div>
                  <p className="mt-0.5 text-[14px] leading-5 text-muted-foreground">{a.answer}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {a.links.map((l) => {
                      const [path, hash] = l.to.split("#");
                      return <Link key={l.to} to={path as any} hash={hash} className="text-[14px] font-semibold text-primary">{l.label} ›</Link>;
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">Nothing in the help answers for that yet. Ask Cleo below.</p>
          )
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Tutorials</h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {list.map((tu) => {
            const status = seen ? tutorialStatus(tu.id, seen) : "new";
            return (
              <li key={tu.id}>
                <button type="button" onClick={() => openTutorial(tu.id)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40" data-help-tutorial={tu.id}>
                  <PlayCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{tu.title}</span>
                  {status === "done" && <Check className="h-4 w-4 shrink-0 text-success" aria-label="Done" />}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-2">
        {setupOpen && (
          <Button variant="secondary" className="justify-start" onClick={() => setWizard(true)} data-help-resume-setup>
            <ListChecks className="mr-2 h-4 w-4" /> Finish setting up
          </Button>
        )}
        {tier === "coaching" && (
          <Button asChild variant="secondary" className="justify-start" data-help-resume-setup>
            <Link to="/portal/goals-setup"><ListChecks className="mr-2 h-4 w-4" /> Goals & Setup</Link>
          </Button>
        )}
        <Button asChild variant="secondary" className="justify-start" data-help-ask-cleo>
          <Link to="/portal/messages" search={{ chat: "support" } as any}><LifeBuoy className="mr-2 h-4 w-4" /> Ask Cleo in JF Effect Support</Link>
        </Button>
      </section>

      {/* published contact (App Review 1.2): a person, by email, for anything in Crew or the app */}
      <section className="space-y-1" data-help-contact>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Contact us</h3>
        <div className="divide-y divide-border rounded-xl border border-border">
          <a href={`mailto:${CREW_CONTACT_EMAIL}`} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-secondary/40">
            <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">{CREW_CONTACT_EMAIL}</span>
              <span className="block text-[13px] text-muted-foreground">Questions, problems, or something in Crew that needs the team</span>
            </span>
          </a>
          <Link to="/legal/$slug" params={{ slug: CREW_TERMS_SLUG }} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-secondary/40">
            <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-[15px]">Terms of Service</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      </section>
      {wizard && <MemberSetupWizard open={wizard} onClose={() => setWizard(false)} />}
    </div>
  );
}
