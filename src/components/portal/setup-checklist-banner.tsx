import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ChevronRight, Camera, IdCard, CalendarClock, Target, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isBasicInfoComplete } from "@/lib/basic-info";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";

type Props = {
  clientId: string;
  userId: string;
};

type ItemKey = "profile_picture" | "basic_info" | "training_schedule" | "goals_setup";

type Item = {
  key: ItemKey;
  label: string;
  description: string;
  to: string;
  icon: typeof Camera;
  done: boolean;
};

const SNOOZE_PREFIX = "jf:setup-snooze:";
const SNOOZE_MS = 24 * 60 * 60 * 1000; // 24h

function isSnoozed(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage.getItem(SNOOZE_PREFIX + "all");
  if (!v) return false;
  const t = Number(v);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < SNOOZE_MS;
}

function snoozeNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SNOOZE_PREFIX + "all", String(Date.now()));
}

/**
 * Non-blocking Home checklist that replaces the four hard-lock portal
 * gates (profile picture / basic info / training schedule / goals setup).
 *
 * Rules:
 *  - Never covers the screen. Inline card only.
 *  - Hidden once every item is complete.
 *  - "Remind me later" snoozes the whole card for 24h.
 *  - Auto-dismisses on the dashboard only; other routes never see it.
 */
export function SetupChecklistBanner({ clientId, userId }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => isSnoozed());

  const { data: client } = useQuery({
    queryKey: ["setup-banner-client", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, profile_picture_url, profile_picture_needs_update, full_name, first_name, last_name, phone, date_of_birth, height_cm, address, city, province, postal_code, country, timezone, emergency_contact_name, emergency_contact_phone, basic_info_completed_at, training_schedule_completed, intake_lifts_known, intake_lift_unit, intake_squat_1rm, intake_bench_1rm, intake_deadlift_1rm, intake_training_experience, intake_followed_program, intake_squat_5rm, intake_bench_5rm, intake_deadlift_5rm")
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    },
  });

  const { data: goals } = useQuery({
    queryKey: ["client-goals-setup", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("client_goals_setup")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      return data as ClientGoalsSetupRow | null;
    },
  });

  useEffect(() => {
    // Re-read snooze when the component mounts (handles tab focus).
    setDismissed(isSnoozed());
  }, []);

  const items = useMemo<Item[]>(() => {
    const c = client as any;
    const profileDone = !!c?.profile_picture_url && !c?.profile_picture_needs_update;
    const basicDone = !!c && isBasicInfoComplete(c);
    const scheduleDone = !!c?.training_schedule_completed;
    const goalsDone = isGoalsSetupComplete(goals ?? null);
    return [
      {
        key: "profile_picture",
        label: "Add a profile photo",
        description: "A clear headshot helps your coach personalise feedback.",
        to: "/portal/account",
        icon: Camera,
        done: profileDone,
      },
      {
        key: "basic_info",
        label: "Confirm your basic info",
        description: "Contact, height, emergency contact and a few intake details.",
        to: "/portal/account",
        icon: IdCard,
        done: basicDone,
      },
      {
        key: "training_schedule",
        label: "Set your training schedule",
        description: "How many days a week you'll train, and which days.",
        to: "/portal/account",
        icon: CalendarClock,
        done: scheduleDone,
      },
      {
        key: "goals_setup",
        label: "Finish Goals & Setup",
        description: "A few quick answers so Coach Jared can build the right plan.",
        to: "/portal/goals-setup",
        icon: Target,
        done: goalsDone,
      },
    ];
  }, [client, goals]);

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = done === total;

  if (!clientId || !userId) return null;
  if (allDone) return null;
  if (dismissed) return null;

  // Find the next incomplete item to feature as the primary CTA.
  const nextItem = items.find((i) => !i.done) ?? items[0];

  return (
    <Card className="relative overflow-hidden border-primary/30 bg-primary/5 p-4 sm:p-5">
      <button
        type="button"
        aria-label="Remind me later"
        onClick={() => { snoozeNow(); setDismissed(true); }}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black tracking-tight sm:text-lg">Complete your setup</h2>
            <Badge variant="secondary" className="text-[10px]">{done}/{total}</Badge>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Finish a few quick steps so your coach can build the right plan for you. You can keep using the app while you do this.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Progress value={Math.round((done / total) * 100)} />
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.key}>
              <Link
                to={it.to}
                className={
                  "flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-sm transition hover:bg-background " +
                  (it.done ? "opacity-60" : "")
                }
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={"font-semibold " + (it.done ? "line-through" : "")}>{it.label}</span>
                    {it.done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground sm:text-xs">{it.description}</div>
                </div>
                {!it.done && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={nextItem.to}>Continue setup</Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { snoozeNow(); setDismissed(true); }}
        >
          Remind me later
        </Button>
      </div>
    </Card>
  );
}