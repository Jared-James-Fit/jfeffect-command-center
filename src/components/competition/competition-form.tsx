/**
 * Adding or editing a competition: one sheet, short on purpose. What's already
 * on file comes prefilled (a meet prep's name, date, federation and class; the
 * competition profile's class); everything else is optional and the
 * Competition tab's missing-information list says what would sharpen the
 * strategy. The meet's rules start from its federation and stay unconfirmed
 * until the coach says they're right for this meet.
 */
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { OBJECTIVE_LABEL, type Objective } from "@/lib/competition/types";
import { rulesFor, type FederationRules } from "@/lib/competition/rules";

export type CompetitionFormValues = {
  name: string;
  meet_date: string;
  meet_end_date: string | null;
  federation: string | null;
  division: string | null;
  weight_class: string | null;
  location: string | null;
  level: string | null;
  objective: Objective | null;
  objective_note: string | null;
  target_total_kg: number | null;
  target_place: number | null;
  qualification_total_kg: number | null;
  records_note: string | null;
  registration: "registered" | "not_registered" | "unknown";
  lifting_start: string | null;
  weigh_in_at: string | null;
  flight: string | null;
  release_policy: "approve_all" | "auto_routine";
  rules: FederationRules;
};

const LEVELS = [
  ["international", "International"],
  ["national", "National"],
  ["regional", "Regional"],
  ["provincial", "Provincial"],
  ["local", "Local"],
] as const;

