import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  errorText,
  fetchAdminList,
  invalidateChallenge,
  duplicateChallenge,
  mediaUrl,
  MEDIA_BUCKET,
} from "@/lib/challenges/api";
import {
  DEFAULT_ACKNOWLEDGMENTS,
  PRESETS,
  defaultDirection,
  publishMissing,
  scoringText,
  slugify,
  tiebreakText,
  unitsFor,
  type ChallengePreset,
  type CollectLevel,
  type Direction,
  type Measure,
  type Tiebreak,
  type Unit,
} from "@/lib/challenges/model";
import { localDateISO, localTimeHM, wallTimeToUtc } from "@/lib/schedule-time";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ChallengeRow = {
  id?: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  status?: string;
  activity: string;
  exercise_id: string | null;
  measure: Measure;
  direction: Direction;
  unit: Unit;
  aggregate: "best" | "sum";
  attempts_allowed: number;
  relative_to_bodyweight: boolean;
  load_label: string | null;
  objective: string | null;
  tiebreak: Tiebreak;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  city: string | null;
  address: string | null;
  max_participants: number | null;
  min_age: number;
  eligibility: string | null;
  rules: string[];
  safety: string | null;
  warmup: string | null;
  prize_summary: string | null;
  entry_fee_label: string | null;
  self_registration: boolean;
  collect: { phone?: CollectLevel; instagram?: CollectLevel };
  acknowledgments: string[];
  cover_path: string | null;
  is_template?: boolean;
  is_test?: boolean;
};

type DivisionDraft = { id?: string; name: string; load_label: string };

const TIMEZONES = [
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Toronto",
  "America/Halifax",
];

function blank(preset: ChallengePreset): ChallengeRow {
  return {
    slug: "",
    title: "",
    tagline: null,
    description: null,
    activity: preset.activity,
    exercise_id: null,
    measure: preset.measure,
    direction: preset.direction,
    unit: preset.unit,
    aggregate: preset.aggregate,
    attempts_allowed: preset.attempts_allowed,
    relative_to_bodyweight: preset.relative,
    load_label: preset.load_label,
    objective: preset.objective,
    tiebreak: preset.tiebreak,
    starts_at: null,
    ends_at: null,
    timezone: "America/Winnipeg",
    venue_name: null,
    city: "Winnipeg, Manitoba",
    address: null,
    max_participants: null,
    min_age: 18,
    eligibility: null,
    rules: preset.rules,
    safety: null,
    warmup: null,
    prize_summary: null,
    entry_fee_label: "Free",
    self_registration: true,
    collect: { phone: "optional", instagram: "optional" },
    acknowledgments: DEFAULT_ACKNOWLEDGMENTS,
    cover_path: null,
  };
}

const STEPS = ["Basics", "Scoring", "When & where", "Rules & safety", "Sign-up"] as const;
type Step = (typeof STEPS)[number];

