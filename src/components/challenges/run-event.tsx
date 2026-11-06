import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Loader2,
  Minus,
  MonitorPlay,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AthleteAvatar,
  BoardList,
  DivisionTabs,
  QrImage,
  ScoreText,
  StatusPill,
  useRankedRows,
} from "@/components/challenges/ui";
import { RegisterForm, type RegisterDone } from "@/components/challenges/register-form";
import { PhotoCapture } from "@/components/challenges/photo-capture";
import {
  correctAttempt,
  errorText,
  invalidateChallenge,
  photoTicket,
  recordAttempt,
  resultUrl,
  setStatus,
  updateEntry,
  useBoard,
  useChallenge,
  useLiveChallenge,
  useStaffBoard,
  voidAttempt,
  type AttemptResult,
} from "@/lib/challenges/api";
import { uploadChallengePhoto } from "@/lib/challenges/photo.functions";
import {
  canRecordScores,
  defaultDivision,
  formatScore,
  parseScoreInput,
  rankBadge,
  roleCan,
  statusActions,
  type ChallengePublic,
  type StaffAttempt,
  type StaffEntry,
  type StatusAction,
} from "@/lib/challenges/model";

type Tab = "judge" | "register" | "board";

export function RunEvent({ slug }: { slug: string }) {
  const { user, loading } = useAuth();
  const q = useChallenge(slug);
  const c = q.data;
  const staff = useStaffBoard(c?.my_role ? c.id : undefined);
  const [tab, setTab] = useState<Tab>("judge");
  const [open, setOpen] = useState<string | null>(null);
  useLiveChallenge(c?.id);

  if (loading || (q.isPending && !c)) {
    return (
      <Frame slug={slug}>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-4 h-72 w-full rounded-2xl" />
      </Frame>
    );
  }
  if (!user) {
    return (
      <Frame slug={slug}>
        <div className="py-16 text-center">
          <p className="font-semibold">Sign in to run this event</p>
          <Button asChild className="mt-4 h-11">
            <Link to="/auth" search={{ next: `/challenges/${slug}/run` }}>
              Sign in
            </Link>
          </Button>
        </div>
      </Frame>
    );
  }
  if (!c || !c.my_role) {
    return (
      <Frame slug={slug}>
        <p className="py-16 text-center text-sm text-muted-foreground">
          You're not on this event's team. Ask the organizer to add your email.
        </p>
      </Frame>
    );
  }

  const role = c.my_role;
  const entries = staff.data?.entries ?? [];
  const canJudge = roleCan(role, "judge");
  const tabs: { id: Tab; label: string }[] = [
    ...(canJudge ? [{ id: "judge" as const, label: "Judge" }] : []),
    { id: "register", label: "Register" },
    { id: "board", label: "Board" },
  ];
  const activeTab = !canJudge && tab === "judge" ? "register" : tab;

  return (
    <Frame slug={slug} title={c.title} status={<StatusPill status={c.status} final={c.final} />}>
      <OfflineBanner />
      <StatusBar c={c} />
      <div className="sticky top-14 z-20 -mx-4 mb-4 border-b border-border bg-background px-4 pb-2 pt-1">
        <div className="flex gap-1 rounded-xl bg-secondary p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-11 flex-1 rounded-lg text-sm font-semibold",
                activeTab === t.id ? "bg-background text-foreground" : "text-muted-foreground",
              )}
            >
              {t.label}
              {t.id === "judge" ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {entries.filter(waiting).length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "judge" ? (
        <JudgeList c={c} entries={entries} loading={staff.isLoading} onOpen={setOpen} />
      ) : activeTab === "register" ? (
        <RegisterTab
          c={c}
          onScore={(id) => {
            setTab("judge");
            setOpen(id);
          }}
        />
      ) : (
        <BoardTab c={c} entries={entries} />
      )}

      <JudgeSheet
        c={c}
        entry={entries.find((e) => e.id === open) ?? null}
        onClose={() => setOpen(null)}
      />
    </Frame>
  );
}

function waiting(e: StaffEntry) {
  return (
    e.status !== "withdrawn" &&
    e.status !== "disqualified" &&
    !e.attempts.some((a) => a.status === "verified" && !a.tiebreak)
  );
}

