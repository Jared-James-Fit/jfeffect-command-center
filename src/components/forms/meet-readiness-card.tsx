import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { readinessLine, type Readiness } from "@/lib/form-checklist";
import { daysOutLabel, daysUntil, weightCheck, MEET_CHECKLIST_FORM_TYPE, type MeetFacts } from "@/lib/meet-checklist";
import { computeFormReadiness, relativeTime, todayLocal, verdictTone } from "@/components/forms/readiness-view";
import { UPCOMING_MEET_DAYS, athleteMeets, coachingAthletes, meetLine, type AthleteMeet } from "@/lib/meet-board";

const db = supabase as any;

export type MeetBoardRow = {
  clientId: string;
  name: string;
  meetName: string | null;
  meetDate: string | null;
  days: number | null;
  readiness: Readiness | null;
  facts: MeetFacts | null;
  updatedAt: string | null;
  sentAt: string | null;
  /** A meet on their meet prep or approved plan with no checklist out yet (the dashboard's only other view of meets coming up). */
  noChecklist?: boolean;
  /** From their competition plan, when it says. */
  registered?: boolean | null;
  /** Their other meets inside the window, after this one. */
  later?: AthleteMeet[];
};

/** How far ahead a meet shows, checklist or not (meet-board.ts: 16 weeks, a full peak block). */
export { UPCOMING_MEET_DAYS };
/** Inside this, a meet they haven't registered for is flagged (registration usually closes weeks out). */
const REGISTER_BY_DAYS = 56;
/** Inside this, a meet with no checklist out says to send it (formSuggestions offers it in the chat from here too). */
const CHECKLIST_DUE_DAYS = 28;

/**
 * Every athlete with a meet coming up, soonest first, a coach's or admin's own
 * athlete account included: with a meet checklist out, where they stand, the
 * critical items still open, a weight concern, the handler, and when they last
 * changed it (read live from their answers); with a meet on their meet prep or
 * approved competition plan in the next 16 weeks and no checklist, the meet and
 * a nudge to send it inside 4 weeks (this card replaced Training Intel's
 * "Event approaching"). Each row also names their later meets in the window and
 * a meet their plan says they haven't registered for. Hidden when nobody has a
 * meet coming up.
 */
