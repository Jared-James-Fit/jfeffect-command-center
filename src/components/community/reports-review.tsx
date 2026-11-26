import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, EyeOff, Loader2, Minus, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { REPORT_REASONS } from "@/components/community/report-sheet";
import { cn } from "@/lib/utils";
import { moderationDue, moderationKindLabel, type ModerationKind } from "@/lib/crew-moderation";

export type OpenReport = {
  target_kind: ModerationKind;
  target_id: string;
  owner_id?: string | null;
  owner: { name?: string | null; username?: string | null; avatar_url?: string | null; is_coach?: boolean | null } | null;
  /** People who reported it (the word filter isn't counted). */
  reports: number;
  /** The word filter flagged it as it was posted. */
  flagged?: boolean;
  reasons: string[];
  details: string[] | null;
  snapshot: Record<string, any> | null;
  first_at?: string;
  last_at: string;
  /** 24 hours (the setting) from the first report. */
  due_at?: string | null;
  /** Hidden for everyone until a decision (enough reports). */
  held?: boolean;
  owner_status?: { warnings?: number; warned_at?: string | null; posting_paused_until?: string | null } | null;
};

export const OPEN_REPORTS_KEY = ["community-reports-open"] as const;
const SETTINGS_KEY = ["community-moderation-settings"] as const;
const db = supabase as any;

/** Staff: everything reported or flagged in Crew that's still open, oldest first (community_reports_open returns [] for anyone else). */
export function useOpenReports(enabled = true) {
  return useQuery({
    queryKey: OPEN_REPORTS_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<OpenReport[]> => {
      const { data, error } = await db.rpc("community_reports_open");
      if (error) throw error;
      return (data ?? []) as OpenReport[];
    },
  });
}

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.id === r)?.label ?? r;

