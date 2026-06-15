import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getMySetupStatus, updateMyMemberProfile } from "@/lib/member-setup.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL_OPTIONS = [
  "Get stronger",
  "Lose fat",
  "Build muscle",
  "Get back in shape",
  "General fitness",
  "Powerlifting meet",
  "Bodybuilding",
  "Athletic performance",
] as const;

const EXPERIENCE_OPTIONS = [
  { value: "new", label: "New to lifting", hint: "< 6 months" },
  { value: "beginner", label: "Beginner", hint: "6 mo – 2 yrs" },
  { value: "intermediate", label: "Intermediate", hint: "2 – 5 yrs" },
  { value: "advanced", label: "Advanced", hint: "5+ yrs" },
] as const;

type Step = "photo" | "contact" | "basics" | "goals" | "schedule";
const STEPS: Step[] = ["photo", "contact", "basics", "goals", "schedule"];

import { WEEK_DAYS, SHORT_DAY } from "@/lib/training-schedule";

export function MemberSetupWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getMySetupStatus);
  const update = useServerFn(updateMyMemberProfile);
  const { data } = useQuery({ queryKey: ["m-setup-status"], queryFn: () => fetchStatus(), enabled: open });
  const m = data?.member as any;

  const [step, setStep] = useState<Step>("photo");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({});

  const value = (k: string) => form[k] ?? m?.[k] ?? "";
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const stepIdx = STEPS.indexOf(step);
  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  // ---------- Required-field validation per step ----------
  // The user cannot advance until every required field on the current step
  // is filled. SMS consent is strongly recommended but not strictly required.
  const v = (k: string) => {
    const raw = form[k] ?? m?.[k];
    return typeof raw === "string" ? raw.trim() : raw;
  };
  const phoneDigits = String(v("phone") ?? "").replace(/\D/g, "");
  const goalsTags: string[] = form.goals_tags ?? m?.goals_tags ?? [];
  const goalsText = String(form.goals ?? m?.goals ?? "").trim();
  const trainingDays: string[] = form.committed_training_days ?? m?.committed_training_days ?? [];
  const stepValidation: Record<Step, { ok: boolean; missing: string[] }> = {
    photo: (() => {
      const ok = !!v("avatar_url");
      return { ok, missing: ok ? [] : ["profile picture"] };
    })(),
    contact: (() => {
      const missing: string[] = [];
      if (phoneDigits.length < 7) missing.push("mobile phone");
      return { ok: missing.length === 0, missing };
    })(),
    basics: (() => {
      const required: [string, string][] = [
        ["date_of_birth", "date of birth"],
        ["address_line1", "street address"],
        ["address_city", "city"],
        ["address_state", "state / region"],
        ["address_zip", "ZIP / postal"],
        ["address_country", "country"],
        ["emergency_contact_name", "emergency contact name"],
        ["emergency_contact_phone", "emergency contact phone"],
      ];
      const missing = required.filter(([k]) => !v(k)).map(([, l]) => l);
      return { ok: missing.length === 0, missing };
    })(),
    goals: (() => {
      const missing: string[] = [];
      if (goalsTags.length === 0 && !goalsText) missing.push("a goal");
      if (!v("experience_level")) missing.push("lifting experience");
      if (!v("training_background")) missing.push("training background");
      return { ok: missing.length === 0, missing };
    })(),
    schedule: (() => {
      const missing: string[] = [];
      if (trainingDays.length === 0) missing.push("at least one training day");
      return { ok: missing.length === 0, missing };
    })(),
  };
  const canAdvance = stepValidation[step].ok;
  const missingLabel = stepValidation[step].missing.join(", ");

  const saveStep = async (next?: Step) => {
    if (!stepValidation[step].ok) {
      toast.error(`Please fill: ${stepValidation[step].missing.join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      const patch: any = {};
      if (step === "photo" && form.avatar_url) patch.avatar_url = form.avatar_url;
      if (step === "contact") {
        if (form.phone !== undefined) patch.phone = form.phone;
        patch.sms_consent = form.sms_consent !== false;
      }
      if (step === "basics") {
        for (const k of ["date_of_birth", "address_line1", "address_city", "address_state", "address_zip", "address_country", "emergency_contact_name", "emergency_contact_phone"]) {
          if (form[k] !== undefined) patch[k] = form[k];
        }
      }
      if (step === "goals") {
        if (form.goals_tags !== undefined) patch.goals_tags = form.goals_tags;
        if (form.goals !== undefined) patch.goals = form.goals;
        if (form.experience_level !== undefined) patch.experience_level = form.experience_level;
        if (form.training_background !== undefined) patch.training_background = form.training_background;
      }
      if (step === "schedule") {
        if (form.committed_training_days !== undefined) {
          patch.committed_training_days = form.committed_training_days;
          patch.committed_training_frequency = form.committed_training_days.length;
        }
      }
      if (Object.keys(patch).length) {
        const r = await update({ data: patch });
        await qc.invalidateQueries({ queryKey: ["m-setup-status"] });
        await qc.invalidateQueries({ queryKey: ["current-member-access"] });
        if (next === undefined) {
          if (r.setupComplete) {
            toast.success("Setup complete! Welcome.");
            onClose();
            return;
          }
          toast.success("Saved");
          return;
        }
      }
      if (next) setStep(next);
      else onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Finish setting up your membership</DialogTitle>
          <DialogDescription>
            We need a few details before you get full access — same as our coaching clients.
          </DialogDescription>
        </DialogHeader>
        <Progress value={progress} className="h-1.5" />
        <div className="mt-2 text-xs text-muted-foreground">Step {stepIdx + 1} of {STEPS.length}</div>

        {step === "photo" && (
          <div className="space-y-3">
            <Label>Profile picture <span className="text-destructive">*</span></Label>
            {user?.id && (
              <ProfilePictureCapture
                userId={user.id}
                currentUrl={value("avatar_url") || null}
                allowFileUpload
                mode="client"
                onUploaded={(url) => set("avatar_url", url)}
              />
            )}
            <p className="text-xs text-muted-foreground">Required. Helps our team recognize you when you message support.</p>
          </div>
        )}

        {step === "contact" && (
          <div className="space-y-3">
            <div>
              <Label>Mobile phone <span className="text-destructive">*</span></Label>
              <Input
                inputMode="tel"
                placeholder="+1 555 123 4567"
                value={value("phone")}
                onChange={(e) => set("phone", e.target.value)}
                required
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Required — used for billing alerts and account recovery.</p>
            </div>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={form.sms_consent ?? true}
                  onCheckedChange={(v) => set("sms_consent", !!v)}
                />
                <span>
                  <span className="font-semibold">Yes, send me important SMS updates</span> about my
                  membership, billing, and account security.{" "}
                  <span className="font-semibold text-primary">Strongly recommended.</span>
                </span>
              </label>
              <p className="mt-2 pl-6 text-[11px] leading-relaxed text-muted-foreground">
                No spam. No marketing junk. We only text for things that actually matter — failed
                payments, schedule changes, and security alerts. Reply <span className="font-mono">STOP</span> anytime to opt out.
              </p>
            </div>
          </div>
        )}

        {step === "basics" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Date of birth <span className="text-destructive">*</span></Label>
              <Input type="date" value={value("date_of_birth") || ""} onChange={(e) => set("date_of_birth", e.target.value || null)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Street address <span className="text-destructive">*</span></Label>
              <Input value={value("address_line1")} onChange={(e) => set("address_line1", e.target.value)} />
            </div>
            <div>
              <Label>City <span className="text-destructive">*</span></Label>
              <Input value={value("address_city")} onChange={(e) => set("address_city", e.target.value)} />
            </div>
            <div>
              <Label>State / Region <span className="text-destructive">*</span></Label>
              <Input value={value("address_state")} onChange={(e) => set("address_state", e.target.value)} />
            </div>
            <div>
              <Label>ZIP / Postal <span className="text-destructive">*</span></Label>
              <Input value={value("address_zip")} onChange={(e) => set("address_zip", e.target.value)} />
            </div>
            <div>
              <Label>Country <span className="text-destructive">*</span></Label>
              <Input value={value("address_country")} onChange={(e) => set("address_country", e.target.value)} />
            </div>
            <div>
              <Label>Emergency contact name <span className="text-destructive">*</span></Label>
              <Input value={value("emergency_contact_name")} onChange={(e) => set("emergency_contact_name", e.target.value)} />
            </div>
            <div>
              <Label>Emergency contact phone <span className="text-destructive">*</span></Label>
              <Input inputMode="tel" value={value("emergency_contact_phone")} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
            </div>
          </div>
        )}

        {step === "goals" && (
          <GoalsStep form={form} setForm={setForm} member={m} />
        )}

        {step === "schedule" && (
          <div className="space-y-3">
            <div>
              <Label>
                Which days will you train? <span className="text-destructive">*</span>
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick the days you commit to training each week. We use this to build your workout library and schedule. You can update it anytime in Account Settings.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {WEEK_DAYS.map((d) => {
                const on = trainingDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const cur = trainingDays;
                      const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                      set("committed_training_days", next);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-medium transition",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 hover:bg-secondary",
                    )}
                  >
                    {SHORT_DAY[d]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Selected: <span className="font-semibold text-foreground">{trainingDays.length}</span> day{trainingDays.length === 1 ? "" : "s"} per week
            </p>
          </div>
        )}

        {!canAdvance && (
          <p className="text-[11px] font-medium text-destructive">
            Required to continue: {missingLabel}
          </p>
        )}

        <DialogFooter className="mt-2 flex-row justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || stepIdx === 0}
            onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)])}
          >
            Back
          </Button>
          <div className="flex gap-2">
            {stepIdx < STEPS.length - 1 ? (
              <Button disabled={busy || !canAdvance} onClick={() => saveStep(STEPS[stepIdx + 1])}>
                Save & continue
              </Button>
            ) : (
              <Button disabled={busy || !canAdvance} onClick={() => saveStep()}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Finish setup
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalsStep({
  form,
  setForm,
  member,
}: {
  form: any;
  setForm: (updater: any) => void;
  member: any;
}) {
  const selected: string[] = form.goals_tags ?? member?.goals_tags ?? [];
  const level: string = form.experience_level ?? member?.experience_level ?? "";
  const toggle = (g: string) =>
    setForm((f: any) => {
      const cur: string[] = f.goals_tags ?? member?.goals_tags ?? [];
      const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
      return { ...f, goals_tags: next };
    });
  const showOther = form.goals !== undefined || !!member?.goals;

  return (
    <div className="space-y-4">
      <div>
        <Label>What are you focused on? (pick any)</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((g) => {
            const on = selected.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggle(g)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary/40 hover:bg-secondary",
                )}
              >
                {g}
              </button>
            );
          })}
        </div>
        {!showOther ? (
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground underline"
            onClick={() => setForm((f: any) => ({ ...f, goals: "" }))}
          >
            + Add something specific
          </button>
        ) : (
          <Textarea
            rows={2}
            className="mt-2"
            placeholder="Anything specific we should know?"
            value={form.goals ?? member?.goals ?? ""}
            onChange={(e) => setForm((f: any) => ({ ...f, goals: e.target.value }))}
          />
        )}
      </div>

      <div>
        <Label>Lifting experience</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EXPERIENCE_OPTIONS.map((opt) => {
            const on = level === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((f: any) => ({ ...f, experience_level: opt.value }))}
                className={cn(
                  "rounded-md border p-3 text-left text-sm transition",
                  on
                    ? "border-primary bg-primary/10"
                    : "border-border bg-secondary/40 hover:bg-secondary",
                )}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Training background <span className="text-destructive">*</span></Label>
        <Textarea
          rows={3}
          className="mt-2"
          placeholder="A few sentences about your training history, recent programs, injuries, etc."
          value={form.training_background ?? member?.training_background ?? ""}
          onChange={(e) => setForm((f: any) => ({ ...f, training_background: e.target.value }))}
        />
      </div>
    </div>
  );
}