export function useMeetBoard() {
  return useQuery({
    queryKey: ["meet-readiness-board"],
    staleTime: 60_000,
    queryFn: async (): Promise<MeetBoardRow[]> => {
      const today = todayLocal();
      const { data: forms } = await db.from("nf_forms").select("id, form_type, settings").eq("form_type", MEET_CHECKLIST_FORM_TYPE).eq("archived", false);
      const formIds = ((forms ?? []) as any[]).map((f) => f.id);
      const upcoming = await upcomingMeets(today);
      if (!formIds.length) return upcoming.rows;
      const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const [{ data: subs }, { data: asg }, { data: qs }] = await Promise.all([
        db
          .from("nf_submissions")
          .select("id, form_id, client_id, status, submitted_at, answers_updated_at, created_at, client:client_id(full_name, archived)")
          .in("form_id", formIds)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300),
        db
          .from("nf_assignments")
          .select("form_id, client_id, settings, last_sent_at, updated_at, client:client_id(full_name, archived)")
          .in("form_id", formIds)
          .gte("updated_at", since),
        db.from("nf_questions").select("id, form_id, label, question_type, required, options, validation, conditional_logic, order_index").in("form_id", formIds).is("archived_at", null),
      ]);
      const latest = new Map<string, any>();
      for (const s of (subs ?? []) as any[]) if (!latest.has(s.client_id) && !s.client?.archived) latest.set(s.client_id, s);
      const subIds = [...latest.values()].map((s) => s.id);
      const { data: answers } = subIds.length
        ? await db.from("nf_answers").select("submission_id, question_id, value_text, value_number, value_json").in("submission_id", subIds)
        : { data: [] };
      const answersBy = new Map<string, any[]>();
      for (const a of (answers ?? []) as any[]) answersBy.set(a.submission_id, [...(answersBy.get(a.submission_id) ?? []), a]);
      const formBy = new Map(((forms ?? []) as any[]).map((f) => [f.id, f]));
      const qsBy = new Map<string, any[]>();
      for (const q of (qs ?? []) as any[]) qsBy.set(q.form_id, [...(qsBy.get(q.form_id) ?? []), q]);

      const rows: MeetBoardRow[] = [];
      for (const s of latest.values()) {
        const r = computeFormReadiness(formBy.get(s.form_id) ?? {}, (qsBy.get(s.form_id) ?? []).sort((a, b) => a.order_index - b.order_index), answersBy.get(s.id) ?? [], today);
        const meetDate = r.facts?.meetDate ?? null;
        rows.push({
          clientId: s.client_id,
          name: s.client?.full_name ?? "Athlete",
          meetName: r.facts?.meetName ?? null,
          meetDate,
          days: daysUntil(meetDate, today),
          readiness: r.readiness,
          facts: r.facts,
          updatedAt: s.answers_updated_at ?? s.submitted_at ?? s.created_at,
          sentAt: null,
        });
      }
      // Sent and not opened yet.
      for (const a of (asg ?? []) as any[]) {
        if (latest.has(a.client_id) || a.client?.archived) continue;
        const meet = (a.settings as any)?.meet ?? null;
        rows.push({
          clientId: a.client_id,
          name: a.client?.full_name ?? "Athlete",
          meetName: meet?.name ?? null,
          meetDate: meet?.date ?? null,
          days: daysUntil(meet?.date ?? null, today),
          readiness: null,
          facts: null,
          updatedAt: null,
          sentAt: a.last_sent_at ?? a.updated_at,
        });
      }
      // Meets still ahead (or yesterday's), and undated ones touched in the last 3 weeks.
      const recent = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 21 * 86_400_000;
      const withChecklist = rows
        .filter((r) => (r.days != null ? r.days >= -1 : recent(r.updatedAt ?? r.sentAt)))
        .map((r) => {
          // their other meets after the checklist's one
          const others = (upcoming.meetsBy.get(r.clientId) ?? []).filter((m) => m.date !== r.meetDate && (!r.meetDate || m.date > r.meetDate));
          const same = (upcoming.meetsBy.get(r.clientId) ?? []).find((m) => m.date === r.meetDate);
          return { ...r, registered: same?.registered ?? null, later: others };
        });
      const covered = new Set(withChecklist.map((r) => r.clientId));
      return [...withChecklist, ...upcoming.rows.filter((p) => !covered.has(p.clientId))]
        .sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || a.name.localeCompare(b.name));
    },
  });
}

/**
 * Coaching clients' meets in the next UPCOMING_MEET_DAYS, from their meet preps
 * and approved competition plans (meet-board.ts), read as the coach (RLS: an
 * admin's all, a coach's own). One row per athlete on their soonest meet.
 */
async function upcomingMeets(today: string): Promise<{ rows: MeetBoardRow[]; meetsBy: Map<string, AthleteMeet[]> }> {
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + UPCOMING_MEET_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [{ data: preps }, { data: plans }] = await Promise.all([
    db
      .from("pl_preps")
      .select("client_id, title, event_name, event_date, status, archived")
      .in("status", ["Active", "Planned"])
      .gte("event_date", today)
      .lte("event_date", until)
      .order("event_date"),
    db.from("athlete_competition_plans").select("client_id, status, created_at, plan").eq("status", "approved"),
  ]);
  const all = athleteMeets({ preps: (preps ?? []) as any[], plans: (plans ?? []) as any[], today });
  const ids = [...all.keys()];
  if (!ids.length) return { rows: [], meetsBy: new Map() };
  const { data: clients } = await db.from("clients").select("id, full_name, archived, service_tier").in("id", ids);
  const who = coachingAthletes((clients ?? []) as any[]);
  const meetsBy = new Map([...all].filter(([id]) => who.has(id)));
  const rows: MeetBoardRow[] = [];
  for (const [clientId, meets] of meetsBy) {
    const [next, ...later] = meets;
    rows.push({
      clientId,
      name: who.get(clientId) ?? "Athlete",
      meetName: next.name,
      meetDate: next.date,
      days: next.days,
      readiness: null,
      facts: null,
      updatedAt: null,
      sentAt: null,
      noChecklist: true,
      registered: next.registered,
      later,
    });
  }
  return { rows, meetsBy };
}

