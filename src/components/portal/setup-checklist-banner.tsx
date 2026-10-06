import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ChevronRight, Camera, IdCard, CalendarClock, Target, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import { setupChecklistSteps, type SetupChecklistKey } from "@/lib/client-setup-checklist";
import { SetupStepSheet, type SetupStepKey } from "@/components/portal/setup-step-sheet";
import { useCoachingAgreement } from "@/components/coaching-agreement/agreement-context";

type Props = { clientId: string; userId: string };
type Item = { key: SetupChecklistKey; label: string; description: string; to?: string; sheet?: SetupStepKey; onClick?: () => void; icon: typeof Camera; done: boolean };

// What each step says to the client. Whether a step is done comes from setupChecklistSteps,
// which the admin client profile reads too.
const STEP_COPY: Record<SetupChecklistKey, Omit<Item, "key" | "done" | "onClick">> = {
  agreement: { label: "Sign your Coaching Agreement", description: "One quick signature covers everything you buy from your coach.", icon: FileSignature },
  profile_picture: { label: "Add a profile photo", description: "A clear headshot helps your coach personalise feedback.", sheet: "profile_picture", icon: Camera },
  basic_info: { label: "Confirm your basic info", description: "Identity, contact, height and emergency contact.", sheet: "basic_info", icon: IdCard },
  training_schedule: { label: "Set your training schedule", description: "Choose the exact days your workouts should land.", sheet: "training_schedule", icon: CalendarClock },
  goals_setup: { label: "Finish Goals & Setup", description: "Goals, availability, experience, equipment, nutrition and injuries — asked once here.", to: "/portal/goals-setup", icon: Target },
};

export function SetupChecklistBanner({ clientId, userId }: Props) {
  const [openStep, setOpenStep] = useState<SetupStepKey | null>(null);
  const agreement = useCoachingAgreement();
  const { data: client, isPending: clientPending, isFetched: clientFetched } = useQuery({
    queryKey: ["setup-banner-client", userId], enabled: !!userId, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, profile_picture_url, profile_picture_needs_update, full_name, first_name, last_name, preferred_name, phone, date_of_birth, height_cm, preferred_height_unit, address, city, province, postal_code, country, timezone, emergency_contact_name, emergency_contact_phone, basic_info_completed_at, training_schedule_completed, committed_training_frequency, committed_training_days")
        .eq("user_id", userId).maybeSingle();
      return data;
    },
  });
  const { data: goals, isPending: goalsPending, isFetched: goalsFetched } = useQuery({
    queryKey: ["client-goals-setup", clientId], enabled: !!clientId, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_goals_setup").select("*").eq("client_id", clientId).maybeSingle();
      return data as ClientGoalsSetupRow | null;
    },
  });

  const items = useMemo<Item[]>(() => {
    // The agreement step only appears once its status has loaded and applies to this account.
    const agreementState = agreement.state?.applicable ? agreement.state.state : null;
    return setupChecklistSteps({ client, goals, agreement: agreementState }).map((step) => ({
      ...STEP_COPY[step.key],
      key: step.key,
      done: step.done,
      onClick: step.key === "agreement" && agreement.canSign ? agreement.openSignFlow : undefined,
    }));
  }, [client, goals, agreement.state, agreement.canSign, agreement.openSignFlow]);

  const done = items.filter((i) => i.done).length;
  if (!clientId || !userId || clientPending || goalsPending || !clientFetched || !goalsFetched || done === items.length) return null;
  const nextItem = items.find((i) => !i.done) ?? items[0];

  return (
    <>
      <Card className="relative overflow-hidden border-primary/30 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2"><h2 className="text-base font-black tracking-tight sm:text-lg">Complete your setup</h2><Badge variant="secondary" className="text-[10px]">{done}/{items.length}</Badge></div>
            <p className="text-xs text-muted-foreground sm:text-sm">Each detail has one home, so you won't be asked the same onboarding questions in multiple setup steps.</p>
          </div>
        </div>
        <div className="mt-3"><Progress value={Math.round((done / items.length) * 100)} /></div>
        <ul className="mt-4 space-y-2">
          {items.map((it) => {
            const Icon = it.icon;
            const rowClass = "flex w-full items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-left text-sm transition hover:bg-background " + (it.done ? "opacity-60" : "");
            const inner = <><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={"font-semibold " + (it.done ? "line-through" : "")}>{it.label}</span>{it.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}</div><div className="text-[11px] text-muted-foreground sm:text-xs">{it.description}</div></div>{!it.done && <ChevronRight className="h-4 w-4 text-muted-foreground" />}</>;
            return <li key={it.key}>{it.onClick || it.key === "agreement" ? <button type="button" className={rowClass} onClick={it.onClick} disabled={it.done || !it.onClick}>{inner}</button> : it.sheet ? <button type="button" className={rowClass} onClick={() => setOpenStep(it.sheet!)} disabled={it.done}>{inner}</button> : <Link to={it.to!} className={rowClass}>{inner}</Link>}</li>;
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">{nextItem.key === "agreement" ? <Button size="sm" onClick={nextItem.onClick} disabled={!nextItem.onClick}>Continue setup</Button> : nextItem.sheet ? <Button size="sm" onClick={() => setOpenStep(nextItem.sheet!)}>Continue setup</Button> : <Button asChild size="sm"><Link to={nextItem.to!}>Continue setup</Link></Button>}</div>
      </Card>
      <SetupStepSheet step={openStep} clientId={clientId} userId={userId} client={client} onOpenChange={(o) => { if (!o) setOpenStep(null); }} />
    </>
  );
}
