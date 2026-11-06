import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { errorText, mediaUrl, uploadChallengeImage } from "@/lib/challenges/api";
import { coverJpeg } from "@/lib/challenges/photo";
import { TIEBREAK_OPTIONS, isoToWall, objectiveText, wallToIso } from "@/lib/challenges/format";
import { UNITS_FOR, defaultDirection } from "@/lib/challenges/presets";
import type { ChallengeRow, Division, FieldMode, Metric, Unit } from "@/lib/challenges/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const METRICS: { value: Metric; label: string }[] = [
  { value: "reps", label: "Reps" },
  { value: "weight", label: "Weight" },
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
  { value: "points", label: "Points / calories" },
];

const ZONES = ["America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Toronto", "America/Halifax", "America/Chicago", "America/New_York", "America/Los_Angeles"];

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      </div>
      {children}
    </section>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-50",
            value === o.value ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ListEditor({ items, onChange, placeholder, addLabel }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; addLabel: string }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-3 w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
          <Textarea value={it} rows={1} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className="min-h-11 flex-1 text-base" placeholder={placeholder} />
          <div className="flex flex-col">
            <button type="button" disabled={i === 0} onClick={() => onChange(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} className="flex h-6 w-8 items-center justify-center disabled:opacity-30" aria-label="Move up">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" disabled={i === items.length - 1} onClick={() => onChange(items.map((x, j) => (j === i + 1 ? items[i] : j === i ? items[i + 1] : x)))} className="flex h-6 w-8 items-center justify-center disabled:opacity-30" aria-label="Move down">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Remove">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

function DivisionsEditor({ challengeId, divisions, locked }: { challengeId: string; divisions: Division[]; locked: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["challenges"] });
  async function add() {
    if (!name.trim()) return;
    const { error } = await db.from("challenge_divisions").insert({ challenge_id: challengeId, name: name.trim(), sort: divisions.length });
    if (error) return toast.error(errorText(error));
    setName("");
    refresh();
  }
  async function rename(d: Division, v: string) {
    if (!v.trim() || v === d.name) return;
    const { error } = await db.from("challenge_divisions").update({ name: v.trim() }).eq("id", d.id);
    if (error) toast.error(errorText(error));
    refresh();
  }
  async function remove(d: Division) {
    if (!confirm(`Remove the ${d.name} division? Anyone in it moves to no division.`)) return;
    const { error } = await db.from("challenge_divisions").delete().eq("id", d.id);
    if (error) toast.error(errorText(error));
    refresh();
  }
  return (
    <div className="space-y-2">
      {divisions.map((d) => (
        <div key={d.id} className="flex gap-2">
          <Input defaultValue={d.name} onBlur={(e) => rename(d, e.target.value)} className="h-11 text-base" />
          <button type="button" disabled={locked && divisions.length <= 1} onClick={() => remove(d)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border disabled:opacity-40" aria-label={`Remove ${d.name}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="e.g. Women, Men, Masters 40+" className="h-11 text-base" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <Button type="button" variant="outline" className="h-11" onClick={add}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">One division means one leaderboard. With more, everyone picks one and each gets its own ranking.</p>
    </div>
  );
}

type Draft = Omit<ChallengeRow, "rules" | "acknowledgments"> & { rules: string[]; acknowledgments: string[]; startsWall: string; endsWall: string; closesWall: string };

export function SetupTab({ row, divisions, hasAttempts }: { row: ChallengeRow; divisions: Division[]; hasAttempts: boolean }) {
  const qc = useQueryClient();
  const toDraft = (r: ChallengeRow): Draft => ({
    ...r,
    rules: [...(r.rules ?? [])],
    acknowledgments: [...(r.acknowledgments ?? [])],
    startsWall: isoToWall(r.starts_at, r.timezone),
    endsWall: isoToWall(r.ends_at, r.timezone),
    closesWall: isoToWall(r.registration_closes_at, r.timezone),
  });
  const [d, setD] = useState<Draft>(() => toDraft(row));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => setD(toDraft(row)), [row.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoringLocked = hasAttempts || ["live", "paused", "verifying", "completed", "archived"].includes(row.status);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty = useMemo(() => JSON.stringify(toDraft(row)) !== JSON.stringify(d), [row, d]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        title: d.title.trim(),
        tagline: d.tagline?.trim() || null,
        description: d.description?.trim() || null,
        objective: d.objective?.trim() || null,
        equipment: d.equipment?.trim() || null,
        judging_standard: d.judging_standard?.trim() || null,
        rules: d.rules.map((r) => r.trim()).filter(Boolean),
        eligibility: d.eligibility?.trim() || null,
        safety: d.safety?.trim() || null,
        how_it_works: d.how_it_works?.trim() || null,
        acknowledgments: d.acknowledgments.map((r) => r.trim()).filter(Boolean),
        min_age: d.min_age,
        reg_fields: d.reg_fields,
        tiebreak_note: d.tiebreak_note?.trim() || null,
        timezone: d.timezone,
        starts_at: d.startsWall ? wallToIso(d.startsWall, d.timezone) : null,
        ends_at: d.endsWall ? wallToIso(d.endsWall, d.timezone) : null,
        registration_closes_at: d.closesWall ? wallToIso(d.closesWall, d.timezone) : null,
        location_name: d.location_name?.trim() || null,
        location_address: d.location_address?.trim() || null,
        city: d.city?.trim() || null,
        max_participants: d.max_participants || null,
        entry_fee: d.entry_fee?.trim() || "Free",
        self_registration: d.self_registration,
        registration_open: d.registration_open,
        cover_path: d.cover_path,
      };
      if (!scoringLocked) {
        Object.assign(patch, {
          activity: d.activity.trim(),
          metric: d.metric,
          unit: d.unit,
          direction: d.direction,
          scoring: d.scoring,
          attempts_allowed: d.attempts_allowed,
          load_value: d.load_value || null,
          load_unit: d.load_value ? d.load_unit ?? "lb" : null,
          time_cap_seconds: d.time_cap_seconds || null,
          tiebreak: d.tiebreak,
        });
      }
      if (row.status === "draft" && d.slug !== row.slug) patch.slug = d.slug;
      const { error } = await db.from("challenges").update(patch).eq("id", row.id);
      if (error) throw error;
      toast.success("Saved");
      await qc.invalidateQueries({ queryKey: ["challenges"] });
    } catch (e) {
      const m = errorText(e);
      toast.error(/challenges_dates_ok/.test(m) ? "The end has to be after the start." : /slug/.test(m) ? "That web address is taken or isn't valid." : m);
    } finally {
      setSaving(false);
    }
  }

  async function pickCover(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadChallengeImage(row.id, await coverJpeg(file));
      set("cover_path", path);
      toast.success("Cover ready. Save to use it.");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  const units = UNITS_FOR[d.metric];

  return (
    <div className="space-y-4">
      <Card title="The basics">
        <F label="Name">
          <Input value={d.title} onChange={(e) => set("title", e.target.value.slice(0, 90))} className="h-11 text-base" />
        </F>
        <F label="Web address" hint={row.status === "draft" ? "can change until published" : "fixed once published"}>
          <div className="flex items-center rounded-lg border border-border pl-3">
            <span className="shrink-0 text-sm text-muted-foreground">/challenges/</span>
            <Input value={d.slug} disabled={row.status !== "draft"} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="h-11 border-0 pl-0.5 text-base shadow-none focus-visible:ring-0" />
          </div>
        </F>
        <F label="One line under the name" hint="optional">
          <Input value={d.tagline ?? ""} onChange={(e) => set("tagline", e.target.value.slice(0, 140))} className="h-11 text-base" placeholder="How many clean reps can you get with 225?" />
        </F>
        <F label="About it" hint="optional">
          <Textarea value={d.description ?? ""} onChange={(e) => set("description", e.target.value.slice(0, 4000))} rows={3} className="text-base" />
        </F>
        <div className="space-y-2">
          <span className="block text-sm font-semibold">Cover image <span className="font-normal text-muted-foreground">16:9, shows on the page and link previews</span></span>
          {d.cover_path && <img src={mediaUrl(d.cover_path)!} alt="" className="w-full rounded-xl object-cover" style={{ aspectRatio: "16 / 9" }} />}
          <div className="flex gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {d.cover_path ? "Change" : "Add a cover"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickCover(e.target.files?.[0])} />
            </label>
            {d.cover_path && (
              <Button variant="outline" onClick={() => set("cover_path", null)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="What's measured"
        note={
          scoringLocked ? (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Lock className="h-3.5 w-3.5" /> Locked: the competition has started, so scoring and the tie-break can't change.
            </span>
          ) : (
            "Pick the activity and how it's scored. Locks when the challenge goes live."
          )
        }
      >
        <F label="Activity">
          <Input value={d.activity} disabled={scoringLocked} onChange={(e) => set("activity", e.target.value.slice(0, 80))} className="h-11 text-base" placeholder="e.g. Barbell Bench Press" />
        </F>
        <F label="Measured in">
          <Seg
            value={d.metric}
            disabled={scoringLocked}
            options={METRICS}
            onChange={(m) =>
              setD((x) => ({
                ...x,
                metric: m,
                unit: UNITS_FOR[m][0],
                direction: defaultDirection(m, x.activity),
                scoring: m !== "weight" && x.scoring === "bodyweight_ratio" ? "best" : x.scoring,
              }))
            }
          />
        </F>
        {units.length > 1 && (
          <F label="Unit">
            <Seg value={d.unit} disabled={scoringLocked} options={units.map((u) => ({ value: u, label: u }))} onChange={(u) => set("unit", u as Unit)} />
          </F>
        )}
        <F label="Who wins">
          <Seg
            value={d.direction}
            disabled={scoringLocked}
            options={
              d.metric === "time"
                ? [
                    { value: "lower", label: "Fastest time" },
                    { value: "higher", label: "Longest time" },
                  ]
                : [
                    { value: "higher", label: "Highest" },
                    { value: "lower", label: "Lowest" },
                  ]
            }
            onChange={(v) => set("direction", v)}
          />
        </F>
        <F label="Score">
          <Seg
            value={d.scoring}
            disabled={scoringLocked}
            options={[
              { value: "best", label: "Best attempt" },
              { value: "total", label: "Total of attempts" },
              ...(d.metric === "weight" ? [{ value: "bodyweight_ratio" as const, label: "Best ÷ bodyweight" }] : []),
            ]}
            onChange={(v) => set("scoring", v)}
          />
        </F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Attempts each">
            <Input type="number" inputMode="numeric" min={1} max={10} disabled={scoringLocked} value={d.attempts_allowed} onChange={(e) => set("attempts_allowed", Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-11 text-base" />
          </F>
          <F label="Time cap" hint="seconds, optional">
            <Input type="number" inputMode="numeric" disabled={scoringLocked} value={d.time_cap_seconds ?? ""} onChange={(e) => set("time_cap_seconds", e.target.value ? Number(e.target.value) : null)} className="h-11 text-base" />
          </F>
        </div>
        <F label="Set weight" hint="optional: the load everyone uses">
          <div className="flex gap-2">
            <Input inputMode="decimal" disabled={scoringLocked} value={d.load_value ?? ""} onChange={(e) => set("load_value", e.target.value ? Number(e.target.value) : null)} className="h-11 flex-1 text-base" placeholder="225" />
            <Seg value={(d.load_unit ?? "lb") as "lb" | "kg"} disabled={scoringLocked} options={[{ value: "lb", label: "lb" }, { value: "kg", label: "kg" }]} onChange={(v) => set("load_unit", v)} />
          </div>
        </F>
        <F label="How it wins, in one line" hint="shown at the top">
          <Input value={d.objective ?? ""} onChange={(e) => set("objective", e.target.value.slice(0, 300))} className="h-11 text-base" placeholder={objectiveText({ ...d, objective: null })} />
        </F>
      </Card>

      <Card title="Ties" note="Decided before the start and shown on the page. Submission time never breaks a tie.">
        <div className="space-y-2">
          {TIEBREAK_OPTIONS.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", d.tiebreak === o.value ? "border-foreground" : "border-border", scoringLocked && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="tiebreak" className="mt-1 h-4 w-4" disabled={scoringLocked} checked={d.tiebreak === o.value} onChange={() => set("tiebreak", o.value)} />
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        <F label="In your words" hint="optional, replaces the standard sentence">
          <Textarea value={d.tiebreak_note ?? ""} onChange={(e) => set("tiebreak_note", e.target.value.slice(0, 500))} rows={2} className="text-base" />
        </F>
      </Card>

      <Card title="Rules & judging">
        <ListEditor items={d.rules} onChange={(v) => set("rules", v)} placeholder="One rule" addLabel="Add a rule" />
        <F label="Judging standard" hint="what makes a rep or attempt count">
          <Textarea value={d.judging_standard ?? ""} onChange={(e) => set("judging_standard", e.target.value.slice(0, 2000))} rows={3} className="text-base" />
        </F>
        <F label="Equipment">
          <Textarea value={d.equipment ?? ""} onChange={(e) => set("equipment", e.target.value.slice(0, 1000))} rows={2} className="text-base" />
        </F>
      </Card>

      <Card title="Who can enter & safety">
        <div className="grid grid-cols-2 gap-3">
          <F label="Minimum age">
            <Input type="number" inputMode="numeric" value={d.min_age} onChange={(e) => set("min_age", Math.max(0, Math.min(99, Number(e.target.value) || 0)))} className="h-11 text-base" />
          </F>
          <F label="Entry">
            <Input value={d.entry_fee} onChange={(e) => set("entry_fee", e.target.value.slice(0, 60))} className="h-11 text-base" />
          </F>
        </div>
        <F label="Eligibility">
          <Textarea value={d.eligibility ?? ""} onChange={(e) => set("eligibility", e.target.value.slice(0, 2000))} rows={3} className="text-base" />
        </F>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">What people tick to enter</span>
          <ListEditor items={d.acknowledgments} onChange={(v) => set("acknowledgments", v)} placeholder="e.g. I'm 18 or older." addLabel="Add a tick box" />
          {row.status !== "draft" && <p className="text-xs text-muted-foreground">Changing these applies to people who sign up from now on.</p>}
        </div>
        <F label="Safety policy">
          <Textarea value={d.safety ?? ""} onChange={(e) => set("safety", e.target.value.slice(0, 4000))} rows={5} className="text-base" />
        </F>
        <F label="On the day" hint="arrival, warm-up, how it runs">
          <Textarea value={d.how_it_works ?? ""} onChange={(e) => set("how_it_works", e.target.value.slice(0, 4000))} rows={5} className="text-base" />
        </F>
      </Card>

      <Card title="When & where" note="A challenge can be published once it has a start and a venue.">
        <F label="Time zone">
          <select value={d.timezone} onChange={(e) => set("timezone", e.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base">
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace("America/", "").replace("_", " ")}
              </option>
            ))}
          </select>
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Starts">
            <Input type="datetime-local" value={d.startsWall} onChange={(e) => set("startsWall", e.target.value)} className="h-11 text-base" />
          </F>
          <F label="Ends" hint="scores close after this">
            <Input type="datetime-local" value={d.endsWall} onChange={(e) => set("endsWall", e.target.value)} className="h-11 text-base" />
          </F>
        </div>
        <F label="Venue">
          <Input value={d.location_name ?? ""} onChange={(e) => set("location_name", e.target.value.slice(0, 120))} className="h-11 text-base" placeholder="Gym name" />
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Address">
            <Input value={d.location_address ?? ""} onChange={(e) => set("location_address", e.target.value.slice(0, 200))} className="h-11 text-base" />
          </F>
          <F label="City">
            <Input value={d.city ?? ""} onChange={(e) => set("city", e.target.value.slice(0, 80))} className="h-11 text-base" />
          </F>
        </div>
      </Card>

      <Card title="Sign-ups">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold">People can sign themselves up</span>
            <span className="block text-xs text-muted-foreground">From the page or the QR code. Off: staff only.</span>
          </span>
          <Switch checked={d.self_registration} onCheckedChange={(v) => set("self_registration", v)} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="block text-sm font-semibold">Registration open</span>
          <Switch checked={d.registration_open} onCheckedChange={(v) => set("registration_open", v)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Max athletes" hint="optional">
            <Input type="number" inputMode="numeric" value={d.max_participants ?? ""} onChange={(e) => set("max_participants", e.target.value ? Number(e.target.value) : null)} className="h-11 text-base" />
          </F>
          <F label="Sign-ups close" hint="optional">
            <Input type="datetime-local" value={d.closesWall} onChange={(e) => set("closesWall", e.target.value)} className="h-11 text-base" />
          </F>
        </div>
        {(["phone", "instagram"] as const).map((k) => (
          <F key={k} label={k === "phone" ? "Ask for a phone number" : "Ask for Instagram"}>
            <Seg
              value={(d.reg_fields?.[k] ?? "optional") as FieldMode}
              options={[
                { value: "off", label: "Don't ask" },
                { value: "optional", label: "Optional" },
                { value: "required", label: "Required" },
              ]}
              onChange={(v) => set("reg_fields", { ...d.reg_fields, [k]: v })}
            />
          </F>
        ))}
      </Card>

      <Card title="Divisions">
        <DivisionsEditor challengeId={row.id} divisions={divisions} locked={scoringLocked} />
      </Card>

      <div className="sticky z-20 -mx-4 border-t border-border bg-background px-4 py-3 md:mx-0 md:rounded-2xl md:border" style={{ bottom: "var(--bottom-nav-clearance, 0px)" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
          <Button onClick={save} disabled={saving || !dirty} className="h-11 min-w-32">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
