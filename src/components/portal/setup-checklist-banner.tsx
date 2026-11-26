import { MemberSetupWizard } from "@/components/member/member-setup-wizard";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useGoalsServiceScope } from "@/lib/client-goals/use-goals-service-scope";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ChevronRight, Camera, IdCard, CalendarClock, CalendarPlus, Target, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getMyCalendarSyncStatus } from "@/lib/schedule.functions";
import { usePovFn } from "@/lib/client-pov-args";
import { calendarSyncState } from "@/lib/calendar-sync";
import { isBasicInfoComplete } from "@/lib/basic-info";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import { SetupStepSheet, type SetupStepKey } from "@/components/portal/setup-step-sheet";
import { useCoachingAgreement } from "@/components/coaching-agreement/agreement-context";
import { agreementPrompt } from "@/components/coaching-agreement/agreement-copy";
import { useHeadshotCamera, useMyHeadshot } from "@/components/headshots/headshot-ui";

type Props = {
  clientId: string;
  userId: string;
  /**
   * Shown instead of the checklist once it has nothing to ask but the
   * agreement (a client who finished setup and is asked to sign a new
   * version, or whose coach sent it again): Home's agreement card, so the
   * agreement is never asked for twice and setup never comes back for it.
   */
  whenHidden?: ReactNode;
};
type ItemKey = `meet:${string}` | "calendar" | "agreement" | "profile_picture" | "basic_info" | "training_schedule" | "goals_setup" | "member_setup";
type Item = { key: ItemKey; label: string; description: string; to?: string; search?: Record<string, unknown>; sheet?: SetupStepKey; onClick?: () => void; icon: typeof Camera; done: boolean; optional?: boolean };

