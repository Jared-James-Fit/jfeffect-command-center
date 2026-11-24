import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, OfflineState } from "@/components/loading";
import { Link } from "@tanstack/react-router";
import { Minus, Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { detailPlan, useProgram, type ProgramDraft } from "@/lib/athlete-programs";
import { draftBackupKey, usableBackup } from "@/lib/athlete-program-draft";
import { DEFAULT_WEEKS, MAX_DAYS, MAX_WEEKS, newPlan } from "@/lib/program-plan";
import { draftKeys, fetchServerDraft, type ServerDraft } from "@/lib/program-history-queries";
import { useProgramEditor } from "./use-program-editor";
import { ProgramWorkbench } from "./workbench/program-workbench";

/**
 * Build or edit your own program: blocks of weeks of training days, each a
 * list of library exercises with sets, reps, effort, load and rest. A new one
 * starts as 12 weeks that follow week 1 until a week is changed. Saved
 * privately; sharing is a switch on the program's page. One screen for phones
 * and computers (ProgramWorkbench).
 */
export function ProgramBuilder({ editId }: { editId: string | null }) {
  const programQ = useProgram(editId);
  const { data: existing, isLoading } = programQ;
  const remote = useRemoteDraft(editId);
  if ((editId && isLoading) || remote.waiting) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title={editId ? "Edit program" : "Build a program"} backTo="/portal/programs" />
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  // A program that couldn't load (offline, a dropped connection) is never "not yours"
  if (editId && !existing && (programQ.isError || programQ.fetchStatus === "paused")) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="px-4 py-6 md:px-8">
          {programQ.fetchStatus === "paused" ? (
            <OfflineState what="this program" />
          ) : (
            <ErrorState error={programQ.error} what="this program" onRetry={() => programQ.refetch()} retrying={programQ.isFetching} />
          )}
        </div>
      </div>
    );
  }
  if (editId && (!existing || !existing.is_mine)) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="px-4 py-6 text-center text-sm text-muted-foreground md:px-8">
          You can only edit your own programs.{" "}
          <Link to="/portal/programs" className="underline">
            Back to programs
          </Link>
        </div>
      </div>
    );
  }
  if (!editId) return <NewProgram remote={remote.draft} />;
  return <Builder existing={existing ?? null} remote={remote.draft} />;
}

/**
 * The server's draft of this program (null: a new one), read before the
 * builder opens so unsaved work from another device comes back. Never holds
 * the builder up for long: offline or slow, it opens with this device's copy.
 */
function useRemoteDraft(programId: string | null): { waiting: boolean; draft: ServerDraft | null } {
  const q = useQuery({
    queryKey: draftKeys.one(programId),
    queryFn: () => fetchServerDraft(programId),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const waiting = q.isPending && q.fetchStatus === "fetching" && !gaveUp;
  return { waiting, draft: q.data ?? null };
}

/** A half-built program kept on this device (the builder picks it up instead of asking again). */
function hasKeptDraft(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    const raw = localStorage.getItem(draftBackupKey(userId, null));
    return !!raw && !!usableBackup(JSON.parse(raw), null, Date.now());
  } catch {
    return false;
  }
}

const WEEK_CHOICES = [4, 8, 12, 16];

/**
 * A new program starts with its shape: a name, how many weeks and how many
 * training days a week. The builder opens on exactly that (every week
 * following week 1 until one is changed), so the first thing to do there is
 * add exercises. Skipped when a half-built one is waiting on this device.
 */
function NewProgram({ remote }: { remote: ServerDraft | null }) {
  const { user } = useAuth();
  const [shape, setShape] = useState<null | { title: string; weeks: number; days: number }>(() =>
    hasKeptDraft(user?.id) || (remote && remote.base == null) ? { title: "", weeks: DEFAULT_WEEKS, days: 1 } : null,
  );
  const [title, setTitle] = useState("");
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [days, setDays] = useState(3);
  if (shape) return <Builder existing={null} shape={shape} remote={remote} />;
  return (
    <div className="mx-auto w-full max-w-2xl pb-28" data-new-program-setup>
      <PageHeader title="Build a program" backTo="/portal/programs" />
      <div className="space-y-6 px-4 py-3 md:px-8">
        <div>
          <label htmlFor="new-program-name" className="text-[15px] font-semibold">
            Name
          </label>
          <input
            id="new-program-name"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            placeholder="e.g. Off-season strength"
            className="mt-2 block h-12 w-full rounded-lg border border-input bg-background px-3 text-[16px] outline-none focus:border-foreground/40"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>

        <div>
          <div className="text-[15px] font-semibold">How long</div>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Program length">
            {WEEK_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={weeks === n}
                onClick={() => setWeeks(n)}
                className={cn(
                  "h-11 min-w-[4.5rem] rounded-lg border px-3 text-[15px] font-medium",
                  weeks === n ? "border-foreground bg-foreground text-background" : "border-border",
                )}
              >
                {n} weeks
              </button>
            ))}
          </div>
          <Stepper
            label="weeks"
            value={weeks}
            min={1}
            max={MAX_WEEKS}
            onChange={setWeeks}
            note={WEEK_CHOICES.includes(weeks) ? null : "Your own length"}
          />
        </div>

        <div>
          <div className="text-[15px] font-semibold">Training days a week</div>
          <div className="mt-2 grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Training days a week">
            {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={days === n}
                aria-label={`${n} ${n === 1 ? "day" : "days"} a week`}
                onClick={() => setDays(n)}
                className={cn(
                  "h-11 rounded-lg border text-[15px] font-medium tabular-nums",
                  days === n ? "border-foreground bg-foreground text-background" : "border-border",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            You can add or remove days, weeks and blocks any time while you build.
          </p>
        </div>

        <Button
          className="h-12 w-full text-[16px]"
          onClick={() => setShape({ title: title.trim(), weeks, days })}
          data-start-building
        >
          Start building
        </Button>
        <Link
          to="/portal/programs/import"
          className="flex items-center justify-center gap-2 text-[14px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Upload className="h-4 w-4" aria-hidden /> Already have it written down? Import it
        </Link>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  note: string | null;
}) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`One fewer ${label.replace(/s$/, "")}`}
        className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[5.5rem] text-center text-[15px] font-medium tabular-nums" aria-live="polite">
        {value} {value === 1 ? label.replace(/s$/, "") : label}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`One more ${label.replace(/s$/, "")}`}
        className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
      {note && <span className="text-[13px] text-muted-foreground">{note}</span>}
    </div>
  );
}

function Builder({
  existing,
  shape,
  remote,
}: {
  existing: ReturnType<typeof useProgram>["data"] | null;
  shape?: { title: string; weeks: number; days: number };
  remote: ServerDraft | null;
}) {
  // made once: a refetch while editing never resets the draft
  const [start] = useState<ProgramDraft>(() =>
    existing
      ? {
          id: existing.id,
          title: existing.title,
          description: existing.description ?? "",
          goal: existing.goal,
          level: existing.level,
          plan: detailPlan(existing),
        }
      : {
          id: null,
          title: shape?.title ?? "",
          description: "",
          goal: null,
          level: null,
          plan: newPlan(shape?.weeks ?? DEFAULT_WEEKS, shape?.days ?? 1),
        },
  );
  const editor = useProgramEditor(start, existing?.updated_at ?? null, { remote });
  return <ProgramWorkbench editor={editor} />;
}