export function MeetReadinessCard() {
  const { data: rows = [] } = useMeetBoard();
  if (!rows.length) return null;
  const attention = rows.filter((r) => !r.noChecklist && (!r.readiness || r.readiness.verdict !== "ready")).length;
  const checklists = rows.some((r) => !r.noChecklist);
  return (
    <Card className="p-4" data-meet-readiness>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <Trophy className="h-4 w-4 text-muted-foreground" /> Upcoming meets
        </h2>
        {checklists && <span className="text-[13px] text-muted-foreground">{attention ? `${attention} not ready` : "Checklists ready"}</span>}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const critical = (r.readiness?.issues ?? []).filter((i) => i.kind !== "unconfirmed" && i.severity === "critical");
          const weight = r.facts ? weightCheck(r.facts, r.days) : null;
          const concern = r.facts?.weightConcern && r.facts.weightConcern !== "No concerns" ? r.facts.weightConcern : null;
          const handlerOpen = r.readiness?.areas.find((a) => a.key === "handler" && a.status === "attention");
          return (
            <li key={r.clientId}>
              <Link to="/admin/messages" search={{ client: r.clientId } as any} className="block py-2.5" data-meet-row>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-semibold">{r.name}</span>
                  <span className={cn("shrink-0 text-[13px] tabular-nums", r.days != null && r.days <= 7 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {daysOutLabel(r.days) ?? "Date not set"}
                  </span>
                </div>
                <p className="break-words text-[13px] text-muted-foreground">
                  {[r.meetName, r.meetDate ? new Date(`${r.meetDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : null].filter(Boolean).join(" · ") || "Meet not named yet"}
                  {r.registered === false && (
                    <span className={cn((r.days ?? 999) <= REGISTER_BY_DAYS && "font-medium text-warning")}> · not registered</span>
                  )}
                </p>
                <p className={cn("text-[13px] font-medium", r.readiness ? verdictTone(r.readiness) : r.noChecklist && (r.days ?? 99) <= CHECKLIST_DUE_DAYS ? "text-warning" : "text-muted-foreground")}>
                  {r.readiness
                    ? readinessLine(r.readiness)
                    : r.noChecklist
                      ? (r.days ?? 99) <= CHECKLIST_DUE_DAYS ? "No meet checklist yet · send it from their chat" : "No meet checklist yet"
                      : `Not opened yet · sent ${relativeTime(r.sentAt) ?? ""}`}
                  {r.updatedAt && r.readiness ? <span className="font-normal text-muted-foreground"> · updated {relativeTime(r.updatedAt)}</span> : null}
                </p>
                {critical.length > 0 && <p className="text-[13px] text-destructive">Still need: {critical.map((i) => i.label).join(", ")}</p>}
                {(weight || concern) && <p className="text-[13px] text-warning">Weight: {weight ? weight.line : concern}</p>}
                {handlerOpen && <p className="text-[13px] text-warning">Handler: {r.facts?.handler ?? "not confirmed"}</p>}
                {(r.later ?? []).slice(0, 2).map((m) => (
                  <p key={m.date} className="break-words text-[13px] text-muted-foreground" data-meet-later>
                    Then {meetLine(m)}
                  </p>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
