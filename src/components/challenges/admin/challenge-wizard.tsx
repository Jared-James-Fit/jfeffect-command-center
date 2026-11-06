/**
 * The challenge builder: four short steps (Basics, Scoring, Registration &
 * prizes, Review & publish), every change saved as you go. A new challenge is
 * a draft the moment its kind is picked, so nothing typed is ever lost; a
 * preset fills scoring and rules, so most events need a name, a date and a
 * venue, then Publish.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/challenges/ui";
import {
  ActivityPicker,
  Chips,
  CoverField,
  DateTimeField,
  F,
  ListEditor,
  Toggle,
} from "@/components/challenges/admin/fields";
import {
  duplicateChallenge,
  errorText,
  fetchAdminList,
  invalidateChallenge,
  setStatus,
} from "@/lib/challenges/api";
import {
  PRESETS,
  eventWhen,
  ordinal,
  scoringText,
  tiebreakText,
  unitsFor,
  type ChallengePreset,
  type CollectLevel,
  type Tiebreak,
  type Unit,
} from "@/lib/challenges/model";
import {
  SCORING_CHOICES,
  WIZARD_STEPS,
  applyScoringChoice,
  buildPatch,
  draftFromPreset,
  followSlug,
  isUntitled,
  missingItems,
  nextSlug,
  scoringChoiceOf,
  stepDone,
  type ChallengeRow,
  type WizardStep,
} from "@/lib/challenges/wizard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const TIMEZONES = [
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Toronto",
  "America/Halifax",
];

/**
 * Back / Next / Publish. On a phone it's pinned above the floating tab bar
 * (fixed: the admin page's <main> clips sideways, which turns sticky off);
 * on wider screens it sits at the end of the form. The form keeps room for it.
 */
const ACTION_BAR =
  "fixed inset-x-0 z-30 flex gap-2 border-t border-border bg-background px-4 py-3 md:static md:mt-8 md:border-0 md:bg-transparent md:px-0 md:py-0";
const ACTION_BAR_STYLE = { bottom: "calc(var(--bottom-nav-clearance, 0px) + env(safe-area-inset-bottom))" };
const ACTION_BAR_ROOM = <div className="h-24 md:hidden" aria-hidden />;

/* ------------------------------------------------------------------ */
/*  Start: pick a kind, a template or a past event (makes the draft)   */
/* ------------------------------------------------------------------ */