/** New challenges start from a type, a template or a past event; edits open on any step. */
export function ChallengeBuilder({
  existing,
  existingDivisions,
  onSaved,
}: {
  existing?: ChallengeRow & { id: string; status: string };
  existingDivisions?: DivisionDraft[];
  onSaved?: () => void;
}) {
  const editing = !!existing;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<boolean>(editing);
  const [row, setRow] = useState<ChallengeRow>(existing ?? blank(PRESETS[0]!));
  const [divisions, setDivisions] = useState<DivisionDraft[]>(existingDivisions ?? []);
  const [firstPrize, setFirstPrize] = useState("");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [step, setStep] = useState<Step>("Basics");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ChallengeRow>(k: K, v: ChallengeRow[K]) =>
    setRow((r) => ({ ...r, [k]: v }));

  useEffect(() => {
    if (!slugTouched) setRow((r) => ({ ...r, slug: slugify(r.title) }));
  }, [row.title, slugTouched]);

  if (!picked) {
    return (
      <StartFrom
        onPreset={(p) => {
          setRow(blank(p));
          setPicked(true);
        }}
        onCopied={(id) => navigate({ to: "/admin/challenges/$id", params: { id } })}
      />
    );
  }

  const slugLocked = editing && existing!.status !== "draft" && !existing!.is_template;
  const stepIndex = STEPS.indexOf(step);
  const missing = publishMissing({
    starts_at: row.starts_at,
    venue_name: row.venue_name,
    rules: row.rules,
  });

  const validate = (): string | null => {
    if (row.title.trim().length < 3) return "Give it a title.";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug) || row.slug.length < 3)
      return "The link can only use lowercase letters, numbers and dashes.";
    if (row.activity.trim().length < 2) return "Name the activity.";
    if (row.ends_at && row.starts_at && new Date(row.ends_at) <= new Date(row.starts_at))
      return "The end has to be after the start.";
    if (row.relative_to_bodyweight && row.measure !== "weight")
      return "Bodyweight scoring only works for weight.";
    if (divisions.some((d) => !d.name.trim())) return "Every division needs a name.";
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        slug: row.slug,
        title: row.title.trim(),
        tagline: row.tagline?.trim() || null,
        description: row.description?.trim() || null,
        activity: row.activity.trim(),
        exercise_id: row.exercise_id,
        measure: row.measure,
        direction: row.direction,
        unit: row.unit,
        aggregate: row.aggregate,
        attempts_allowed: row.attempts_allowed,
        relative_to_bodyweight: row.relative_to_bodyweight,
        load_label: row.load_label?.trim() || null,
        objective: row.objective?.trim() || null,
        tiebreak: row.tiebreak,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        timezone: row.timezone,
        venue_name: row.venue_name?.trim() || null,
        city: row.city?.trim() || null,
        address: row.address?.trim() || null,
        max_participants: row.max_participants,
        min_age: row.min_age,
        eligibility: row.eligibility?.trim() || null,
        rules: row.rules.map((r) => r.trim()).filter(Boolean),
        safety: row.safety?.trim() || null,
        warmup: row.warmup?.trim() || null,
        prize_summary: row.prize_summary?.trim() || null,
        entry_fee_label: row.entry_fee_label?.trim() || null,
        self_registration: row.self_registration,
        collect: row.collect,
        acknowledgments: row.acknowledgments.map((a) => a.trim()).filter(Boolean),
        cover_path: row.cover_path,
      };
      let id = existing?.id;
      if (editing) {
        if (slugLocked) delete (payload as Partial<typeof payload>).slug;
        const { error: e } = await db.from("challenges").update(payload).eq("id", id);
        if (e) throw e;
      } else {
        const { data, error: e } = await db
          .from("challenges")
          .insert(payload)
          .select("id")
          .single();
        if (e) throw e;
        id = data.id as string;
        if (firstPrize.trim()) {
          await db
            .from("challenge_prizes")
            .insert({ challenge_id: id, place: 1, title: firstPrize.trim() });
        }
      }
      // divisions: update kept ones, add new ones, remove dropped ones
      const keep = divisions.filter((d) => d.id).map((d) => d.id!);
      if (editing) {
        const { data: current } = await db
          .from("challenge_divisions")
          .select("id")
          .eq("challenge_id", id);
        const drop = ((current ?? []) as { id: string }[])
          .map((d) => d.id)
          .filter((x) => !keep.includes(x));
        if (drop.length) await db.from("challenge_divisions").delete().in("id", drop);
      }
      for (const [i, d] of divisions.entries()) {
        const rec = {
          challenge_id: id,
          name: d.name.trim(),
          load_label: d.load_label.trim() || null,
          sort: i,
        };
        if (d.id) await db.from("challenge_divisions").update(rec).eq("id", d.id);
        else await db.from("challenge_divisions").insert(rec);
      }
      invalidateChallenge(qc);
      toast.success(editing ? "Saved" : "Challenge created as a draft");
      if (editing) onSaved?.();
      else navigate({ to: "/admin/challenges/$id", params: { id: id! } });
    } catch (e) {
      const msg = errorText(e);
      setError(/duplicate key.*slug/i.test(msg) ? "That link is taken. Change it a little." : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1"
        role="tablist"
        aria-label="Builder steps"
      >
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={step === s}
            onClick={() => setStep(s)}
            className={cn(
              "h-10 shrink-0 rounded-full px-4 text-sm font-medium",
              step === s ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
            )}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {step === "Basics" ? (
          <>
            <F label="Title">
              <Input
                value={row.title}
                onChange={(e) => set("title", e.target.value)}
                className="h-12 text-base"
                maxLength={90}
                placeholder="Winnipeg 225 Bench Press Challenge"
              />
            </F>
            <F
              label="Link"
              hint={
                slugLocked
                  ? "Published links can't change (shared links would break)."
                  : `jfeffect.com/challenges/${row.slug || "…"}`
              }
            >
              <Input
                value={row.slug}
                disabled={slugLocked}
                onChange={(e) => {
                  setSlugTouched(true);
                  set(
                    "slug",
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                      .replace(/-+/g, "-"),
                  );
                }}
                className="h-11 font-mono"
                maxLength={60}
              />
            </F>
            <F label="One line under the title" hint="What it is in a sentence people repeat.">
              <Input
                value={row.tagline ?? ""}
                onChange={(e) => set("tagline", e.target.value)}
                className="h-11"
                maxLength={140}
                placeholder="225 lb. One set. As many clean reps as you've got."
              />
            </F>
            <F label="Activity">
              <ActivityPicker
                value={row.activity}
                exerciseId={row.exercise_id}
                onChange={(name, id) => setRow((r) => ({ ...r, activity: name, exercise_id: id }))}
              />
            </F>
            <F label="About (optional)">
              <Textarea
                value={row.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                maxLength={4000}
              />
            </F>
            <CoverField path={row.cover_path} onChange={(p) => set("cover_path", p)} />
          </>
        ) : null}

        {step === "Scoring" ? (
          <>
            <F label="What's measured">
              <Chips
                value={row.measure}
                options={[
                  ["reps", "Reps"],
                  ["weight", "Weight"],
                  ["time", "Time"],
                  ["distance", "Distance"],
                  ["points", "Points"],
                ]}
                onChange={(m) =>
                  setRow((r) => ({
                    ...r,
                    measure: m as Measure,
                    unit: unitsFor(m as Measure).includes(r.unit)
                      ? r.unit
                      : unitsFor(m as Measure)[0]!,
                    direction: defaultDirection(
                      m as Measure,
                      m === "time" ? r.direction : undefined,
                    ),
                    relative_to_bodyweight: m === "weight" ? r.relative_to_bodyweight : false,
                  }))
                }
              />
            </F>
            {unitsFor(row.measure).length > 1 ? (
              <F label="Unit">
                <Chips
                  value={row.unit}
                  options={unitsFor(row.measure).map((u) => [u, u])}
                  onChange={(u) => set("unit", u as Unit)}
                />
              </F>
            ) : null}
            <F label="Who wins">
              <Chips
                value={row.direction}
                options={
                  row.measure === "time"
                    ? [
                        ["lower", "Fastest time"],
                        ["higher", "Longest time"],
                      ]
                    : [
                        ["higher", "Highest"],
                        ["lower", "Lowest"],
                      ]
                }
                onChange={(d) => set("direction", d as Direction)}
              />
            </F>
            {row.measure === "weight" ? (
              <Toggle
                label="Score per bodyweight"
                hint="Best lift ÷ bodyweight. Everyone's weighed at check-in."
                checked={row.relative_to_bodyweight}
                onChange={(v) => set("relative_to_bodyweight", v)}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <F label="Scored attempts">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={row.attempts_allowed}
                  onChange={(e) =>
                    set(
                      "attempts_allowed",
                      Math.max(1, Math.min(10, Number(e.target.value.replace(/\D/g, "")) || 1)),
                    )
                  }
                  className="h-11"
                />
              </F>
              {row.attempts_allowed > 1 ? (
                <F label="Counts">
                  <Chips
                    value={row.aggregate}
                    options={[
                      ["best", "Best one"],
                      ["sum", "All added"],
                    ]}
                    onChange={(a) => set("aggregate", a as "best" | "sum")}
                  />
                </F>
              ) : null}
            </div>
            <F
              label="Fixed load (optional)"
              hint='Shown big, e.g. "225 lb". Leave empty when the load is what they choose.'
            >
              <Input
                value={row.load_label ?? ""}
                onChange={(e) => set("load_label", e.target.value)}
                className="h-11"
                maxLength={40}
              />
            </F>
            <F label="The goal in a few words">
              <Input
                value={row.objective ?? ""}
                onChange={(e) => set("objective", e.target.value)}
                className="h-11"
                maxLength={120}
                placeholder="Most valid reps in one continuous set"
              />
            </F>
            <F
              label="Ties"
              hint="Decided before anyone competes, and printed on the page. Order of entry never breaks a tie."
            >
              <Chips
                value={row.tiebreak}
                options={[
                  ["lighter", "Lighter athlete wins"],
                  ["runoff", "Run-off attempt"],
                  ["shared", "Share the place"],
                ]}
                onChange={(t) => set("tiebreak", t as Tiebreak)}
              />
              <p className="mt-2 text-xs text-muted-foreground">{tiebreakText(row)}</p>
            </F>
            <div className="rounded-xl bg-muted p-3 text-sm">
              {scoringText({ ...row, relative: row.relative_to_bodyweight })}
            </div>
          </>
        ) : null}

        {step === "When & where" ? (
          <>
            <DateTimeField
              label="Starts"
              value={row.starts_at}
              tz={row.timezone}
              onChange={(v) => set("starts_at", v)}
            />
            <DateTimeField
              label="Ends (optional)"
              value={row.ends_at}
              tz={row.timezone}
              onChange={(v) => set("ends_at", v)}
            />
            <F label="Time zone">
              <select
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
            <F label="Venue" hint="Required to publish.">
              <Input
                value={row.venue_name ?? ""}
                onChange={(e) => set("venue_name", e.target.value)}
                className="h-11"
                maxLength={120}
              />
            </F>
            <F label="City">
              <Input
                value={row.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
                className="h-11"
                maxLength={120}
              />
            </F>
            <F label="Address (optional)">
              <Input
                value={row.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                className="h-11"
                maxLength={200}
              />
            </F>
            <F label="Max athletes (optional)">
              <Input
                inputMode="numeric"
                value={row.max_participants ?? ""}
                onChange={(e) =>
                  set(
                    "max_participants",
                    e.target.value
                      ? Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)
                      : null,
                  )
                }
                className="h-11"
              />
            </F>
          </>
        ) : null}

        {step === "Rules & safety" ? (
          <>
            <ListEditor
              label="Rules"
              hint="Judging standards, one per line. Required to publish."
              items={row.rules}
              onChange={(v) => set("rules", v)}
              addLabel="Add a rule"
            />
            <F label="Who can enter">
              <Textarea
                value={row.eligibility ?? ""}
                onChange={(e) => set("eligibility", e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </F>
            <F label="Minimum age">
              <Input
                inputMode="numeric"
                value={row.min_age}
                onChange={(e) =>
                  set(
                    "min_age",
                    Math.max(0, Math.min(99, Number(e.target.value.replace(/\D/g, "")) || 0)),
                  )
                }
                className="h-11 w-28"
              />
            </F>
            <F label="Safety plan">
              <Textarea
                value={row.safety ?? ""}
                onChange={(e) => set("safety", e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Spotters, safeties, who can stop a set…"
              />
            </F>
            <F label="Warm-up">
              <Textarea
                value={row.warmup ?? ""}
                onChange={(e) => set("warmup", e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </F>
            <ListEditor
              label="What every entrant confirms"
              hint="Each is a separate tick box at sign-up and saved with the entry."
              items={row.acknowledgments}
              onChange={(v) => set("acknowledgments", v)}
              addLabel="Add a confirmation"
            />
          </>
        ) : null}

        {step === "Sign-up" ? (
          <>
            <Toggle
              label="People can sign themselves up"
              hint="From the page or the QR code. Staff can always register people."
              checked={row.self_registration}
              onChange={(v) => set("self_registration", v)}
            />
            <F label="Phone">
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
            <F label="Instagram">
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
            <DivisionsEditor divisions={divisions} onChange={setDivisions} />
            <F label="Entry fee label">
              <Input
                value={row.entry_fee_label ?? ""}
                onChange={(e) => set("entry_fee_label", e.target.value)}
                className="h-11"
                maxLength={40}
                placeholder="Free"
              />
            </F>
            <F
              label="Prize in a few words"
              hint='Shown on cards and the page, e.g. "$225 CAD + winner&apos;s trophy". Manage each prize in the Prizes tab.'
            >
              <Input
                value={row.prize_summary ?? ""}
                onChange={(e) => set("prize_summary", e.target.value)}
                className="h-11"
                maxLength={140}
              />
            </F>
            {!editing ? (
              <F label="First-place prize (optional)">
                <Input
                  value={firstPrize}
                  onChange={(e) => setFirstPrize(e.target.value)}
                  className="h-11"
                  maxLength={120}
                />
              </F>
            ) : null}
          </>
        ) : null}
      </div>

      {missing.length ? (
        <p className="mt-6 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          Before it can be published: {missing.join(", ")}.
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div
        className="sticky bottom-0 -mx-4 mt-6 flex gap-2 border-t border-border bg-background px-4 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button
          variant="outline"
          className="h-12"
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!)}
          aria-label="Previous step"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {stepIndex < STEPS.length - 1 ? (
          <Button
            variant="outline"
            className="h-12 flex-1"
            onClick={() => setStep(STEPS[stepIndex + 1]!)}
          >
            Next: {STEPS[stepIndex + 1]} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : null}
        {editing || stepIndex === STEPS.length - 1 ? (
          <Button className="h-12 flex-1" disabled={saving} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            {editing ? "Save" : "Create draft"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StartFrom({
  onPreset,
  onCopied,
}: {
  onPreset: (p: ChallengePreset) => void;
  onCopied: (id: string) => void;
}) {
  const list = useQuery({ queryKey: ["challenges", "admin-list"], queryFn: fetchAdminList });
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const templates = (list.data ?? []).filter((c) => c.is_template);
  const past = (list.data ?? []).filter((c) => !c.is_template && !c.is_test);
  const copy = async (id: string) => {
    setBusy(id);
    try {
      const nid = await duplicateChallenge(id, false);
      invalidateChallenge(qc);
      toast.success("Copied as a new draft");
      onCopied(nid);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-base font-semibold">What kind of challenge?</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Picks sensible scoring and rules. You can change all of it.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPreset(p)}
              className="rounded-2xl border border-border p-4 text-left hover:bg-muted"
            >
              <span className="block font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{p.hint}</span>
            </button>
          ))}
        </div>
      </section>
      {templates.length ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">Your templates</h2>
          <div className="grid gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!!busy}
                onClick={() => void copy(t.id)}
                className="flex items-center justify-between rounded-2xl border border-border p-4 text-left hover:bg-muted"
              >
                <span className="font-medium">{t.title}</span>
                {busy === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {past.length ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">Run one again</h2>
          <div className="grid gap-2">
            {past.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!!busy}
                onClick={() => void copy(t.id)}
                className="flex items-center justify-between rounded-2xl border border-border p-4 text-left hover:bg-muted"
              >
                <span>
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    Copies the setup, rules and prizes. Never entries or scores.
                  </span>
                </span>
                {busy === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Chips({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "min-h-10 rounded-full px-4 text-sm font-medium",
            value === v ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-border p-4">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function ListEditor({
  label,
  hint,
  items,
  onChange,
  addLabel,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (v: string[]) => void;
  addLabel: string;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <ol className="mt-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-3 w-5 shrink-0 text-right text-xs text-muted-foreground">
              {i + 1}.
            </span>
            <Textarea
              value={it}
              onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
              rows={1}
              className="min-h-11 flex-1"
            />
            <div className="flex flex-col">
              <button
                type="button"
                className="h-5 px-1 text-muted-foreground"
                onClick={() => move(i, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="h-5 px-1 text-muted-foreground"
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              className="mt-2.5 px-1 text-muted-foreground"
              onClick={() => onChange(items.filter((_, k) => k !== i))}
              aria-label="Remove"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => onChange([...items, ""])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

function DivisionsEditor({
  divisions,
  onChange,
}: {
  divisions: DivisionDraft[];
  onChange: (v: DivisionDraft[]) => void;
}) {
  return (
    <div>
      <Label className="text-sm font-medium">Divisions (optional)</Label>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Give a division its own load (e.g. Women · 135 lb) and it gets its own board and its own
        places.
      </p>
      <div className="mt-2 space-y-2">
        {divisions.map((d, i) => (
          <div key={d.id ?? i} className="flex gap-2">
            <Input
              value={d.name}
              onChange={(e) =>
                onChange(divisions.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))
              }
              placeholder="Name"
              className="h-11 flex-1"
              maxLength={40}
            />
            <Input
              value={d.load_label}
              onChange={(e) =>
                onChange(
                  divisions.map((x, k) => (k === i ? { ...x, load_label: e.target.value } : x)),
                )
              }
              placeholder="Own load (optional)"
              className="h-11 w-40"
              maxLength={40}
            />
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2"
              onClick={() => onChange(divisions.filter((_, k) => k !== i))}
              aria-label="Remove division"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10"
        onClick={() => onChange([...divisions, { name: "", load_label: "" }])}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add a division
      </Button>
    </div>
  );
}

function DateTimeField({
  label,
  value,
  tz,
  onChange,
}: {
  label: string;
  value: string | null;
  tz: string;
  onChange: (v: string | null) => void;
}) {
  const d = value ? new Date(value) : null;
  const [date, setDate] = useState(d ? localDateISO(d, tz) : "");
  const [time, setTime] = useState(d ? localTimeHM(d, tz) : "");
  useEffect(() => {
    if (date && time) onChange(wallTimeToUtc(date, time, tz).toISOString());
    else if (!date) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, tz]);
  return (
    <F label={label}>
      <div className="flex gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-11 flex-1"
        />
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-11 w-32"
        />
        {date ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-2"
            onClick={() => {
              setDate("");
              setTime("");
            }}
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </F>
  );
}

/** Type a name; the exercise library offers matches so the challenge links to the real exercise. */
function ActivityPicker({
  value,
  exerciseId,
  onChange,
}: {
  value: string;
  exerciseId: string | null;
  onChange: (name: string, id: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const term = text.trim();
  const matches = useQuery({
    queryKey: ["challenges", "exercise-search", term],
    queryFn: async () => {
      const { data } = await db
        .from("exercises")
        .select("id,name")
        .ilike("name", `%${term}%`)
        .eq("archived", false)
        .order("name")
        .limit(6);
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: focus && term.length >= 3,
    staleTime: 60_000,
  });
  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value, null);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        className="h-11"
        maxLength={80}
      />
      {exerciseId ? (
        <p className="mt-1 text-xs text-success">Linked to the exercise library</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Pick from the library when it's there, or keep a custom name.
        </p>
      )}
      {focus && matches.data?.length ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-sm">
          {matches.data.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(m.name);
                  onChange(m.name, m.id);
                  setFocus(false);
                }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CoverField({
  path,
  onChange,
}: {
  path: string | null;
  onChange: (p: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => mediaUrl(path), [path]);
  return (
    <F
      label="Event artwork (optional)"
      hint="16:9 works best. Without one, the page uses clean type."
    >
      {url ? (
        <div className="relative overflow-hidden rounded-2xl">
          <img src={url} alt="" className="aspect-[16/9] w-full object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute right-2 top-2"
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <label className="flex h-28 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{" "}
          Upload artwork
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 5 * 1024 * 1024) return toast.error("Keep artwork under 5 MB.");
              setBusy(true);
              try {
                const ext =
                  f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
                const p = `covers/${crypto.randomUUID()}.${ext}`;
                const { error } = await supabase.storage
                  .from(MEDIA_BUCKET)
                  .upload(p, f, { contentType: f.type, cacheControl: "31536000" });
                if (error) throw error;
                onChange(p);
              } catch (err) {
                toast.error(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
    </F>
  );
}