function Frame({
  slug,
  title,
  status,
  children,
}: {
  slug: string;
  title?: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header
        className="sticky top-0 z-30 border-b border-border bg-background"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <Link
            to="/challenges/$slug"
            params={{ slug }}
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground"
            aria-label="Back to the challenge"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title ?? "Run event"}</p>
          </div>
          {status}
        </div>
      </header>
      <main
        className="mx-auto max-w-2xl px-4 pt-3"
        style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <WifiOff className="h-4 w-4" /> No connection. Nothing saves until it's back; unsaved scores
      stay on screen to retry.
    </div>
  );
}

/** The status buttons a manager uses on the day (publishing and final results live in admin). */
function StatusBar({ c }: { c: ChallengePublic }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<StatusAction | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = statusActions(c.status).filter(
    (a) => a.need === "manage" && a.to !== "finalize" && roleCan(c.my_role, "manage"),
  );
  if (!actions.length) return null;
  const run = async (a: StatusAction) => {
    setBusy(true);
    try {
      await setStatus(c.id, a.to);
      invalidateChallenge(qc);
      toast.success(`${a.label}: done`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  return (
    <div className="mb-3 flex gap-2">
      {actions.map((a) => (
        <Button
          key={a.to}
          variant={a.tone === "primary" ? "default" : "outline"}
          className="h-11 flex-1"
          disabled={busy}
          onClick={() => (a.confirm ? setConfirm(a) : void run(a))}
        >
          {a.label}
        </Button>
      ))}
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(confirm)}>
              {confirm?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Judge                                                              */
/* ------------------------------------------------------------------ */

function JudgeList({
  c,
  entries,
  loading,
  onOpen,
}: {
  c: ChallengePublic;
  entries: StaffEntry[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (e: StaffEntry) =>
    !needle || String(e.bib) === needle || e.name.toLowerCase().includes(needle);
  const up = entries.filter((e) => waiting(e) && match(e));
  const scored = entries
    .filter(
      (e) => !waiting(e) && e.status !== "withdrawn" && e.status !== "disqualified" && match(e),
    )
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const out = entries.filter(
    (e) => (e.status === "withdrawn" || e.status === "disqualified") && match(e),
  );
  if (!canRecordScores(c.status)) {
    return (
      <div>
        <p className="mb-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {c.status === "upcoming"
            ? "Scores open when the event starts."
            : c.status === "paused"
              ? "The event is paused. Resume it to record scores."
              : "Scores are locked."}
        </p>
        <EntryRows entries={entries.filter(match)} c={c} onOpen={onOpen} />
      </div>
    );
  }
  return (
    <div>
      {c.status === "draft" ? (
        <p className="mb-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          Practice run: this draft isn't public. Clear it from admin before you publish.
        </p>
      ) : null}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Number or name"
          inputMode="search"
          className="h-12 pl-9 text-base"
          aria-label="Find an athlete"
        />
      </div>
      {loading ? <Skeleton className="h-64 w-full rounded-2xl" /> : null}
      <Section title={`Up next · ${up.length}`}>
        {up.length ? (
          <EntryRows entries={up} c={c} onOpen={onOpen} />
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            {needle ? "No match." : "Everyone registered has a score."}
          </p>
        )}
      </Section>
      {scored.length ? (
        <Section title={`Scored · ${scored.length}`}>
          <EntryRows entries={scored} c={c} onOpen={onOpen} />
        </Section>
      ) : null}
      {out.length ? (
        <Section title={`Withdrawn or disqualified · ${out.length}`}>
          <EntryRows entries={out} c={c} onOpen={onOpen} />
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function EntryRows({
  entries,
  c,
  onOpen,
}: {
  entries: StaffEntry[];
  c: ChallengePublic;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onOpen(e.id)}
            className="flex min-h-[3.75rem] w-full items-center gap-3 px-3 py-2 text-left active:bg-muted"
          >
            <span className="w-10 shrink-0 text-center font-display text-2xl tabular-nums text-muted-foreground">
              {e.bib}
            </span>
            <AthleteAvatar name={e.name} photo={e.show_photo ? e.photo : null} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{e.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  c.divisions.find((d) => d.id === e.division_id)?.name,
                  e.status === "disqualified"
                    ? "Disqualified"
                    : e.status === "withdrawn"
                      ? "Withdrawn"
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || (e.status === "checked_in" ? "Checked in" : "Registered")}
              </span>
            </span>
            {e.score != null ? (
              <span className="text-right">
                <ScoreText value={e.score} shape={c} className="text-xl" />
                <span className="block text-xs text-muted-foreground">
                  {rankBadge(e.rank, e.tied)}
                </span>
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function JudgeSheet({
  c,
  entry,
  onClose,
}: {
  c: ChallengePublic;
  entry: StaffEntry | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        {entry ? <JudgePanel key={entry.id} c={c} e={entry} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function JudgePanel({ c, e, onClose }: { c: ChallengePublic; e: StaffEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const role = c.my_role;
  const canJudge = roleCan(role, "judge");
  const verified = e.attempts.filter((a) => a.status === "verified" && !a.tiebreak);
  const left = c.attempts_allowed - verified.length;
  const active = e.status !== "withdrawn" && e.status !== "disqualified";
  const canScore = canJudge && active && canRecordScores(c.status) && left > 0;
  const [reps, setReps] = useState(0);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; r: AttemptResult }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });
  // one key per pending score: a retry after a dropped connection can never save twice
  const key = useRef(newKey());
  const [correcting, setCorrecting] = useState<StaffAttempt | null>(null);
  const [dq, setDq] = useState(false);
  const division = c.divisions.find((d) => d.id === e.division_id);
  const wantsWeighIn = c.tiebreak === "lighter" || c.relative;

  const save = async (valid: boolean) => {
    let value: number | null;
    if (c.measure === "reps") value = valid ? reps : null;
    else {
      value = text.trim() ? parseScoreInput(text, c) : null;
      if (valid && value == null) {
        setState({
          kind: "error",
          msg: c.measure === "time" ? "Enter a time like 83.4 or 1:23.4." : "Enter the score.",
        });
        return;
      }
    }
    setState({ kind: "saving" });
    try {
      const r = await recordAttempt({
        entryId: e.id,
        value,
        valid,
        clientKey: key.current,
        note: note.trim() || null,
      });
      key.current = newKey();
      setState({ kind: "saved", r });
      setReps(0);
      setText("");
      setNote("");
      invalidateChallenge(qc);
    } catch (err) {
      // the same key is kept, so trying again can't double-save
      setState({ kind: "error", msg: errorText(err) });
    }
  };

  return (
    <div>
      <SheetHeader className="text-left">
        <div className="flex items-center gap-3">
          <AthleteAvatar name={e.name} photo={e.show_photo ? e.photo : null} size={56} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-xl">{e.name}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              #{e.bib}
              {division
                ? ` · ${division.name}${division.load_label ? ` (${division.load_label})` : ""}`
                : ""}
              {c.load_label && !division?.load_label ? ` · ${c.load_label}` : ""}
            </p>
          </div>
          {e.score != null ? (
            <div className="text-right">
              <ScoreText value={e.score} shape={c} className="text-2xl" />
              <p className="text-xs text-muted-foreground">{rankBadge(e.rank, e.tied)}</p>
            </div>
          ) : null}
        </div>
      </SheetHeader>

      {state.kind === "saved" ? (
        <div className="mt-5 rounded-2xl bg-success/10 p-5 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
          <p className="mt-2 text-lg font-semibold">
            {state.r.valid ? formatScore(state.r.value, c) : "No valid score"} saved
          </p>
          {state.r.rank ? (
            <p className="text-sm text-muted-foreground">
              {rankBadge(state.r.rank, state.r.tied)} of {state.r.of} on the board
            </p>
          ) : null}
          <Button className="mt-4 h-12 w-full text-base" onClick={onClose}>
            Next athlete
          </Button>
          {c.attempts_allowed - verified.length > 0 ? (
            <Button
              variant="ghost"
              className="mt-1 h-10 w-full"
              onClick={() => setState({ kind: "idle" })}
            >
              Record attempt {verified.length + 1}
            </Button>
          ) : null}
        </div>
      ) : canScore ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">
            {c.attempts_allowed > 1
              ? `Attempt ${verified.length + 1} of ${c.attempts_allowed}`
              : "Their set"}
          </p>
          {c.measure === "reps" ? (
            <div>
              <div className="flex items-center justify-center gap-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-20 w-20 rounded-2xl"
                  onClick={() => setReps((r) => Math.max(0, r - 1))}
                  aria-label="One less rep"
                >
                  <Minus className="h-8 w-8" />
                </Button>
                <input
                  value={reps}
                  onChange={(ev) =>
                    setReps(
                      Math.max(0, Math.min(9999, Number(ev.target.value.replace(/\D/g, "")) || 0)),
                    )
                  }
                  inputMode="numeric"
                  // inline: the phone-wide 16px text-box rule would shrink a class size
                  style={{ fontSize: 96, lineHeight: 1 }}
                  className="w-36 bg-transparent text-center font-display tabular-nums outline-none"
                  aria-label="Valid reps"
                />
                <Button
                  type="button"
                  className="h-20 w-20 rounded-2xl"
                  onClick={() => setReps((r) => r + 1)}
                  aria-label="One more valid rep"
                >
                  <Plus className="h-8 w-8" />
                </Button>
              </div>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Tap + for every rep that counts.
              </p>
              <Button
                className="mt-4 h-14 w-full text-lg"
                disabled={state.kind === "saving"}
                onClick={() => void save(true)}
              >
                {state.kind === "saving" ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Check className="mr-2 h-5 w-5" />
                )}
                Save {reps} {reps === 1 ? "rep" : "reps"}
              </Button>
              <Button
                variant="ghost"
                className="mt-1 h-11 w-full text-muted-foreground"
                disabled={state.kind === "saving"}
                onClick={() => void save(false)}
              >
                No valid set (doesn't count)
              </Button>
            </div>
          ) : (
            <div>
              <Input
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                inputMode="decimal"
                placeholder={c.measure === "time" ? "1:23.4" : c.unit}
                style={{ fontSize: 36 }}
                className="h-16 text-center font-display"
                aria-label="Score"
                autoFocus
              />
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {c.measure === "time"
                  ? "Seconds (83.4) or minutes:seconds (1:23.4)"
                  : `In ${c.unit}`}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-14 text-base"
                  disabled={state.kind === "saving"}
                  onClick={() => void save(false)}
                >
                  <Ban className="mr-2 h-4 w-4" />{" "}
                  {c.measure === "weight" ? "No lift" : "Doesn't count"}
                </Button>
                <Button
                  className="h-14 text-base"
                  disabled={state.kind === "saving"}
                  onClick={() => void save(true)}
                >
                  {state.kind === "saving" ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-5 w-5" />
                  )}
                  {c.measure === "weight" ? "Good lift" : "Save"}
                </Button>
              </div>
            </div>
          )}
          <Input
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            placeholder="Note (optional)"
            className="mt-3 h-11"
            maxLength={300}
          />
          {state.kind === "error" ? (
            <div
              className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              Not saved: {state.msg}
              <span className="block text-xs">
                Tap save again to retry. It can't be counted twice.
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {!active
            ? e.status === "disqualified"
              ? `Disqualified${e.status_reason ? `: ${e.status_reason}` : ""}.`
              : "Withdrawn."
            : !canJudge
              ? "Only judges record scores."
              : left <= 0
                ? "All attempts are recorded. Correct one below if needed."
                : c.status === "paused"
                  ? "The event is paused."
                  : "Scores aren't open right now."}
        </p>
      )}

      {e.attempts.length ? (
        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recorded
          </h4>
          <ul className="space-y-2">
            {e.attempts.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-border px-3 py-2",
                  a.status === "void" && "opacity-60",
                )}
              >
                <span className="w-16 text-xs text-muted-foreground">
                  {a.tiebreak ? "Run-off" : `Attempt ${a.no}`}
                </span>
                <span
                  className={cn(
                    "flex-1 text-sm font-medium",
                    a.status === "void" && "line-through",
                  )}
                >
                  {a.valid ? formatScore(a.value, c) : "Didn't count"}
                  {a.status === "void" && a.void_reason ? (
                    <span className="block text-xs font-normal text-muted-foreground no-underline">
                      Removed: {a.void_reason}
                    </span>
                  ) : null}
                  {a.note ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {a.note}
                    </span>
                  ) : null}
                </span>
                {a.status === "verified" &&
                canJudge &&
                ["draft", "live", "paused", "verifying"].includes(c.status) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => setCorrecting(a)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Fix
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canJudge &&
      c.tiebreak === "runoff" &&
      e.score != null &&
      e.tied &&
      canRecordScores(c.status) ? (
        <RunoffBox c={c} e={e} />
      ) : null}

      <div className="mt-6 space-y-3 border-t border-border pt-4">
        {wantsWeighIn ? <WeighIn c={c} e={e} /> : null}
        <RetakePhoto e={e} />
        {active && canJudge ? (
          <Button
            variant="ghost"
            className="h-11 w-full justify-start text-destructive"
            onClick={() => setDq(true)}
          >
            <Ban className="mr-2 h-4 w-4" /> Disqualify
          </Button>
        ) : null}
        {active && e.attempts.length === 0 ? <WithdrawButton e={e} /> : null}
        {!active && roleCan(role, "manage") ? <ReinstateButton e={e} /> : null}
      </div>

      <CorrectDialog c={c} attempt={correcting} onClose={() => setCorrecting(null)} />
      <DisqualifyDialog e={e} open={dq} onClose={() => setDq(false)} />
    </div>
  );
}

function RunoffBox({ c, e }: { c: ChallengePublic; e: StaffEntry }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  return (
    <div className="mt-4 rounded-2xl border border-warning/40 p-4">
      <p className="text-sm font-semibold">Tied: record a run-off</p>
      <p className="text-xs text-muted-foreground">Only used to separate tied athletes.</p>
      <div className="mt-2 flex gap-2">
        <Input
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          inputMode="decimal"
          className="h-11"
          placeholder="Run-off score"
        />
        <Button
          className="h-11"
          disabled={busy}
          onClick={async () => {
            const v = parseScoreInput(text, c);
            if (v == null) return toast.error("Enter the run-off score.");
            setBusy(true);
            try {
              await recordAttempt({
                entryId: e.id,
                value: v,
                valid: true,
                clientKey: key.current,
                tiebreak: true,
              });
              key.current = newKey();
              setText("");
              invalidateChallenge(qc);
              toast.success("Run-off saved");
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function WeighIn({ c, e }: { c: ChallengePublic; e: StaffEntry }) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<"lb" | "kg">(c.unit === "kg" ? "kg" : "lb");
  const shown =
    e.bodyweight_kg == null
      ? ""
      : String(
          unit === "lb" ? Math.round(e.bodyweight_kg * 2.2046226218 * 10) / 10 : e.bodyweight_kg,
        );
  const [text, setText] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(shown), [shown]);
  return (
    <div>
      <p className="text-sm font-medium">
        Weigh-in{" "}
        <span className="font-normal text-muted-foreground">
          · {c.relative ? "needed for the score" : "only for breaking ties"}, never shown
        </span>
      </p>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          inputMode="decimal"
          className="h-11 flex-1"
          placeholder="Bodyweight"
        />
        <div className="flex rounded-lg bg-secondary p-1">
          {(["lb", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={cn(
                "h-9 rounded-md px-3 text-sm",
                unit === u ? "bg-background font-semibold" : "text-muted-foreground",
              )}
            >
              {u}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={busy || text === shown}
          onClick={async () => {
            const n = text.trim() ? Number(text.replace(",", ".")) : null;
            if (n != null && (!Number.isFinite(n) || n <= 0))
              return toast.error("That bodyweight doesn't look right.");
            setBusy(true);
            try {
              await updateEntry(e.id, {
                bodyweight_kg:
                  n == null ? "" : Math.round((unit === "lb" ? n / 2.2046226218 : n) * 10) / 10,
              });
              invalidateChallenge(qc);
              toast.success("Weigh-in saved");
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function RetakePhoto({ e }: { e: StaffEntry }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadChallengePhoto);
  if (!open) {
    return (
      <Button variant="ghost" className="h-11 w-full justify-start" onClick={() => setOpen(true)}>
        <Camera className="mr-2 h-4 w-4" />{" "}
        {e.show_photo && e.photo ? "Retake photo" : "Add photo (with their OK)"}
      </Button>
    );
  }
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="mb-3 text-sm">
        Only with their permission: it shows on the board and their card.
      </p>
      <PhotoCapture value={photo} onChange={setPhoto} facing="environment" />
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          className="h-11 flex-1"
          onClick={() => {
            setOpen(false);
            setPhoto(null);
          }}
        >
          Cancel
        </Button>
        <Button
          className="h-11 flex-1"
          disabled={!photo || busy}
          onClick={async () => {
            if (!photo) return;
            setBusy(true);
            try {
              const token = await photoTicket(e.id);
              await upload({ data: { token, dataUrl: photo } });
              invalidateChallenge(qc);
              toast.success("Photo saved");
              setOpen(false);
              setPhoto(null);
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save photo
        </Button>
      </div>
    </div>
  );
}

function WithdrawButton({ e }: { e: StaffEntry }) {
  const qc = useQueryClient();
  return (
    <Button
      variant="ghost"
      className="h-11 w-full justify-start text-muted-foreground"
      onClick={async () => {
        try {
          await updateEntry(e.id, { status: "withdrawn", status_reason: "Withdrew" });
          invalidateChallenge(qc);
          toast.success(`${e.name} withdrawn`);
        } catch (err) {
          toast.error(errorText(err));
        }
      }}
    >
      <Trash2 className="mr-2 h-4 w-4" /> Withdraw (didn't compete)
    </Button>
  );
}

function ReinstateButton({ e }: { e: StaffEntry }) {
  const qc = useQueryClient();
  return (
    <Button
      variant="outline"
      className="h-11 w-full"
      onClick={async () => {
        try {
          await updateEntry(e.id, { status: e.attempts.length ? "checked_in" : "registered" });
          invalidateChallenge(qc);
          toast.success(`${e.name} is back in`);
        } catch (err) {
          toast.error(errorText(err));
        }
      }}
    >
      <RotateCcw className="mr-2 h-4 w-4" /> Reinstate
    </Button>
  );
}

function CorrectDialog({
  c,
  attempt,
  onClose,
}: {
  c: ChallengePublic;
  attempt: StaffAttempt | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [valid, setValid] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  useEffect(() => {
    if (attempt) {
      setText(attempt.value != null ? String(Number(attempt.value)) : "");
      setValid(attempt.valid);
      setReason("");
      key.current = newKey();
    }
  }, [attempt]);
  return (
    <AlertDialog open={!!attempt} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fix this score</AlertDialogTitle>
          <AlertDialogDescription>
            The old score stays in the record, marked as replaced, with your reason.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              inputMode="decimal"
              className="h-12 flex-1 text-lg"
              aria-label="Correct score"
              disabled={!valid}
            />
            <div className="flex rounded-lg bg-secondary p-1">
              <button
                type="button"
                onClick={() => setValid(true)}
                className={cn(
                  "h-10 rounded-md px-3 text-sm",
                  valid ? "bg-background font-semibold" : "text-muted-foreground",
                )}
              >
                Counts
              </button>
              <button
                type="button"
                onClick={() => setValid(false)}
                className={cn(
                  "h-10 rounded-md px-3 text-sm",
                  !valid ? "bg-background font-semibold" : "text-muted-foreground",
                )}
              >
                Doesn't
              </button>
            </div>
          </div>
          <Input
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="Why it's changing (required)"
            className="h-11"
            maxLength={300}
          />
        </div>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              if (!attempt) return;
              setBusy(true);
              try {
                await voidAttempt(attempt.id, reason.trim());
                invalidateChallenge(qc);
                toast.success("Score removed");
                onClose();
              } catch (err) {
                toast.error(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove score
          </Button>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              if (!attempt) return;
              const v = valid ? parseScoreInput(text, c) : null;
              if (valid && v == null) return toast.error("Enter the correct score.");
              setBusy(true);
              try {
                await correctAttempt({
                  attemptId: attempt.id,
                  value: v,
                  valid,
                  reason: reason.trim(),
                  clientKey: key.current,
                });
                invalidateChallenge(qc);
                toast.success("Score corrected");
                onClose();
              } catch (err) {
                toast.error(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save correction
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DisqualifyDialog({
  e,
  open,
  onClose,
}: {
  e: StaffEntry;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disqualify {e.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They come off the leaderboard. Their scores stay in the record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Reason (required)"
          className="h-11"
          maxLength={300}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={reason.trim().length < 3}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              try {
                await updateEntry(e.id, { status: "disqualified", status_reason: reason.trim() });
                invalidateChallenge(qc);
                toast.success(`${e.name} disqualified`);
              } catch (err) {
                toast.error(errorText(err));
              }
              onClose();
            }}
          >
            Disqualify
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Register + board                                                   */
/* ------------------------------------------------------------------ */

function RegisterTab({ c, onScore }: { c: ChallengePublic; onScore: (entryId: string) => void }) {
  const [done, setDone] = useState<RegisterDone | null>(null);
  const [n, setN] = useState(0);
  if (!["draft", "upcoming", "live", "paused", "verifying"].includes(c.status)) {
    return (
      <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
        Registration is closed.
      </p>
    );
  }
  if (done) {
    return (
      <div className="rounded-2xl border border-border p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
        <p className="mt-2 text-lg font-semibold">
          {done.existing ? `${done.name} was already registered` : `${done.name} is in`}
        </p>
        <div className="mx-auto mt-3 w-36 rounded-2xl bg-muted py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Number
          </div>
          <div className="font-display text-6xl leading-none tabular-nums">{done.bib}</div>
        </div>
        {done.photoError ? (
          <p className="mt-3 text-sm text-warning">
            Photo didn't save: {done.photoError}. Retake it from Judge.
          </p>
        ) : null}
        <div className="mt-4 flex flex-col items-center">
          <QrImage value={resultUrl(c.slug, done.code)} size={160} label="Their result page" />
          <p className="mt-1 text-xs text-muted-foreground">
            Have them scan this: their result and share card land here.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {canRecordScores(c.status) && roleCan(c.my_role, "judge") ? (
            <Button variant="outline" className="h-12" onClick={() => onScore(done.entry_id)}>
              Score now
            </Button>
          ) : null}
          <Button
            className={cn(
              "h-12",
              !(canRecordScores(c.status) && roleCan(c.my_role, "judge")) && "col-span-2",
            )}
            onClick={() => {
              setDone(null);
              setN((x) => x + 1);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" /> Register next
          </Button>
        </div>
      </div>
    );
  }
  return <RegisterForm key={n} challenge={c} mode="staff" onDone={setDone} />;
}

function BoardTab({ c, entries }: { c: ChallengePublic; entries: StaffEntry[] }) {
  const board = useBoard(c.slug, c.status);
  const [division, setDivision] = useState<string | null>(() => defaultDivision(c));
  const rows = useRankedRows(board.data?.rows, division);
  const counts = useMemo(() => {
    const active = entries.filter((e) => e.status !== "withdrawn");
    return {
      registered: active.length,
      scored: active.filter((e) => e.score != null).length,
      waiting: active.filter(waiting).length,
    };
  }, [entries]);
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Registered" value={counts.registered} />
        <Stat label="Scored" value={counts.scored} />
        <Stat label="Waiting" value={counts.waiting} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button asChild variant="outline" className="h-11">
          <Link to="/challenges/$slug/display" params={{ slug: c.slug }}>
            <MonitorPlay className="mr-2 h-4 w-4" /> Big screen
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to="/challenges/$slug" params={{ slug: c.slug }}>
            <ExternalLink className="mr-2 h-4 w-4" /> Public page
          </Link>
        </Button>
      </div>
      <DivisionTabs
        divisions={c.divisions}
        value={division}
        onChange={setDivision}
        allowAll={!c.separate_divisions}
      />
      <BoardList rows={rows} shape={c} slug={c.slug} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border py-3">
      <div className="font-display text-3xl tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