export function emptyCompetition(
  prefill: Partial<CompetitionFormValues> = {},
): CompetitionFormValues {
  return {
    name: "",
    meet_date: "",
    meet_end_date: null,
    federation: null,
    division: null,
    weight_class: null,
    location: null,
    level: null,
    objective: null,
    objective_note: null,
    target_total_kg: null,
    target_place: null,
    qualification_total_kg: null,
    records_note: null,
    registration: "unknown",
    lifting_start: null,
    weigh_in_at: null,
    flight: null,
    release_policy: "approve_all",
    rules: rulesFor(prefill.federation ?? null),
    ...prefill,
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const txt = (v: string) => (v.trim() === "" ? null : v.trim());

export function CompetitionForm({
  open,
  title,
  initial,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: CompetitionFormValues;
  saving: boolean;
  onSave: (v: CompetitionFormValues) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);
  const set = <K extends keyof CompetitionFormValues>(k: K, x: CompetitionFormValues[K]) =>
    setV((p) => ({ ...p, [k]: x }));
  const valid = v.name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(v.meet_date);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
        data-competition-form
      >
        <SheetHeader className="text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Only the name and date are needed. Cleo schedules the preparation from the date.
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSave(v);
          }}
        >
          <Field label="Meet">
            <Input
              value={v.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Western Canadian Championships"
              autoComplete="off"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={v.meet_date}
                onChange={(e) => set("meet_date", e.target.value)}
              />
            </Field>
            <Field label="Last day (multi-day)">
              <Input
                type="date"
                value={v.meet_end_date ?? ""}
                onChange={(e) => set("meet_end_date", e.target.value || null)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Federation">
              <Input
                value={v.federation ?? ""}
                onChange={(e) =>
                  setV((p) => ({
                    ...p,
                    federation: txt(e.target.value),
                    rules: p.rules.confirmed ? p.rules : rulesFor(txt(e.target.value)),
                  }))
                }
                placeholder="CPU, CanPL, USAPL…"
              />
            </Field>
            <Field label="Weight class">
              <Input
                value={v.weight_class ?? ""}
                onChange={(e) => set("weight_class", txt(e.target.value))}
                placeholder="83"
                inputMode="decimal"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level">
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
                value={v.level ?? ""}
                onChange={(e) => set("level", e.target.value || null)}
              >
                <option value="">From the name</option>
                {LEVELS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Objective">
              <select
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
                value={v.objective ?? ""}
                onChange={(e) => set("objective", (e.target.value || null) as Objective | null)}
              >
                <option value="">Not set</option>
                {(Object.entries(OBJECTIVE_LABEL) as [Objective, string][]).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Target total (kg)">
              <Input
                inputMode="decimal"
                value={v.target_total_kg ?? ""}
                onChange={(e) => set("target_total_kg", num(e.target.value))}
              />
            </Field>
            <Field label="Target place">
              <Input
                inputMode="numeric"
                value={v.target_place ?? ""}
                onChange={(e) => set("target_place", num(e.target.value))}
              />
            </Field>
            <Field label="Qualifying (kg)">
              <Input
                inputMode="decimal"
                value={v.qualification_total_kg ?? ""}
                onChange={(e) => set("qualification_total_kg", num(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Registered">
            <div className="inline-flex rounded-lg bg-secondary p-0.5 text-[13px]">
              {(["registered", "not_registered", "unknown"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set("registration", r)}
                  className={`rounded-md px-3 py-1.5 ${v.registration === r ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  {r === "registered" ? "Yes" : r === "not_registered" ? "Not yet" : "Don't know"}
                </button>
              ))}
            </div>
          </Field>

          <button
            type="button"
            className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMore((m) => !m)}
          >
            {more ? "Fewer details" : "More details: schedule, rules, release"}
          </button>
          {more ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Division">
                  <Input
                    value={v.division ?? ""}
                    onChange={(e) => set("division", txt(e.target.value))}
                    placeholder="Open, Junior…"
                  />
                </Field>
                <Field label="Venue">
                  <Input
                    value={v.location ?? ""}
                    onChange={(e) => set("location", txt(e.target.value))}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Weigh-in">
                  <Input
                    type="time"
                    value={v.weigh_in_at ?? ""}
                    onChange={(e) => set("weigh_in_at", e.target.value || null)}
                  />
                </Field>
                <Field label="Lifting starts">
                  <Input
                    type="time"
                    value={v.lifting_start ?? ""}
                    onChange={(e) => set("lifting_start", e.target.value || null)}
                  />
                </Field>
                <Field label="Flight">
                  <Input
                    value={v.flight ?? ""}
                    onChange={(e) => set("flight", txt(e.target.value))}
                    placeholder="B"
                  />
                </Field>
              </div>
              <Field label="Objective notes">
                <Textarea
                  rows={2}
                  value={v.objective_note ?? ""}
                  onChange={(e) => set("objective_note", txt(e.target.value))}
                  placeholder="What matters most at this meet"
                />
              </Field>
              <Field label="Records being chased">
                <Input
                  value={v.records_note ?? ""}
                  onChange={(e) => set("records_note", txt(e.target.value))}
                  placeholder="Provincial open deadlift 240 kg"
                />
              </Field>
              <div className="rounded-xl border border-border p-3" data-rules>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-medium">Meet rules</p>
                    <p className="text-[12px] text-muted-foreground">{v.rules.source}</p>
                  </div>
                  <label className="flex items-center gap-2 text-[13px]">
                    <Switch
                      checked={v.rules.confirmed}
                      onCheckedChange={(c) => set("rules", { ...v.rules, confirmed: c })}
                    />
                    Confirmed
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label="Increment (kg)">
                    <Input
                      inputMode="decimal"
                      value={v.rules.incrementKg}
                      onChange={(e) =>
                        set("rules", { ...v.rules, incrementKg: Number(e.target.value) || 2.5 })
                      }
                    />
                  </Field>
                  <Field label="Weigh-in (hours before)">
                    <Input
                      inputMode="numeric"
                      value={v.rules.weighInHours ?? ""}
                      onChange={(e) =>
                        set("rules", { ...v.rules, weighInHours: num(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Tie-break">
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-background px-2 text-[13px]"
                      value={v.rules.tieBreak}
                      onChange={(e) =>
                        set("rules", {
                          ...v.rules,
                          tieBreak: e.target.value as FederationRules["tieBreak"],
                        })
                      }
                    >
                      <option value="lighter_bodyweight">Lighter lifter</option>
                      <option value="lot_number">Lot number</option>
                      <option value="unknown">Not sure</option>
                    </select>
                  </Field>
                </div>
              </div>
              <label className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                <span>
                  <span className="block text-[14px] font-medium">
                    Send routine updates by themselves
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    Low-risk preparation updates go to the athlete as automated updates. The game
                    plan, its confirmation and the debrief always wait for you.
                  </span>
                </span>
                <Switch
                  checked={v.release_policy === "auto_routine"}
                  onCheckedChange={(c) => set("release_policy", c ? "auto_routine" : "approve_all")}
                />
              </label>
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={!valid} loading={saving}>
              Save
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