export function StartChallenge() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["challenges", "admin-list"], queryFn: fetchAdminList });
  const [busy, setBusy] = useState<string | null>(null);
  const templates = (list.data ?? []).filter((c) => c.is_template);
  const past = (list.data ?? []).filter((c) => !c.is_template && !c.is_test).slice(0, 6);

  const open = (id: string) =>
    navigate({ to: "/admin/challenges/$id/edit", params: { id }, search: { step: 1 } });

  const fromPreset = async (p: ChallengePreset) => {
    if (busy) return;
    setBusy(p.key);
    try {
      const { data, error } = await db
        .from("challenges")
        .insert(draftFromPreset(p))
        .select("id")
        .single();
      if (error) throw error;
      invalidateChallenge(qc);
      void open(data.id as string);
    } catch (e) {
      toast.error(errorText(e));
      setBusy(null);
    }
  };
  const copy = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      const nid = await duplicateChallenge(id, false);
      invalidateChallenge(qc);
      void open(nid);
    } catch (e) {
      toast.error(errorText(e));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold">What kind of challenge?</h2>
        <p className="mb-3 mt-0.5 text-sm text-muted-foreground">
          Sets up scoring and rules for you. Everything can be changed.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={!!busy}
              onClick={() => void fromPreset(p)}
              className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-border p-4 text-left hover:bg-muted disabled:opacity-60"
            >
              <span>
                <span className="block font-semibold">{p.label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{p.hint}</span>
              </span>
              {busy === p.key ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
            </button>
          ))}
        </div>
      </section>
      {templates.length || past.length ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">Or start from</h2>
          <div className="grid gap-2">
            {[...templates, ...past].map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!!busy}
                onClick={() => void copy(t.id)}
                className="flex min-h-[60px] items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:bg-muted disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.is_template
                      ? "Your template"
                      : "Copies the setup, rules and prizes. Never entries or scores."}
                  </span>
                </span>
                {busy === t.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading                                                            */
/* ------------------------------------------------------------------ */

type DivisionItem = { key: string; id?: string; name: string; load_label: string };
type PrizeItem = {
  key: string;
  id?: string;
  place: number;
  title: string;
  division_id: string | null;
  awarded: boolean;
};

type WizardData = {
  c: ChallengeRow;
  divisions: DivisionItem[];
  prizes: PrizeItem[];
  scored: boolean;
};

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function useWizardData(id: string) {
  return useQuery({
    queryKey: ["challenges", "wizard", id],
    queryFn: async (): Promise<WizardData | null> => {
      const [c, d, p, a] = await Promise.all([
        db.from("challenges").select("*").eq("id", id).maybeSingle(),
        db
          .from("challenge_divisions")
          .select("id,name,load_label,sort")
          .eq("challenge_id", id)
          .order("sort"),
        db
          .from("challenge_prizes")
          .select("id,place,title,division_id,winner_entry_id")
          .eq("challenge_id", id)
          .order("place"),
        db
          .from("challenge_attempts")
          .select("id", { count: "exact", head: true })
          .eq("challenge_id", id)
          .eq("status", "verified"),
      ]);
      if (c.error) throw c.error;
      if (!c.data) return null;
      const row = c.data as ChallengeRow;
      return {
        c: {
          ...row,
          rules: (row.rules ?? []) as string[],
          acknowledgments: (row.acknowledgments ?? []) as string[],
          collect: row.collect ?? {},
        },
        divisions: ((d.data ?? []) as { id: string; name: string; load_label: string | null }[]).map(
          (x) => ({ key: newKey(), id: x.id, name: x.name, load_label: x.load_label ?? "" }),
        ),
        prizes: (
          (p.data ?? []) as {
            id: string;
            place: number;
            title: string;
            division_id: string | null;
            winner_entry_id: string | null;
          }[]
        ).map((x) => ({
          key: newKey(),
          id: x.id,
          place: x.place,
          title: x.title,
          division_id: x.division_id,
          awarded: !!x.winner_entry_id,
        })),
        scored: (a.count ?? 0) > 0,
      };
    },
    // the builder owns its copy once open: a refetch never overwrites what's being typed
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Autosave                                                           */
/* ------------------------------------------------------------------ */

type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; msg: string };

/**
 * One serialized save at a time; the latest edit always wins, and leaving the
 * page flushes. `run` resolves true when it wrote something.
 */
function useSerialSave(run: () => Promise<boolean>, deps: unknown[], delay = 700) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const runRef = useRef(run);
  runRef.current = run;
  const chain = useRef<Promise<void>>(Promise.resolve());
  // what was on screen when it opened: only a real change schedules a save
  // (React runs effects twice in development, so a "first run" flag isn't enough)
  const opened = useRef<unknown[] | null>(deps);

  const wrote = useRef(false);
  const flush = useCallback(() => {
    const p = chain.current.then(async () => {
      try {
        // true = something was written; nothing to write leaves the badge as it was
        if (await runRef.current()) {
          wrote.current = true;
          setState({ kind: "saved" });
        } else {
          setState((s) =>
            s.kind === "saving" ? { kind: wrote.current ? "saved" : "idle" } : s,
          );
        }
      } catch (e) {
        setState({ kind: "error", msg: errorText(e) });
      }
    });
    chain.current = p;
    return p;
  }, []);

  useEffect(() => {
    if (opened.current && deps.every((d, i) => d === opened.current![i])) return;
    opened.current = null;
    setState((s) => (s.kind === "error" ? s : { kind: "saving" }));
    const t = setTimeout(() => void flush(), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // leaving the builder saves what's pending
  useEffect(() => () => void flush(), [flush]);
  return { state, flush, retry: flush };
}

function useChallengeAutosave(
  saved0: ChallengeRow,
  row: ChallengeRow,
  setRow: (f: (r: ChallengeRow) => ChallengeRow) => void,
  opts: { slugLocked: boolean; scoringLocked: boolean },
  onSaved: () => void,
) {
  const saved = useRef(saved0);
  const rowRef = useRef(row);
  rowRef.current = row;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  return useSerialSave(async () => {
    const { patch } = buildPatch(saved.current, rowRef.current, optsRef.current);
    if (!Object.keys(patch).length) return false;
    let attempt = 0;
    const wanted = typeof patch.slug === "string" ? patch.slug : "";
    for (;;) {
      const { error } = await db.from("challenges").update(patch).eq("id", saved.current.id);
      if (!error) break;
      // a draft's link is taken: try the next one, quietly
      if (patch.slug && /duplicate key|challenges_slug_key|unique/i.test(error.message ?? "") && attempt < 6) {
        patch.slug = nextSlug(wanted, attempt++);
        continue;
      }
      throw error;
    }
    saved.current = { ...saved.current, ...(patch as Partial<ChallengeRow>) };
    if (patch.slug && patch.slug !== rowRef.current.slug) {
      const s = String(patch.slug);
      setRow((r) => ({ ...r, slug: s }));
    }
    onSaved();
    return true;
  }, [row]);
}

/** Keeps a small child list (divisions, prizes) in step with its table. */
function useListAutosave<T extends { key: string; id?: string }>(
  table: "challenge_divisions" | "challenge_prizes",
  challengeId: string,
  items: T[],
  setItems: (f: (x: T[]) => T[]) => void,
  toRecord: (x: T, i: number) => Record<string, unknown> | null,
  initial: T[],
  onSaved: () => void,
) {
  const saved = useRef(
    new Map(
      initial.filter((x) => x.id).map((x, i) => [x.id!, JSON.stringify(toRecord(x, i))] as const),
    ),
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  return useSerialSave(async () => {
    const cur = itemsRef.current;
    let changed = false;
    const ids = new Set(cur.filter((x) => x.id).map((x) => x.id!));
    for (const id of [...saved.current.keys()]) {
      if (ids.has(id)) continue;
      const { error } = await db.from(table).delete().eq("id", id);
      if (error) throw error;
      saved.current.delete(id);
      changed = true;
    }
    for (const [i, x] of cur.entries()) {
      const rec = toRecord(x, i);
      if (!rec) continue; // not filled in yet
      const json = JSON.stringify(rec);
      if (x.id) {
        if (saved.current.get(x.id) === json) continue;
        const { error } = await db.from(table).update(rec).eq("id", x.id);
        if (error) throw error;
        saved.current.set(x.id, json);
      } else {
        const { data, error } = await db
          .from(table)
          .insert({ ...rec, challenge_id: challengeId })
          .select("id")
          .single();
        if (error) throw error;
        const id = data.id as string;
        saved.current.set(id, json);
        setItems((list) => list.map((y) => (y.key === x.key ? { ...y, id } : y)));
      }
      changed = true;
    }
    if (changed) onSaved();
    return changed;
  }, [items]);
}

/* ------------------------------------------------------------------ */
/*  The builder                                                        */
/* ------------------------------------------------------------------ */

export function ChallengeWizard({
  id,
  step,
  onStep,
}: {
  id: string;
  step: WizardStep;
  onStep: (s: WizardStep) => void;
}) {
  const q = useWizardData(id);
  if (q.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (!q.data) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Challenge not found.</p>;
  }
  return <WizardBody key={id} data={q.data} step={step} onStep={onStep} />;
}

function WizardBody({
  data,
  step,
  onStep,
}: {
  data: WizardData;
  step: WizardStep;
  onStep: (s: WizardStep) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [row, setRow] = useState<ChallengeRow>(data.c);
  const [divisions, setDivisions] = useState<DivisionItem[]>(data.divisions);
  const [prizes, setPrizes] = useState<PrizeItem[]>(data.prizes);
  const published = row.status !== "draft";
  const slugLocked = published && !row.is_template;
  const scoringLocked = published && data.scored;

  // other screens (the dashboard, the public page) refresh after each save
  const touched = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaved = useCallback(() => {
    if (touched.current) clearTimeout(touched.current);
    touched.current = setTimeout(() => {
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "challenges" && q.queryKey[1] !== "wizard",
      });
    }, 1500);
  }, [qc]);

  const main = useChallengeAutosave(data.c, row, setRow, { slugLocked, scoringLocked }, onSaved);
  const divs = useListAutosave(
    "challenge_divisions",
    row.id,
    divisions,
    setDivisions,
    (d, i) =>
      d.name.trim()
        ? { name: d.name.trim().slice(0, 40), load_label: d.load_label.trim() || null, sort: i }
        : null,
    data.divisions,
    onSaved,
  );
  const prz = useListAutosave(
    "challenge_prizes",
    row.id,
    prizes,
    setPrizes,
    (p) =>
      p.title.trim()
        ? { place: p.place, title: p.title.trim().slice(0, 120), division_id: p.division_id }
        : null,
    data.prizes,
    onSaved,
  );

  const states = [main.state, divs.state, prz.state];
  const saveState: SaveState =
    states.find((s) => s.kind === "error") ??
    states.find((s) => s.kind === "saving") ??
    (states.some((s) => s.kind === "saved") ? { kind: "saved" } : { kind: "idle" });
  const flushAll = async () => {
    await Promise.all([main.flush(), divs.flush(), prz.flush()]);
  };

  // warn before closing the tab with an unsaved change
  useEffect(() => {
    if (saveState.kind !== "saving" && saveState.kind !== "error") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [saveState.kind]);

  const set = <K extends keyof ChallengeRow>(k: K, v: ChallengeRow[K]) =>
    setRow((r) => ({ ...r, [k]: v }));
  const setTitle = (title: string) =>
    setRow((r) => ({
      ...r,
      title,
      slug: r.status === "draft" ? followSlug(r.title, r.slug, title) : r.slug,
    }));

  const missing = missingItems(row);
  const go = (s: WizardStep) => {
    onStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/admin/challenges/$id"
          params={{ id: row.id }}
          className="-ml-1 flex h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => void flushAll()}
        >
          <ChevronLeft className="h-4 w-4" /> {published ? "Dashboard" : "Challenges"}
        </Link>
        <SaveBadge state={saveState} onRetry={() => void flushAll()} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <h1 className="min-w-0 truncate text-2xl font-semibold">
          {isUntitled(row.title) || !row.title.trim() ? "New challenge" : row.title}
        </h1>
        {row.is_template ? (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">Template</span>
        ) : (
          <StatusPill status={row.status as never} final={!!row.results_final_at} />
        )}
      </div>

      <Stepper step={step} row={row} onStep={go} />

      <div className="mt-6 space-y-6">
        {step === 1 ? (
          <BasicsStep row={row} set={set} setTitle={setTitle} slugLocked={slugLocked} />
        ) : step === 2 ? (
          <ScoringStep
            row={row}
            setRow={setRow}
            set={set}
            locked={scoringLocked}
            divisions={divisions}
            setDivisions={setDivisions}
            published={published}
          />
        ) : step === 3 ? (
          <RegistrationStep row={row} set={set} prizes={prizes} setPrizes={setPrizes} />
        ) : (
          <ReviewStep
            row={row}
            prizes={prizes}
            divisions={divisions}
            missing={missing}
            onStep={go}
            flush={flushAll}
            onPublished={() => {
              invalidateChallenge(qc);
              navigate({ to: "/admin/challenges/$id", params: { id: row.id } });
            }}
            onStatus={(status) => setRow((r) => ({ ...r, status }))}
          />
        )}
      </div>

      {step < 4 ? (
        <div
          className={ACTION_BAR}
          style={ACTION_BAR_STYLE}
        >
          <Button
            variant="outline"
            className="h-12 w-12 shrink-0 p-0"
            disabled={step === 1}
            onClick={() => go((step - 1) as WizardStep)}
            aria-label="Previous step"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button className="h-12 flex-1 text-base" onClick={() => go((step + 1) as WizardStep)}>
            Next: {WIZARD_STEPS.find((x) => x.n === step + 1)?.title} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {ACTION_BAR_ROOM}
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-destructive"
        title={state.msg}
      >
        <CloudOff className="h-4 w-4" /> Not saved · Retry
      </button>
    );
  }
  return (
    <span className="flex h-10 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {state.kind === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </>
      ) : state.kind === "saved" ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" /> Saved
        </>
      ) : (
        "Changes save as you go"
      )}
    </span>
  );
}

function Stepper({
  step,
  row,
  onStep,
}: {
  step: WizardStep;
  row: ChallengeRow;
  onStep: (s: WizardStep) => void;
}) {
  return (
    <nav className="mt-4" aria-label="Builder steps">
      <ol className="grid grid-cols-4 gap-1.5">
        {WIZARD_STEPS.map((s) => {
          const active = s.n === step;
          const done = s.n < 4 && stepDone(row, s.n as WizardStep);
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => onStep(s.n as WizardStep)}
                aria-current={active ? "step" : undefined}
                className="flex w-full flex-col gap-1.5 pt-1 text-left"
              >
                <span
                  className={cn(
                    "h-1 w-full rounded-full",
                    active ? "bg-foreground" : done ? "bg-foreground/35" : "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-xs",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.n}. {s.n === 3 ? "Registration" : s.n === 4 ? "Review" : s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Folded-away settings most events never touch. */
function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center justify-between px-4 text-left text-sm font-medium"
      >
        {label}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="space-y-5 border-t border-border p-4">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Basics                                                          */
/* ------------------------------------------------------------------ */

function BasicsStep({
  row,
  set,
  setTitle,
  slugLocked,
}: {
  row: ChallengeRow;
  set: <K extends keyof ChallengeRow>(k: K, v: ChallengeRow[K]) => void;
  setTitle: (t: string) => void;
  slugLocked: boolean;
}) {
  const [showEnd, setShowEnd] = useState(!!row.ends_at);
  const [showAddress, setShowAddress] = useState(!!row.address);
  const untitled = isUntitled(row.title);
  const titleShort = !untitled && row.title.trim().length > 0 && row.title.trim().length < 3;
  return (
    <>
      <F htmlFor="ch-name" label="Name">
        <Input
          id="ch-name"
          value={untitled ? "" : row.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Winnipeg 225 Bench Press Challenge"
          className="h-12 text-base"
          maxLength={90}
          autoFocus={untitled}
          aria-invalid={titleShort || undefined}
        />
        {titleShort ? <p className="mt-1 text-xs text-destructive">At least 3 characters.</p> : null}
      </F>
      <F label="Activity">
        <ActivityPicker
          value={row.activity}
          exerciseId={row.exercise_id}
          onChange={(name, exId) => {
            set("activity", name);
            set("exercise_id", exId);
          }}
        />
      </F>
      <div className="space-y-2">
        <DateTimeField
          label="Date and start time"
          value={row.starts_at}
          tz={row.timezone}
          onChange={(v) => set("starts_at", v)}
        />
        {showEnd ? (
          <>
            <DateTimeField
              label="Ends"
              value={row.ends_at}
              tz={row.timezone}
              onChange={(v) => set("ends_at", v)}
            />
            {row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at) ? (
              <p className="text-xs text-destructive">The end has to be after the start.</p>
            ) : null}
          </>
        ) : (
          <AddLink onClick={() => setShowEnd(true)}>Add an end time</AddLink>
        )}
      </div>
      <div className="space-y-2">
        <F htmlFor="ch-venue" label="Venue">
          <Input
            id="ch-venue"
            value={row.venue_name ?? ""}
            onChange={(e) => set("venue_name", e.target.value)}
            placeholder="Gym or venue name"
            className="h-11"
            maxLength={120}
          />
        </F>
        <F htmlFor="ch-city" label="City">
          <Input
            id="ch-city"
            value={row.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
            className="h-11"
            maxLength={120}
          />
        </F>
        {showAddress ? (
          <F htmlFor="ch-address" label="Street address">
            <Input
              id="ch-address"
              value={row.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
              className="h-11"
              maxLength={200}
            />
          </F>
        ) : (
          <AddLink onClick={() => setShowAddress(true)}>Add the street address</AddLink>
        )}
      </div>
      <More label="More: description, artwork, link">
        <F htmlFor="ch-tagline" label="One line under the name" hint="What it is, in a sentence people repeat.">
          <Input
            id="ch-tagline"
            value={row.tagline ?? ""}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="225 lb. One set. As many clean reps as you've got."
            className="h-11"
            maxLength={140}
          />
        </F>
        <F htmlFor="ch-about" label="About">
          <Textarea
            id="ch-about"
            value={row.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            rows={4}
            maxLength={4000}
          />
        </F>
        <CoverField path={row.cover_path} onChange={(p) => set("cover_path", p)} />
        <F htmlFor="ch-tz" label="Time zone">
          <select
            id="ch-tz"
            value={row.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>
                {t.replace("America/", "").replace("_", " ")}
              </option>
            ))}
          </select>
        </F>
        <F
          htmlFor="ch-link"
          label="Link"
          hint={
            slugLocked
              ? "A published link can't change (shared links would break)."
              : `jfeffect.com/challenges/${row.slug}`
          }
        >
          <Input
            id="ch-link"
            value={row.slug}
            disabled={slugLocked}
            onChange={(e) =>
              set(
                "slug",
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, "-")
                  .replace(/-+/g, "-")
                  .slice(0, 60),
              )
            }
            className="h-11 font-mono"
          />
        </F>
      </More>
    </>
  );
}

function AddLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <Plus className="h-4 w-4" /> {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Scoring                                                         */
/* ------------------------------------------------------------------ */

function ScoringStep({
  row,
  setRow,
  set,
  locked,
  divisions,
  setDivisions,
  published,
}: {
  row: ChallengeRow;
  setRow: (f: (r: ChallengeRow) => ChallengeRow) => void;
  set: <K extends keyof ChallengeRow>(k: K, v: ChallengeRow[K]) => void;
  locked: boolean;
  divisions: DivisionItem[];
  setDivisions: (f: (x: DivisionItem[]) => DivisionItem[]) => void;
  published: boolean;
}) {
  const choice = scoringChoiceOf(row);
  const units = unitsFor(row.measure);
  return (
    <>
      {locked ? (
        <div className="flex gap-2.5 rounded-2xl bg-muted p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            Scoring is locked: scores are in, and changing how they're counted would reshuffle
            results people have already seen. Rules and wording can still change.
          </p>
        </div>
      ) : null}

      <fieldset disabled={locked} className="space-y-6 disabled:opacity-60">
        <div>
          <legend className="text-sm font-medium">How does someone win?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SCORING_CHOICES.map((s) => {
              const on = choice === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRow((r) => ({ ...r, ...applyScoringChoice(r, s.key) }))}
                  className={cn(
                    "relative min-h-[76px] rounded-2xl border p-3 text-left",
                    on ? "border-foreground bg-secondary" : "border-border hover:bg-muted",
                  )}
                >
                  <span className="block pr-5 text-sm font-semibold">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
                  {on ? <Check className="absolute right-3 top-3 h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        {row.measure === "reps" ? (
          <F htmlFor="ch-load" label="Set weight (optional)" hint='Shown big on the page, e.g. "225 lb". Leave empty for bodyweight.'>
            <Input
              id="ch-load"
              value={row.load_label ?? ""}
              onChange={(e) => set("load_label", e.target.value)}
              placeholder="225 lb"
              className="h-11"
              maxLength={40}
            />
          </F>
        ) : null}
        {units.length > 1 ? (
          <F label="Unit">
            <Chips value={row.unit} options={units.map((u) => [u, u])} onChange={(u) => set("unit", u as Unit)} />
          </F>
        ) : null}
        {row.measure === "weight" ? (
          <Toggle
            label="Score per bodyweight"
            hint="Best lift ÷ bodyweight. Everyone's weighed at check-in."
            checked={row.relative_to_bodyweight}
            onChange={(v) => set("relative_to_bodyweight", v)}
          />
        ) : null}
        {row.measure === "time" ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            Judges enter seconds (83.4) or minutes and seconds (1:23.4).
          </p>
        ) : null}

        <F label="Scored attempts">
          <Chips
            value={String(row.attempts_allowed)}
            options={[
              ["1", "1"],
              ["2", "2"],
              ["3", "3"],
              ["5", "5"],
            ]}
            onChange={(v) => set("attempts_allowed", Number(v))}
          />
        </F>
        {row.attempts_allowed > 1 ? (
          <F label="Which counts">
            <Chips
              value={row.aggregate}
              options={[
                ["best", "Their best one"],
                ["sum", "All added together"],
              ]}
              onChange={(a) => set("aggregate", a as "best" | "sum")}
            />
          </F>
        ) : null}

        <F label="If athletes tie" hint={tiebreakText(row)}>
          <Chips
            value={row.tiebreak}
            options={[
              ["shared", "Share the place"],
              ["lighter", "Lighter athlete wins"],
              ["runoff", "Run-off"],
            ]}
            onChange={(t) => set("tiebreak", t as Tiebreak)}
          />
        </F>
      </fieldset>

      <div className="rounded-2xl bg-muted p-4 text-sm">
        <p className="font-medium">On the page</p>
        <p className="mt-1">{scoringText({ ...row, relative: row.relative_to_bodyweight })}</p>
      </div>

      <ListEditor
        label="Rules"
        hint="The judging standard, one per line. Shown on the page and needed to publish."
        items={row.rules}
        onChange={(v) => set("rules", v)}
        addLabel="Add a rule"
      />

      <More label="More: goal line, divisions">
        <F htmlFor="ch-goal" label="The goal in a few words" hint="Shown under the name.">
          <Input
            id="ch-goal"
            value={row.objective ?? ""}
            onChange={(e) => set("objective", e.target.value)}
            placeholder="Most valid reps in one continuous set"
            className="h-11"
            maxLength={120}
          />
        </F>
        <DivisionsList divisions={divisions} setDivisions={setDivisions} published={published} />
      </More>
    </>
  );
}

function DivisionsList({
  divisions,
  setDivisions,
  published,
}: {
  divisions: DivisionItem[];
  setDivisions: (f: (x: DivisionItem[]) => DivisionItem[]) => void;
  published: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium">Divisions</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Optional. A division with its own load (e.g. Women · 135 lb) gets its own board and places.
      </p>
      <div className="mt-2 space-y-2">
        {divisions.map((d) => (
          <div key={d.key} className="flex gap-2">
            <Input
              value={d.name}
              onChange={(e) =>
                setDivisions((l) => l.map((x) => (x.key === d.key ? { ...x, name: e.target.value } : x)))
              }
              placeholder="Name"
              className="h-11 min-w-0 flex-1"
              maxLength={40}
            />
            <Input
              value={d.load_label}
              onChange={(e) =>
                setDivisions((l) =>
                  l.map((x) => (x.key === d.key ? { ...x, load_label: e.target.value } : x)),
                )
              }
              placeholder="Own load"
              className="h-11 w-28"
              maxLength={40}
            />
            {/* once people have signed up, a division can be renamed but not removed */}
            {!published || !d.id ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-11 shrink-0 p-0"
                onClick={() => setDivisions((l) => l.filter((x) => x.key !== d.key))}
                aria-label="Remove division"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => setDivisions((l) => [...l, { key: newKey(), name: "", load_label: "" }])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add a division
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Registration & prizes                                           */
/* ------------------------------------------------------------------ */

function RegistrationStep({
  row,
  set,
  prizes,
  setPrizes,
}: {
  row: ChallengeRow;
  set: <K extends keyof ChallengeRow>(k: K, v: ChallengeRow[K]) => void;
  prizes: PrizeItem[];
  setPrizes: (f: (x: PrizeItem[]) => PrizeItem[]) => void;
}) {
  const own = prizes.filter((p) => !p.division_id);
  const nextPlace = own.length ? Math.max(...own.map((p) => p.place)) + 1 : 1;
  const numberIn = (v: string) => (v.trim() ? Number(v.replace(/\D/g, "")) || 0 : null);
  return (
    <>
      <Toggle
        label="People can register themselves"
        hint="From the page or the QR code at the venue. Staff can always register people."
        checked={row.self_registration}
        onChange={(v) => set("self_registration", v)}
      />
      <div className="grid grid-cols-2 gap-3">
        <F htmlFor="ch-spots" label="Spots">
          <Input
            id="ch-spots"
            inputMode="numeric"
            value={row.max_participants ?? ""}
            onChange={(e) => set("max_participants", numberIn(e.target.value))}
            placeholder="No limit"
            className="h-11"
          />
        </F>
        <F htmlFor="ch-entry" label="Entry">
          <Input
            id="ch-entry"
            value={row.entry_fee_label ?? ""}
            onChange={(e) => set("entry_fee_label", e.target.value)}
            placeholder="Free"
            className="h-11"
            maxLength={40}
          />
        </F>
      </div>
      <F htmlFor="ch-age" label="Minimum age">
        <Input
          id="ch-age"
          inputMode="numeric"
          value={row.min_age}
          onChange={(e) => set("min_age", Math.min(99, numberIn(e.target.value) ?? 0))}
          className="h-11 w-28"
        />
      </F>

      <div className="space-y-3">
        <F htmlFor="ch-prize" label="Prize, in a few words" hint="Shown at the top of the page and on cards.">
          <Input
            id="ch-prize"
            value={row.prize_summary ?? ""}
            onChange={(e) => set("prize_summary", e.target.value)}
            placeholder="$225 CAD + winner's trophy"
            className="h-11"
            maxLength={140}
          />
        </F>
        <div>
          <p className="text-sm font-medium">Prizes by place</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Winners are filled in when you confirm the results.
          </p>
          <ul className="mt-2 space-y-2">
            {own.map((p) => (
              <li key={p.key} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-sm font-semibold">{ordinal(p.place)}</span>
                <Input
                  value={p.title}
                  disabled={p.awarded}
                  onChange={(e) =>
                    setPrizes((l) => l.map((x) => (x.key === p.key ? { ...x, title: e.target.value } : x)))
                  }
                  placeholder={p.place === 1 ? row.prize_summary || "$225 CAD + trophy" : "Prize"}
                  className="h-11 min-w-0 flex-1"
                  maxLength={120}
                />
                {!p.awarded ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-11 shrink-0 p-0"
                    onClick={() => setPrizes((l) => l.filter((x) => x.key !== p.key))}
                    aria-label={`Remove the ${ordinal(p.place)} place prize`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {nextPlace <= 50 ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-10"
              onClick={() =>
                setPrizes((l) => [
                  ...l,
                  {
                    key: newKey(),
                    place: nextPlace,
                    title: nextPlace === 1 ? (row.prize_summary ?? "") : "",
                    division_id: null,
                    awarded: false,
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add {ordinal(nextPlace)} place
            </Button>
          ) : null}
          {prizes.some((p) => p.division_id) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Division prizes and sponsors are managed on the dashboard's Prizes tab.
            </p>
          ) : null}
        </div>
      </div>

      <F htmlFor="ch-who" label="Who can enter (optional)">
        <Textarea
          id="ch-who"
          value={row.eligibility ?? ""}
          onChange={(e) => set("eligibility", e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Adults 18+ with bench press experience."
        />
      </F>

      <More label="More: registration window, what to ask, waiver, safety">
        <DateTimeField
          label="Registration opens (optional)"
          value={row.registration_opens_at}
          tz={row.timezone}
          onChange={(v) => set("registration_opens_at", v)}
        />
        <DateTimeField
          label="Registration closes (optional)"
          value={row.registration_closes_at}
          tz={row.timezone}
          onChange={(v) => set("registration_closes_at", v)}
        />
        {row.registration_opens_at &&
        row.registration_closes_at &&
        new Date(row.registration_closes_at) <= new Date(row.registration_opens_at) ? (
          <p className="-mt-3 text-xs text-destructive">Registration has to close after it opens.</p>
        ) : null}
        <F label="Ask for a phone number">
          <Chips
            value={row.collect.phone ?? "optional"}
            options={[
              ["off", "Don't ask"],
              ["optional", "Optional"],
              ["required", "Required"],
            ]}
            onChange={(v) => set("collect", { ...row.collect, phone: v as CollectLevel })}
          />
        </F>
        <F label="Ask for Instagram">
          <Chips
            value={row.collect.instagram ?? "optional"}
            options={[
              ["off", "Don't ask"],
              ["optional", "Optional"],
              ["required", "Required"],
            ]}
            onChange={(v) => set("collect", { ...row.collect, instagram: v as CollectLevel })}
          />
        </F>
        <ListEditor
          label="What every entrant confirms"
          hint="Each is a tick box at sign-up, saved with their entry."
          items={row.acknowledgments}
          onChange={(v) => set("acknowledgments", v)}
          addLabel="Add a confirmation"
        />
        <F htmlFor="ch-safety" label="Safety plan">
          <Textarea
            id="ch-safety"
            value={row.safety ?? ""}
            onChange={(e) => set("safety", e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Spotters on every set, safeties set, a judge can stop any set."
          />
        </F>
        <F htmlFor="ch-warmup" label="Warm-up">
          <Textarea
            id="ch-warmup"
            value={row.warmup ?? ""}
            onChange={(e) => set("warmup", e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </F>
      </More>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Review & publish                                                */
/* ------------------------------------------------------------------ */

function ReviewStep({
  row,
  prizes,
  divisions,
  missing,
  onStep,
  flush,
  onPublished,
  onStatus,
}: {
  row: ChallengeRow;
  prizes: PrizeItem[];
  divisions: DivisionItem[];
  missing: ReturnType<typeof missingItems>;
  onStep: (s: WizardStep) => void;
  flush: () => Promise<void>;
  onPublished: () => void;
  onStatus: (s: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const shape = { ...row, relative: row.relative_to_bodyweight };
  const when = useMemo(() => eventWhen(row.starts_at, row.timezone, { withYear: true }), [row.starts_at, row.timezone]);
  const draft = row.status === "draft" && !row.is_template;

  const publish = async () => {
    setBusy(true);
    try {
      await flush();
      await setStatus(row.id, "upcoming");
      onStatus("upcoming");
      toast.success("Published. It's on the Challenges page.");
      onPublished();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const facts = [row.load_label, row.objective, row.prize_summary ? `Prize: ${row.prize_summary}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {missing.length ? (
        <div className="rounded-2xl border border-border p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertCircle className="h-4 w-4 text-warning" /> Before you can publish
          </p>
          <ul className="mt-2 space-y-1">
            {missing.map((m) => (
              <li key={m.field}>
                <button
                  type="button"
                  onClick={() => onStep(m.step)}
                  className="flex h-10 w-full items-center justify-between rounded-lg px-1 text-left text-sm hover:bg-muted"
                >
                  {m.text}
                  <span className="flex items-center text-xs text-muted-foreground">
                    Step {m.step} <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* what the page will look like at the top */}
      <div className="rounded-2xl border border-border p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Preview</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StatusPill status={draft ? "upcoming" : (row.status as never)} />
          <span>
            {when ?? "Date to be announced"} · {row.venue_name || "Venue to be announced"}
          </span>
        </div>
        <p className="mt-2 font-display text-3xl uppercase leading-[0.95] tracking-wide">
          {isUntitled(row.title) ? "Your challenge" : row.title}
        </p>
        {facts ? <p className="mt-2 text-sm text-muted-foreground">{facts}</p> : null}
        <div className="mt-3 flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {row.self_registration ? "Register" : "View rankings"}
        </div>
        <Link
          to="/challenges/$slug"
          params={{ slug: row.slug }}
          search={{}}
          target="_blank"
          className="mt-3 flex h-10 items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Open the full page <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <dl className="divide-y divide-border rounded-2xl border border-border">
        <Summary label="Basics" onEdit={() => onStep(1)}>
          {[row.activity, when, [row.venue_name, row.city].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ") || "Not set"}
        </Summary>
        <Summary label="Scoring" onEdit={() => onStep(2)}>
          {scoringText(shape)} {row.rules.filter((r) => r.trim()).length} rules.
          {divisions.length ? ` Divisions: ${divisions.map((d) => d.name).filter(Boolean).join(", ")}.` : ""}
        </Summary>
        <Summary label="Registration" onEdit={() => onStep(3)}>
          {row.self_registration ? "Open to sign-ups" : "Staff register people"}
          {row.max_participants ? ` · ${row.max_participants} spots` : ""}
          {row.entry_fee_label ? ` · ${row.entry_fee_label}` : ""} · {row.min_age}+
        </Summary>
        <Summary label="Prizes" onEdit={() => onStep(3)}>
          {prizes.filter((p) => p.title.trim()).length
            ? prizes
                .filter((p) => p.title.trim())
                .map((p) => `${ordinal(p.place)}: ${p.title}`)
                .join(" · ")
            : (row.prize_summary ?? "None")}
        </Summary>
      </dl>

      {draft ? (
        <div
          className={ACTION_BAR}
          style={ACTION_BAR_STYLE}
        >
          <Button
            variant="outline"
            className="h-12 w-12 shrink-0 p-0"
            onClick={() => onStep(3)}
            aria-label="Previous step"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="h-12 flex-1 text-base"
            disabled={!!missing.length || busy}
            onClick={() => setConfirm(true)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Publish
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted p-4 text-sm">
          {row.is_template
            ? "This is a template. New challenges can start from it."
            : "This challenge is published. Changes show on the page as they save."}
          <Button asChild variant="outline" className="mt-3 h-11 w-full">
            <Link to="/admin/challenges/$id" params={{ id: row.id }}>
              Back to the dashboard
            </Link>
          </Button>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this challenge?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the link can see it, it shows on the Challenges page, and people can
              {row.self_registration ? " register." : " see it (staff register athletes)."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Summary({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm">{children}</dd>
      </div>
      <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}
