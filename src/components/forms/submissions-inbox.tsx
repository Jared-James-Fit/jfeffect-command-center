/**
 * Admin → Forms → Submissions: everything clients send in, newest first and
 * grouped by day. One chip per kind (weekly check-ins, Nutrition Updates,
 * progress photos & videos, other forms, Fillout, applications) with what's
 * waiting on the coach in blue; tap a row to read it, ✓ to mark it reviewed.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, MessageCircle, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { NativeAnswers } from "@/components/clients/intake-answers-dialog";
import { CheckinAnswersSheet } from "@/components/messages/messenger-checkin-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { markCheckinReviewed, refreshReviewQueries } from "@/lib/checkin-review";
import { cn } from "@/lib/utils";
import { listFormSubmissionsFn } from "@/lib/form-submissions.functions";
import {
  SUBMISSION_KINDS,
  TO_REVIEW_DAYS,
  countByKind,
  filterSubmissions,
  groupByDay,
  isToReview,
  type FormSubmission,
  type StatusFilter,
  type SubmissionKind,
} from "@/lib/form-submissions";

const QUERY_KEY = ["form-submissions"];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function SubmissionsInbox() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const list = useServerFn(listFormSubmissionsFn);
  const { data: rows = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 15_000,
    queryFn: () => list(),
  });

  const [kind, setKind] = useState<SubmissionKind | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FormSubmission | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const now = Date.now();
  const counts = useMemo(() => countByKind(rows, now), [rows, now]);
  const visible = useMemo(() => filterSubmissions(rows, { kind, status, search }, now), [rows, kind, status, search, now]);
  const groups = useMemo(() => groupByDay(visible, now), [visible, now]);
  const kindsShown = SUBMISSION_KINDS.filter((k) => counts[k.kind].total > 0 || kind === k.kind);
  const waitingHere = kind === "all" ? counts.all.toReview : counts[kind].toReview;

  const markReviewed = async (s: FormSubmission) => {
    setMarking(s.key);
    try {
      if (s.source === "checkin") {
        await markCheckinReviewed(s.id);
      } else if (s.source === "native") {
        const { error: e } = await (supabase.from("nf_submissions") as any)
          .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: user?.id ?? null })
          .eq("id", s.id);
        if (e) throw new Error(e.message);
      } else if (s.source === "fillout") {
        const { error: e } = await (supabase.from("fillout_submissions") as any).update({ unread: false }).eq("id", s.id);
        if (e) throw new Error(e.message);
      }
      qc.setQueryData<FormSubmission[]>(QUERY_KEY, (old) => old?.map((r) => (r.key === s.key ? { ...r, reviewed: true } : r)));
      refreshReviewQueries(qc);
      toast.success("Marked reviewed");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark it reviewed");
    } finally {
      setMarking(null);
    }
  };

  // Each kind opens where its answers live.
  const openRow = (s: FormSubmission) => {
    if (s.source === "progress" && s.clientId) {
      navigate({ to: "/admin/clients/$id/progress", params: { id: s.clientId } as any });
      return;
    }
    if (s.source === "fillout") {
      navigate({ to: "/admin/forms", search: { tab: "fillout" } as any });
      return;
    }
    if (s.source === "application") {
      navigate({ to: "/admin/forms", search: { tab: "applications" } as any });
      return;
    }
    setOpen(s);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 md:p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">
            {counts.all.toReview > 0 ? (
              <span className="text-sky-700 dark:text-sky-400">{counts.all.toReview} to review</span>
            ) : (
              "All caught up"
            )}
            <span className="font-normal text-muted-foreground"> · {counts.all.total} in the last year</span>
          </div>
          <div className="text-xs text-muted-foreground">Everything clients send in, newest first. "To review" = not reviewed, last {TO_REVIEW_DAYS} days.</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-10 pl-9 text-base sm:text-sm" placeholder="Search client or form…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* One chip per kind; the blue number is what's waiting on you. */}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-submission-kinds>
        <KindChip label="All" count={counts.all} on={kind === "all"} onClick={() => setKind("all")} />
        {kindsShown.map((k) => (
          <KindChip key={k.kind} label={k.label} count={counts[k.kind]} on={kind === k.kind} onClick={() => setKind(k.kind)} />
        ))}
      </div>

      <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 text-xs font-semibold" role="tablist">
        {(["all", "to_review"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn("rounded-md px-3 py-1.5 transition", status === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {s === "all" ? "All" : `To review${waitingHere ? ` · ${waitingHere}` : ""}`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          Couldn't load submissions. <button className="font-semibold underline" onClick={() => refetch()}>Try again</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {status === "to_review" ? "Nothing waiting on you here." : search ? "No submissions match that search." : "No submissions yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground backdrop-blur">
                {g.label} <span className="font-semibold">· {g.rows.length}</span>
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {g.rows.map((s) => (
                  <SubmissionRow
                    key={s.key}
                    s={s}
                    now={now}
                    marking={marking === s.key}
                    onOpen={() => openRow(s)}
                    onMark={() => markReviewed(s)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {open?.source === "checkin" && (
        <CheckinAnswersSheet
          open
          onOpenChange={(o) => !o && setOpen(null)}
          submissionId={open.id}
          taskType="weekly_checkin"
          role="admin"
          submittedAt={open.submittedAt}
        />
      )}
      {open?.source === "native" && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
              <DialogDescription>
                {open.clientName} · submitted {new Date(open.submittedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </DialogDescription>
            </DialogHeader>
            <NativeAnswers submissionId={open.id} formId={open.formId} />
            <div className="flex flex-wrap gap-2">
              {open.clientId && (
                <Button asChild variant="secondary" size="sm">
                  <Link to="/admin/communication" search={{ tab: "messages", client: open.clientId } as any} onClick={() => setOpen(null)}>
                    <MessageCircle className="mr-1.5 h-4 w-4" /> Open chat
                  </Link>
                </Button>
              )}
              {open.reviewed === false && (
                <Button size="sm" variant="outline" onClick={() => { void markReviewed(open); setOpen(null); }}>
                  <Check className="mr-1.5 h-4 w-4" /> Mark reviewed
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function KindChip({ label, count, on, onClick }: { label: string; count: { total: number; toReview: number }; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-xs font-semibold transition",
        on ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary",
      )}
    >
      {label}
      <span className={cn("tabular-nums", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{count.total}</span>
      {count.toReview > 0 && (
        <span
          className={cn(
            "inline-block h-[18px] min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums",
            on ? "bg-primary-foreground/25 text-primary-foreground" : "bg-sky-500/20 text-sky-700 dark:text-sky-300",
          )}
          aria-label={`${count.toReview} to review`}
        >
          {count.toReview}
        </span>
      )}
    </button>
  );
}

function SubmissionRow({
  s,
  now,
  marking,
  onOpen,
  onMark,
}: {
  s: FormSubmission;
  now: number;
  marking: boolean;
  onOpen: () => void;
  onMark: () => void;
}) {
  const waiting = isToReview(s, now);
  const canMark = s.reviewed === false && (s.source === "checkin" || s.source === "native" || s.source === "fillout");
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-submission={s.kind}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative shrink-0">
          <UserAvatar src={s.photo} name={s.clientName} size={36} expandable={false} />
          {waiting && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-card" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", waiting ? "font-bold" : "font-semibold")}>{s.clientName}</span>
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{time(s.submittedAt)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate text-muted-foreground">
              {s.title}
              {s.detail ? ` · ${s.detail}` : ""}
            </span>
            {waiting ? (
              <span className="shrink-0 font-semibold text-sky-700 dark:text-sky-400">To review</span>
            ) : s.reviewed === true ? (
              <span className="shrink-0 text-muted-foreground"><Check className="mr-0.5 inline h-3 w-3" />Reviewed</span>
            ) : s.reviewed === false ? (
              <span className="shrink-0 text-muted-foreground">Not reviewed</span>
            ) : null}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </button>
      {canMark && (
        <button
          type="button"
          onClick={onMark}
          disabled={marking}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label={`Mark ${s.clientName}'s ${s.title} reviewed`}
          title="Mark reviewed"
        >
          {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      )}
    </li>
  );
}
