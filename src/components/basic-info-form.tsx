import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { calcAge, cmToFtIn, ftInToCm } from "@/lib/basic-info";
import { todayLocalISO } from "@/lib/today";

const COUNTRIES = ["Canada", "United States", "United Kingdom", "Australia", "New Zealand", "Other"];

export type BasicInfoValues = {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  height_cm?: number | null;
  preferred_height_unit?: "imperial" | "metric";
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null; // maps to lifestyle_notes for client self-entry
  intake_lifts_known?: boolean | null;
  intake_lift_unit?: "kg" | "lb" | null;
  intake_squat_1rm?: number | null;
  intake_bench_1rm?: number | null;
  intake_deadlift_1rm?: number | null;
  intake_training_experience?: string | null;
  intake_followed_program?: string | null;
  intake_squat_5rm?: number | null;
  intake_bench_5rm?: number | null;
  intake_deadlift_5rm?: number | null;
  intake_injuries?: string | null;
};

export function BasicInfoForm({
  values,
  onChange,
  showOptional = true,
  emailReadOnly,
}: {
  values: BasicInfoValues;
  onChange: (patch: Partial<BasicInfoValues>) => void;
  showOptional?: boolean;
  emailReadOnly?: string;
}) {
  const unit = (values.preferred_height_unit ?? "imperial") as "imperial" | "metric";
  const ftIn = cmToFtIn(values.height_cm ?? null);
  const [ft, setFt] = useState<string>(ftIn ? String(ftIn.ft) : "");
  const [inch, setInch] = useState<string>(ftIn ? String(ftIn.inch) : "");
  const [cm, setCm] = useState<string>(values.height_cm != null ? String(Math.round(Number(values.height_cm))) : "");

  useEffect(() => {
    const v = cmToFtIn(values.height_cm ?? null);
    setFt(v ? String(v.ft) : "");
    setInch(v ? String(v.inch) : "");
    setCm(values.height_cm != null ? String(Math.round(Number(values.height_cm))) : "");
  }, [values.height_cm]);

  const updateImperial = (nextFt: string, nextIn: string) => {
    setFt(nextFt); setInch(nextIn);
    const f = Number(nextFt) || 0;
    const i = Number(nextIn) || 0;
    onChange({ height_cm: f || i ? ftInToCm(f, i) : null });
  };
  const updateMetric = (next: string) => {
    setCm(next);
    const n = Number(next);
    onChange({ height_cm: n > 0 ? n : null });
  };

  const age = calcAge(values.date_of_birth);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>First name *</Label>
          <Input value={values.first_name ?? ""} onChange={(e) => onChange({ first_name: e.target.value })} />
        </div>
        <div>
          <Label>Last name *</Label>
          <Input value={values.last_name ?? ""} onChange={(e) => onChange({ last_name: e.target.value })} />
        </div>
        {showOptional && (
          <div className="md:col-span-2">
            <Label>Preferred name <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={values.preferred_name ?? ""} onChange={(e) => onChange({ preferred_name: e.target.value })} placeholder="What should we call you?" />
          </div>
        )}
        {emailReadOnly !== undefined && (
          <div className="md:col-span-2">
            <Label>Email</Label>
            <Input value={emailReadOnly} disabled className="bg-secondary/40" />
            <p className="mt-1 text-[11px] text-muted-foreground">To update your email, contact Coach Jared.</p>
          </div>
        )}
        <div>
          <Label>Phone number *</Label>
          <Input value={values.phone ?? ""} onChange={(e) => onChange({ phone: e.target.value })} placeholder="(555) 123-4567" />
        </div>
        <div>
          <Label>Time zone *</Label>
          <Select value={values.timezone ?? "America/Winnipeg"} onValueChange={(v) => onChange({ timezone: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Date of birth *</Label>
          <Input type="date" value={values.date_of_birth ?? ""} onChange={(e) => onChange({ date_of_birth: e.target.value || null })} max={todayLocalISO()} />
          <p className="mt-1 text-[11px] text-muted-foreground">Age: {age != null ? `${age} (auto-calculated)` : "—"}</p>
        </div>
        <div>
          <div className="flex items-end justify-between">
            <Label>Height *</Label>
            <ToggleGroup
              type="single"
              value={unit}
              onValueChange={(v) => v && onChange({ preferred_height_unit: v as "imperial" | "metric" })}
              size="sm"
              className="border border-border rounded-md"
            >
              <ToggleGroupItem value="imperial" className="text-xs h-7 px-2">ft / in</ToggleGroupItem>
              <ToggleGroupItem value="metric" className="text-xs h-7 px-2">cm</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {unit === "imperial" ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input type="number" inputMode="numeric" min={0} max={8} value={ft} onChange={(e) => updateImperial(e.target.value, inch)} placeholder="ft" />
              </div>
              <div className="flex-1">
                <Input type="number" inputMode="numeric" min={0} max={11} value={inch} onChange={(e) => updateImperial(ft, e.target.value)} placeholder="in" />
              </div>
            </div>
          ) : (
            <Input type="number" inputMode="numeric" min={50} max={250} value={cm} onChange={(e) => updateMetric(e.target.value)} placeholder="cm" />
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Mailing address *</Label>
          <Input value={values.address ?? ""} onChange={(e) => onChange({ address: e.target.value })} placeholder="Street address" />
        </div>
        <div>
          <Label>City *</Label>
          <Input value={values.city ?? ""} onChange={(e) => onChange({ city: e.target.value })} />
        </div>
        <div>
          <Label>Province / State</Label>
          <Input value={values.province ?? ""} onChange={(e) => onChange({ province: e.target.value })} />
        </div>
        <div>
          <Label>Postal / ZIP code</Label>
          <Input value={values.postal_code ?? ""} onChange={(e) => onChange({ postal_code: e.target.value })} />
        </div>
        <div>
          <Label>Country *</Label>
          <Select value={values.country ?? ""} onValueChange={(v) => onChange({ country: v })}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Emergency contact *</div>
        <p className="text-[11px] text-muted-foreground">Required — someone we can reach if anything urgent happens during training.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Contact name *</Label>
            <Input value={values.emergency_contact_name ?? ""} onChange={(e) => onChange({ emergency_contact_name: e.target.value })} />
          </div>
          <div>
            <Label>Contact phone *</Label>
            <Input value={values.emergency_contact_phone ?? ""} onChange={(e) => onChange({ emergency_contact_phone: e.target.value })} placeholder="(555) 123-4567" />
          </div>
        </div>
      </div>

      <SbdIntakeSection values={values} onChange={onChange} />

      {showOptional && (
        <div>
          <Label>Anything else we should know? <span className="text-muted-foreground">(optional)</span></Label>
          <Textarea rows={3} value={values.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Allergies, medical conditions, schedule constraints, etc." />
        </div>
      )}
    </div>
  );
}

function SbdIntakeSection({
  values,
  onChange,
}: {
  values: BasicInfoValues;
  onChange: (patch: Partial<BasicInfoValues>) => void;
}) {
  const unit = (values.intake_lift_unit ?? "lb") as "kg" | "lb";
  const dontKnow = values.intake_lifts_known === false;

  const setNum = (k: keyof BasicInfoValues, raw: string) => {
    const n = Number(raw);
    onChange({ [k]: raw === "" ? null : (Number.isFinite(n) && n > 0 ? n : null) } as Partial<BasicInfoValues>);
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Best lifts (1-rep max) *</div>
          <p className="text-[11px] text-muted-foreground">Don't worry if these aren't exact. An estimate is perfectly fine.</p>
        </div>
        <ToggleGroup
          type="single"
          value={unit}
          onValueChange={(v) => v && onChange({ intake_lift_unit: v as "kg" | "lb" })}
          size="sm"
          className="border border-border rounded-md"
          disabled={dontKnow}
        >
          <ToggleGroupItem value="lb" className="text-xs h-7 px-2">lb</ToggleGroupItem>
          <ToggleGroupItem value="kg" className="text-xs h-7 px-2">kg</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {!dontKnow && (
      <div className="grid gap-3 sm:grid-cols-3">
        {(["squat", "bench", "deadlift"] as const).map((lift) => {
          const fieldMap = {
            squat: "intake_squat_1rm",
            bench: "intake_bench_1rm",
            deadlift: "intake_deadlift_1rm",
          } as const;
          const field = fieldMap[lift];
          const label = lift === "bench" ? "Bench press" : lift[0].toUpperCase() + lift.slice(1);
          const stored = values[field] as number | null | undefined;
          // Stored is in the unit the user selected; convert for display only if unit changed.
          const display = stored == null ? "" : String(stored);
          return (
            <div key={lift}>
              <Label className="text-xs">{label}</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={unit === "kg" ? 2.5 : 5}
                  value={display}
                  disabled={dontKnow}
                  onChange={(e) => setNum(field, e.target.value)}
                  placeholder=""
                />
                <span className="text-xs text-muted-foreground">{unit}</span>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {dontKnow && (
        <div className="space-y-3 rounded-md border border-dashed border-border bg-background/40 p-3">
          <p className="text-[11px] text-muted-foreground">
            No problem — answer a few quick questions and Coach Jared will estimate your starting numbers with you.
          </p>
          <div>
            <Label className="text-xs">How long have you been training?</Label>
            <Input
              value={values.intake_training_experience ?? ""}
              onChange={(e) => onChange({ intake_training_experience: e.target.value })}
              placeholder="e.g. 6 months, 2 years, never seriously"
            />
          </div>
          <div>
            <Label className="text-xs">Have you followed a structured program before?</Label>
            <Input
              value={values.intake_followed_program ?? ""}
              onChange={(e) => onChange({ intake_followed_program: e.target.value })}
              placeholder="e.g. Starting Strength, 5/3/1, no"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["squat", "bench", "deadlift"] as const).map((lift) => {
              const fieldMap = {
                squat: "intake_squat_5rm",
                bench: "intake_bench_5rm",
                deadlift: "intake_deadlift_5rm",
              } as const;
              const field = fieldMap[lift];
              const label =
                lift === "bench" ? "Bench press × 5" : (lift[0].toUpperCase() + lift.slice(1)) + " × 5";
              const stored = values[field] as number | null | undefined;
              return (
                <div key={lift}>
                  <Label className="text-xs">{label}</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={unit === "kg" ? 2.5 : 5}
                      value={stored == null ? "" : String(stored)}
                      onChange={(e) => setNum(field, e.target.value)}
                      placeholder=""
                    />
                    <span className="text-xs text-muted-foreground">{unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <Label className="text-xs">Any injuries or movement limitations?</Label>
            <Textarea
              rows={2}
              value={values.intake_injuries ?? ""}
              onChange={(e) => onChange({ intake_injuries: e.target.value })}
              placeholder="e.g. lower back tweak, sore right shoulder, none"
            />
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm pt-1">
        <Checkbox
          checked={dontKnow}
          onCheckedChange={(v) => {
            const known = !v;
            onChange({
              intake_lifts_known: known ? null : false,
              ...(known
                ? {}
                : {
                    intake_squat_1rm: null,
                    intake_bench_1rm: null,
                    intake_deadlift_1rm: null,
                  }),
            });
          }}
        />
        <span>I don't know my maxes yet — we'll estimate them together.</span>
      </label>
    </div>
  );
}