export function SetupChecklistBanner({ clientId, userId, whenHidden = null }: Props) {
  const [openStep, setOpenStep] = useState<SetupStepKey | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const { isImpersonating } = useClientImpersonation();
  const agreement = useCoachingAgreement();
  const scope = useGoalsServiceScope(clientId);
  const memberEnabled = scope.requirements?.memberSetup === true;
  const memberApplies = scope.membership?.applicable === true;
  const memberFree = scope.membership?.free === true;
  const needsGoals = scope.requirements?.coachingGoals === true;
  const { data: client, isPending: clientPending, isFetched: clientFetched, isError: clientError, refetch: retryClient } = useQuery({
    queryKey: ["setup-banner-client", userId], enabled: !!userId, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients")
        .select("id, profile_picture_url, profile_picture_needs_update, full_name, first_name, last_name, preferred_name, phone, date_of_birth, sex, height_cm, preferred_height_unit, address, city, province, postal_code, country, timezone, emergency_contact_name, emergency_contact_phone, basic_info_completed_at, training_schedule_completed, committed_training_frequency, committed_training_days")
        .eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: goals, isPending: goalsPending, isFetched: goalsFetched, isError: goalsError, refetch: retryGoals } = useQuery({
    queryKey: ["client-goals-setup", clientId], enabled: !!clientId && needsGoals, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("client_goals_setup").select("*").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return data as ClientGoalsSetupRow | null;
    },
  });

  const calFn = usePovFn(useServerFn(getMyCalendarSyncStatus));
  const { data: cal } = useQuery({
    queryKey: ["my-calendar-sync-setup", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: () => calFn({ data: {} }),
  });
  // the account headshot step: a new client's first one (an update someone asked for is Home's own card)
  const { data: headshot } = useMyHeadshot();
  const camera = useHeadshotCamera();
  const headshotNeeded = !!headshot?.outstanding && headshot.status === "missing";
  const headshotDone = !!headshot && (!headshot.applies || headshot.status === "pending" || headshot.status === "verified" || headshot.status === "previous" || headshot.status === "retake_requested");
  const calendarDone = !!cal?.google?.connected || calendarSyncState({ lastFetchAt: cal?.lastFetchAt }) === "synced";

  const items = useMemo<Item[]>(() => {
    const c = client as any;
    const base: Item[] = [
      {
        key: "profile_picture",
        label: "Add your account headshot",
        description: headshot?.status === "pending" ? "Sent. Your coach will review it." : "A quick live photo so your coach can recognize you. Private to your coach.",
        onClick: isImpersonating ? () => setOpenStep("profile_picture") : camera.open,
        icon: Camera,
        done: headshotDone || (!headshotNeeded && !!c?.profile_picture_url),
        // not asked of someone who joined before account headshots: there if they'd like it, never in the way
        optional: !headshotNeeded && !headshotDone,
      },
      { key: "basic_info", label: "Confirm your basic info", description: "Identity, contact, height and emergency contact.", sheet: "basic_info", icon: IdCard, done: !!c && isBasicInfoComplete(c) },
      { key: "training_schedule", label: "Set your training schedule", description: "Choose the exact days your workouts should land.", sheet: "training_schedule", icon: CalendarClock, done: !!c?.training_schedule_completed },
      { key: "goals_setup", label: scope.nutritionOnly ? "Finish nutrition setup" : "Finish Goals & Setup", description: scope.nutritionOnly ? "Nutrition preferences and goals for your coach." : "Goals, availability, experience, equipment, nutrition and injuries — asked once here.", to: "/portal/goals-setup", icon: Target, done: isGoalsSetupComplete(goals ?? null, scope.nutritionOnly) },
      { key: "calendar", label: "Sync your calendar", description: "Optional: add your sessions and workouts to Google, Apple or Outlook.", to: "/portal/calendar", search: { sync: 1 }, icon: CalendarPlus, done: calendarDone, optional: true },
    ];
    // The Coaching Agreement is the one mandatory step, so it leads the list. It only
    // appears once its status has loaded and applies to this account.
    // Its words follow the agreement card's (a new version, the coach's note) so
    // nothing the card said is lost while the checklist stands in for it.
    if (agreement.state?.applicable && agreement.state.state) {
      const prompt = agreementPrompt(agreement.state);
      base.unshift({
        key: "agreement",
        label: prompt.title,
        description: prompt.note || "One quick signature covers everything you buy from your coach.",
        onClick: agreement.canSign ? agreement.openSignFlow : undefined,
        icon: FileSignature,
        done: agreement.state.state.state !== "needs_signature",
        to: "/portal/account",
      });
    }
    const req = scope.requirements;
    const applicable = base.filter(i => {
      switch (i.key) {
        case "profile_picture": return !!req?.headshot;
        case "basic_info": return !!req?.basicInfo;
        case "training_schedule": return !!req?.trainingSchedule;
        case "goals_setup": return !!req?.coachingGoals;
        case "agreement": return !!req?.coachingGoals;
        default: return true;
      }
    });
    if (memberApplies) applicable.unshift({
      key: "member_setup", label: memberFree ? "Set up your training" : "Finish your membership setup",
      description: memberFree ? "Your goal, experience and training days." : "Your remaining membership details.",
      icon: IdCard, done: scope.membership?.complete === true, onClick: memberEnabled ? () => setMemberOpen(true) : undefined, to: "/portal/account",
    });
    for (const meet of scope.handlingMeets) applicable.push({ key: `meet:${meet.id}`, label: "Competition setup", description: meet.done ? meet.name : `${meet.name} · ${meet.remaining.length} steps remaining`, to: "/portal/competition", search: { meet: meet.id, onboard: true }, icon: Target, done: meet.done });
    return applicable;
  }, [client, goals, calendarDone, agreement.state, agreement.canSign, agreement.openSignFlow, headshot, headshotDone, headshotNeeded, camera.open, isImpersonating, scope.nutritionOnly, scope.handlingMeets, scope.requirements, memberApplies, memberFree, scope.membership?.complete, memberEnabled]);

  // Optional steps (calendar sync) never count toward progress, the next action, or the banner's visibility.
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  if (!clientId || !userId) return null;
  if (scope.error || clientError || (needsGoals && goalsError)) return <Card className="space-y-2 p-4" data-testid="setup-checklist-error"><h2 className="text-base font-semibold">Complete your setup</h2><p className="text-sm text-muted-foreground">We couldn't load your setup details. Try again to see what is left.</p><Button size="sm" variant="outline" onClick={() => { void Promise.all([scope.retry(), retryClient(), ...(needsGoals ? [retryGoals()] : [])]); }}>Try again</Button></Card>;
  if (!scope.ready || clientPending || !clientFetched || (needsGoals && (goalsPending || !goalsFetched))) return null;
  // Nothing left, or only the agreement: the agreement card (whenHidden) asks for it on its own.
  const open = required.filter((i) => !i.done);
  if (open.length === 0 || open.every((i) => i.key === "agreement")) return <>{whenHidden}{camera.element}</>;
  const nextItem = open[0] ?? required[0];

  return (
    <>
      <Card className="p-4 sm:p-5" data-testid="setup-checklist">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2"><h2 className="text-base font-semibold tracking-tight">Complete your setup</h2><Badge variant="secondary" className="text-[11px]">{done}/{required.length}</Badge></div>
          <p className="text-[13px] text-muted-foreground">{needsGoals ? "A few quick steps so your coach can tailor your program." : scope.handlingMeets.length ? "Complete your account and competition setup." : "A few quick details to get started."}</p>
        </div>
        <div className="mt-3"><Progress value={Math.round((done / required.length) * 100)} /></div>
        <ul className="mt-3 divide-y divide-border">
          {items.map((it) => {
            const Icon = it.icon;
            const rowClass = "flex min-h-12 w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left text-sm transition hover:bg-muted/50 active:bg-muted/60 disabled:hover:bg-transparent " + (it.done ? "opacity-60" : "");
            const inner = <><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={"font-semibold " + (it.done ? "line-through" : "")}>{it.label}</span>{it.optional && <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium text-muted-foreground">Optional</Badge>}{it.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}</div><div className="text-xs text-muted-foreground">{it.description}</div></div>{!it.done && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}</>;
            return <li key={it.key}>{it.onClick || (it.key === "agreement" && !isImpersonating) ? <button type="button" className={rowClass} onClick={it.onClick} disabled={it.done || !it.onClick}>{inner}</button> : it.sheet ? <button type="button" className={rowClass} onClick={() => setOpenStep(it.sheet!)} disabled={it.done}>{inner}</button> : <Link to={it.to!} search={it.search as any} className={rowClass}>{inner}</Link>}</li>;
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">{(nextItem.key === "agreement" && !isImpersonating) || nextItem.onClick ? <Button className="h-10" onClick={nextItem.onClick} disabled={!nextItem.onClick}>Continue setup</Button> : nextItem.sheet ? <Button className="h-10" onClick={() => setOpenStep(nextItem.sheet!)}>Continue setup</Button> : <Button asChild className="h-10"><Link to={nextItem.to!} search={nextItem.search as any}>Continue setup</Link></Button>}</div>
      </Card>
      {camera.element}
      {memberEnabled && <MemberSetupWizard key={clientId} open={memberOpen} onClose={() => setMemberOpen(false)} />}
      <SetupStepSheet step={openStep} clientId={clientId} userId={userId} client={client} preview={isImpersonating} onOpenChange={(o) => { if (!o) setOpenStep(null); }} />
    </>
  );
}