/** What was reported, as it read when it was reported. */
function snapshotText(r: OpenReport): string {
  const s = r.snapshot ?? {};
  if (r.target_kind === "post")
    return (
      s.caption ||
      (s.media_type
        ? `(${s.media_type === "video" ? "a clip" : "a photo"} with no caption)`
        : "(no words)")
    );
  if (r.target_kind === "comment" || r.target_kind === "message") return s.body || "";
  if (r.target_kind === "program") return [s.title, s.description].filter(Boolean).join(" · ");
  const who = s.name ? `${s.name}${s.username ? ` (@${s.username})` : ""}` : "";
  return [who, s.bio].filter(Boolean).join(" · ");
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Act = { r: OpenReport; action: "remove" | "keep" | "warn" | "suspend"; days?: number; note?: string };

/**
 * The team's moderation queue (Crew → Manage → Needs you): what members
 * reported and what the word filter flagged, oldest first with the 24-hour
 * clock on each. Remove takes it out of Crew for good (a post to its author's
 * archive, which they can't undo; a comment hidden; a program taken down; a
 * message request deleted); Keep leaves it (and brings back anything the
 * reports hid); Warn shows the author a one-time notice; Suspend stops them
 * posting, commenting and sending message requests for a while. Who reported
 * is never shown here or to the author.
 */
export function ReportsReviewSheet({
  open,
  onOpenChange,
  onOpenPost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPost?: (postId: string) => void;
}) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useOpenReports(open);
  const [sanction, setSanction] = useState<{ r: OpenReport; action: "warn" | "suspend" } | null>(null);
  const act = useMutation({
    mutationFn: async ({ r, action, days, note }: Act) => {
      const { error } = await db.rpc("community_moderate", {
        _kind: r.target_kind,
        _target: r.target_id,
        _action: action,
        _days: days ?? null,
        _note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      const done = {
        remove: "Removed from Crew",
        keep: "Kept",
        warn: "Warning sent",
        suspend: v.days === 0 ? "Posting turned back on" : `Posting paused for ${v.days} ${v.days === 1 ? "day" : "days"}`,
      }[v.action];
      toast.success(done);
      void qc.invalidateQueries({ queryKey: OPEN_REPORTS_KEY });
      void qc.invalidateQueries({ queryKey: ["community"] });
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
      void qc.invalidateQueries({ queryKey: ["community-comments"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't do that. Try again."),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
        data-moderation-queue
      >
        <SheetHeader className="text-left">
          <SheetTitle>Reports</SheetTitle>
          <SheetDescription>
            What the crew reported and the word filter flagged. Answer each within 24 hours. Nobody is told who reported them.
          </SheetDescription>
        </SheetHeader>
        <AutoHideSetting enabled={open} />
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : !data.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing to review.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.map((r) => {
              const due = moderationDue(r.due_at);
              const paused = r.owner_status?.posting_paused_until;
              const postId = r.target_kind === "post" ? r.target_id : r.target_kind === "comment" ? (r.snapshot?.post_id as string | undefined) : undefined;
              const canSanction = !!r.owner_id && !r.owner?.is_coach;
              return (
                <li key={`${r.target_kind}:${r.target_id}`} className="rounded-2xl border border-border p-4" data-moderation-item={r.target_kind}>
                  <div className="flex items-center gap-2">
                    <UserAvatar src={r.owner?.avatar_url ?? null} name={r.owner?.name ?? "?"} size={28} expandable={false} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">
                        {r.owner?.username ? `@${r.owner.username}` : (r.owner?.name ?? "Someone")}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {moderationKindLabel(r.target_kind, r.snapshot)}
                        {r.reports > 0 && ` · ${r.reports} ${r.reports === 1 ? "report" : "reports"}`}
                        {r.flagged && " · Word filter"}
                      </div>
                    </div>
                    {due && (
                      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", due.late ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")} data-moderation-due>
                        <Clock className="h-3 w-3" aria-hidden />
                        {due.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.reasons.map((x) => (
                      <span key={x} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {reasonLabel(x)}
                      </span>
                    ))}
                  </div>
                  {r.target_kind === "comment" && r.snapshot?.post_caption && (
                    <p className="mt-2 line-clamp-1 text-[12px] text-muted-foreground">On: “{r.snapshot.post_caption}”</p>
                  )}
                  {snapshotText(r) && (
                    <p className="mt-2 line-clamp-4 whitespace-pre-line text-[14px]">
                      {snapshotText(r)}
                    </p>
                  )}
                  {!!r.details?.length && (
                    <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
                      {r.details.map((d, i) => (
                        <li key={i}>“{d}”</li>
                      ))}
                    </ul>
                  )}
                  {(r.held || paused || (r.owner_status?.warnings ?? 0) > 0) && (
                    <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                      {r.held && (
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          <EyeOff className="h-3.5 w-3.5" aria-hidden /> Hidden for everyone until you decide
                        </p>
                      )}
                      {(r.owner_status?.warnings ?? 0) > 0 && (
                        <p>
                          Warned {r.owner_status!.warnings} {r.owner_status!.warnings === 1 ? "time" : "times"}
                          {r.owner_status?.warned_at ? `, last ${dateLabel(r.owner_status.warned_at)}` : ""}
                        </p>
                      )}
                      {paused && <p>Posting paused until {dateLabel(paused)}</p>}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {postId && onOpenPost && (
                      <Button size="sm" variant="ghost" onClick={() => onOpenPost(postId)}>
                        Open post
                      </Button>
                    )}
                    {r.target_kind !== "profile" && (
                      <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ r, action: "remove" })} data-moderation-remove>
                        Remove
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ r, action: "keep" })} data-moderation-keep>
                      {r.target_kind === "profile" ? "Done" : "Keep"}
                    </Button>
                    {canSanction && (
                      <>
                        <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setSanction({ r, action: "warn" })} data-moderation-warn>
                          Warn
                        </Button>
                        <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setSanction({ r, action: "suspend" })} data-moderation-suspend>
                          {paused ? "Posting paused" : "Suspend posting"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <SanctionSheet
          target={sanction}
          busy={act.isPending}
          onClose={() => setSanction(null)}
          onConfirm={(days, note) => {
            if (!sanction) return;
            act.mutate({ r: sanction.r, action: sanction.action, days, note }, { onSuccess: () => setSanction(null) });
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

const SUSPEND_DAYS = [1, 7, 30] as const;

/** Warn (an optional note they'll see) or suspend posting (1, 7 or 30 days, or lift it). */
function SanctionSheet({ target, busy, onClose, onConfirm }: {
  target: { r: OpenReport; action: "warn" | "suspend" } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (days: number | undefined, note: string | undefined) => void;
}) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState<number>(7);
  const name = target?.r.owner?.name ?? "them";
  const paused = !!target?.r.owner_status?.posting_paused_until;
  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) { onClose(); setNote(""); setDays(7); } }}>
      <SheetContent side="bottom" className="pb-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-[480px]">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" aria-hidden />
            {target?.action === "warn" ? `Warn ${name}` : `Suspend ${name}'s posting`}
          </SheetTitle>
          <SheetDescription>
            {target?.action === "warn"
              ? "They see a one-time notice in Crew with the community rules. Add a line if it helps (optional)."
              : "They can still read Crew, but can't post, comment or send message requests until it ends."}
          </SheetDescription>
        </SheetHeader>
        {target?.action === "warn" ? (
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="e.g. Keep comments about training, not people's bodies."
            className="mt-4 min-h-[80px] text-base"
          />
        ) : (
          <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="How long">
            {SUSPEND_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={cn("h-10 rounded-full border px-4 text-[14px] font-semibold", days === d ? "border-foreground bg-foreground text-background" : "border-border")}
              >
                {d === 1 ? "1 day" : `${d} days`}
              </button>
            ))}
          </div>
        )}
        <Button
          className="mt-4 h-12 w-full"
          disabled={busy}
          onClick={() => onConfirm(target?.action === "suspend" ? days : undefined, target?.action === "warn" ? note.trim() || undefined : undefined)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : target?.action === "warn" ? "Send warning" : "Suspend posting"}
        </Button>
        {target?.action === "suspend" && paused && (
          <Button className="mt-2 h-11 w-full" variant="ghost" disabled={busy} onClick={() => onConfirm(0, undefined)}>
            Turn their posting back on
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** "Hidden for everyone after 3 reports", with − / + (2 to 20). */
function AutoHideSetting({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: SETTINGS_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ auto_hide_reports: number; response_hours: number } | null> => {
      const { data, error } = await db.rpc("community_moderation_settings_get");
      if (error) return null;
      return data ?? null;
    },
  });
  const set = useMutation({
    mutationFn: async (n: number) => {
      const { data, error } = await db.rpc("community_moderation_settings_set", { _auto_hide_reports: n });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => qc.setQueryData(SETTINGS_KEY, d),
    onError: () => toast.error("Couldn't change that. Try again."),
  });
  if (!data) return null;
  const n = data.auto_hide_reports;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2" data-moderation-auto-hide>
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        Hidden for everyone after <b>{n}</b> reports from different people, until you decide.
      </span>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-background disabled:opacity-40" aria-label="Fewer reports" disabled={n <= 2 || set.isPending} onClick={() => set.mutate(n - 1)}>
        <Minus className="h-4 w-4" />
      </button>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-background disabled:opacity-40" aria-label="More reports" disabled={n >= 20 || set.isPending} onClick={() => set.mutate(n + 1)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
