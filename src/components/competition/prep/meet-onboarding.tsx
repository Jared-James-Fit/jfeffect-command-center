/**
 * The athlete's meet onboarding (Nov 26 2026): one short step at a time, only
 * the steps that apply (`stepsFor`: a powerlifting meet asks lifts and
 * warm-ups, another sport doesn't; travel's follow-ups only when they're
 * travelling; the handling terms only when they're handled), every answer
 * already on file filled in, each step saved when they tap Next so nothing is
 * lost if they leave. Opened again any time from "Update my meet details": a
 * change that matters reaches the coach (`infoChanges`), and a time the coach
 * confirmed comes back to him as a proposed change, never overwriting it.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  acceptMyTermsFn,
  myHandlingPayUrlFn,
  saveMyMeetInfoFn,
} from "@/lib/competition/handling.functions";
import {
  fromKg,
  GEAR_OPTIONS,
  readNumber,
  STEP_LABEL,
  toKg,
  travelFollowUps,
  type AthleteInfo,
  type InfoUnit,
  type StepKey,
} from "@/lib/competition/athlete-info";
import { priceText } from "@/lib/competition/handling";
import { goToPayment } from "@/lib/native-purchases";

const LIFTS = ["squat", "bench", "deadlift"] as const;
const LIFT_WORD = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;

type Ev = {
  federation: string;
  location: string;
  weight_class: string;
  division: string;
  weigh_in_at: string;
  lifting_start: string;
  flight: string;
  flights_in_session: string;
  lifters_per_flight: string;
};

export function MeetOnboarding({
  meet,
  previewing,
  onDone,
  onClose,
}: {
  meet: any;
  previewing: boolean;
  onDone: () => void;
  onClose?: () => void;
}) {
  const save = useServerFn(saveMyMeetInfoFn);
  const accept = useServerFn(acceptMyTermsFn);
  const payUrl = useServerFn(myHandlingPayUrlFn);
  const steps = meet.steps as StepKey[];
  const firstOpen = Math.max(
    0,
    steps.findIndex((s) => !meet.info?.steps?.[s]),
  );
  const [i, setI] = useState(meet.infoComplete ? 0 : firstOpen);
  const [info, setInfo] = useState<AthleteInfo>(() => ({ unit: "kg", ...(meet.info ?? {}) }));
  const c = meet.competition ?? {};
  const [ev, setEv] = useState<Ev>(() => ({
    federation: c.federation ?? "",
    location: c.location ?? "",
    weight_class: c.weight_class ?? "",
    division: c.division ?? "",
    weigh_in_at: c.weigh_in_at ?? "",
    lifting_start: c.lifting_start ?? "",
    flight: c.flight ?? "",
    flights_in_session: c.flights_in_session != null ? String(c.flights_in_session) : "",
    lifters_per_flight: c.lifters_per_flight != null ? String(c.lifters_per_flight) : "",
  }));
  const [official, setOfficial] = useState<boolean>(!!info.officialTimes);
  const [termsOk, setTermsOk] = useState(!!meet.handling?.termsAcceptedAt);
  const step = steps[i];
  const last = i === steps.length - 1;
  const unit: InfoUnit = info.unit === "lb" ? "lb" : "kg";

  const run = useMutation({
    mutationFn: async () => {
      if (previewing) return { ok: true };
      if (step === "confirm" && meet.handling && !meet.handling.termsAcceptedAt) {
        if (!termsOk) throw new Error("Tick that you agree to carry on");
        await accept({ data: { competitionId: c.id, text: meet.terms.text } });
      }
      return save({
        data: {
          competitionId: c.id,
          step,
          info: { ...info, officialTimes: official } as any,
          event: step === "event" || step === "body" ? eventPatch(ev, step) : null,
          officialTimes: step === "event" ? official : null,
          finish: last,
        },
      });
    },
    onSuccess: (r: any) => {
      if (last) {
        toast.success(
          r?.changes ? "Saved. Your handler can see what changed." : "Saved. Your handler has everything.",
        );
        onDone();
      } else setI(i + 1);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const pay = useMutation({
    mutationFn: () => payUrl({ data: { competitionId: c.id } }),
    onSuccess: (r) => {
      if (r.url) goToPayment(r.url);
      else toast.message("There's nothing to pay here");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't open payment"),
  });

  const set = <K extends keyof AthleteInfo>(k: K, v: AthleteInfo[K]) => setInfo((p) => ({ ...p, [k]: v }));
  const kgBox = (v: number | null | undefined) => (v == null ? "" : String(fromKg(v, unit)));
  const fromBox = (s: string, lo = 20, hi = 1200): number | null => {
    const n = readNumber(s, lo, hi);
    return n == null ? null : toKg(n, unit);
  };
  const trioSet = (k: "bests" | "recent" | "targets", l: (typeof LIFTS)[number], s: string) =>
    setInfo((p) => ({ ...p, [k]: { ...(p[k] ?? {}), [l]: fromBox(s) } }));
  const follow = useMemo(() => travelFollowUps(info), [info]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-meet-onboarding>
      <div className="mb-3 flex items-center gap-2">
        {i > 0 ? (
          <button type="button" onClick={() => setI(i - 1)} className="-ml-1 rounded-full p-1.5 hover:bg-muted" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted-foreground">
            Step {i + 1} of {steps.length}
          </p>
          <h3 className="text-[17px] font-semibold">{STEP_LABEL[step]}</h3>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      <div className="mb-4 flex gap-1" aria-hidden>
        {steps.map((s, k) => (
          <span key={s} className={cn("h-1 flex-1 rounded-full", k <= i ? "bg-foreground" : "bg-muted")} />
        ))}
      </div>

      <div className="space-y-3" key={`${step}:${unit}`}>
        {step === "event" ? (
          <>
            <p className="text-[13.5px] text-muted-foreground">
              {c.name} · fill in what you know. Leave a time blank if it isn't out yet.
            </p>
            <Field label="Federation">
              <Input value={ev.federation} onChange={(e) => setEv({ ...ev, federation: e.target.value })} placeholder="e.g. CPU" />
            </Field>
            <Field label="Venue">
              <Input value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Weigh-in">
                <Input type="time" value={ev.weigh_in_at} onChange={(e) => setEv({ ...ev, weigh_in_at: e.target.value })} />
              </Field>
              <Field label="Lifting starts">
                <Input type="time" value={ev.lifting_start} onChange={(e) => setEv({ ...ev, lifting_start: e.target.value })} />
              </Field>
              <Field label="Your flight">
                <Input value={ev.flight} onChange={(e) => setEv({ ...ev, flight: e.target.value })} placeholder="A, B…" />
              </Field>
              <Field label="Flights in session">
                <Input inputMode="numeric" value={ev.flights_in_session} onChange={(e) => setEv({ ...ev, flights_in_session: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-[13.5px]">
              <Checkbox checked={official} onCheckedChange={(v) => setOfficial(v === true)} className="mt-0.5" />
              These times are from the meet's official schedule
            </label>
          </>
        ) : null}

        {step === "body" ? (
          <>
            <UnitSwitch unit={unit} onChange={(u) => set("unit", u)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Weight class">
                <Input value={ev.weight_class} onChange={(e) => setEv({ ...ev, weight_class: e.target.value })} placeholder="e.g. 83" />
              </Field>
              <Field label={`Bodyweight now (${unit})`}>
                <Input
                  inputMode="decimal"
                  defaultValue={kgBox(info.bodyweightKg)}
                  onBlur={(e) => set("bodyweightKg", fromBox(e.target.value, 25, 700))}
                />
              </Field>
            </div>
            <Field label="Division">
              <Input value={ev.division} onChange={(e) => setEv({ ...ev, division: e.target.value })} placeholder="Open, Junior, Master 1…" />
            </Field>
          </>
        ) : null}

        {step === "lifts" ? (
          <>
            <UnitSwitch unit={unit} onChange={(u) => set("unit", u)} />
            <div className="grid grid-cols-[72px_1fr_1fr_1fr] items-end gap-2 text-[12px] text-muted-foreground">
              <span />
              <span>Best at a meet</span>
              <span>Best recent</span>
              <span>Goal</span>
            </div>
            {LIFTS.map((l) => (
              <div key={l} className="grid grid-cols-[72px_1fr_1fr_1fr] items-center gap-2">
                <span className="text-[14px] font-medium">{LIFT_WORD[l]}</span>
                {(["bests", "recent", "targets"] as const).map((k) => (
                  <Input
                    key={k}
                    inputMode="decimal"
                    aria-label={`${LIFT_WORD[l]} ${k}`}
                    defaultValue={kgBox(info[k]?.[l])}
                    onBlur={(e) => trioSet(k, l, e.target.value)}
                  />
                ))}
              </div>
            ))}
            <Field label="Who picks your attempts?">
              <Choice
                value={info.attemptsBy ?? null}
                options={[
                  ["handler", "My handler"],
                  ["my_coach", "My coach"],
                  ["me", "Me"],
                ]}
                onChange={(v) => set("attemptsBy", v as any)}
              />
            </Field>
            {info.attemptsBy === "me" || info.attemptsBy === "my_coach" ? (
              <div className="space-y-2">
                <p className="text-[12.5px] text-muted-foreground">Planned attempts ({unit}), if you have them</p>
                {LIFTS.map((l) => (
                  <div key={l} className="grid grid-cols-[72px_1fr_1fr_1fr] items-center gap-2">
                    <span className="text-[14px] font-medium">{LIFT_WORD[l]}</span>
                    {[0, 1, 2].map((n) => (
                      <Input
                        key={n}
                        inputMode="decimal"
                        aria-label={`${LIFT_WORD[l]} attempt ${n + 1}`}
                        defaultValue={kgBox(info.attempts?.[l]?.[n])}
                        onBlur={(e) =>
                          setInfo((p) => {
                            const arr = [...(p.attempts?.[l] ?? [null, null, null])];
                            arr[n] = fromBox(e.target.value);
                            return { ...p, attempts: { ...(p.attempts ?? {}), [l]: arr } };
                          })
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {step === "coach" ? (
          <>
            <Field label="Do you have a coach who writes your training?">
              <Choice
                value={info.coach?.has == null ? null : info.coach.has ? "yes" : "no"}
                options={[
                  ["yes", "Yes"],
                  ["no", "No"],
                ]}
                onChange={(v) => set("coach", { ...(info.coach ?? {}), has: v === "yes", writesTraining: v === "yes" })}
              />
            </Field>
            {info.coach?.has ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Their name">
                    <Input defaultValue={info.coach?.name ?? ""} onBlur={(e) => set("coach", { ...(info.coach ?? {}), name: e.target.value })} />
                  </Field>
                  <Field label="Email or phone (optional)">
                    <Input defaultValue={info.coach?.contact ?? ""} onBlur={(e) => set("coach", { ...(info.coach ?? {}), contact: e.target.value })} />
                  </Field>
                </div>
                <Field label="Can your handler share your meet plan with them?">
                  <Choice
                    value={info.shareWithCoach ?? null}
                    options={[
                      ["yes", "Yes, share it"],
                      ["no", "No, keep it between us"],
                    ]}
                    onChange={(v) => set("shareWithCoach", v as any)}
                  />
                </Field>
                <p className="text-[12.5px] text-muted-foreground">
                  Your coach keeps writing your training. Nothing is sent to them unless you say yes here.
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {step === "warmups" ? (
          <>
            <Field label="How do you like to warm up?">
              <Choice
                value={info.warmupStyle ?? null}
                options={[
                  ["fewer", "Fewer sets"],
                  ["standard", "Standard"],
                  ["more", "More sets"],
                ]}
                onChange={(v) => set("warmupStyle", v as any)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Squat rack height">
                <Input defaultValue={info.racks?.squat?.height ?? ""} onBlur={(e) => set("racks", { ...(info.racks ?? {}), squat: { ...(info.racks?.squat ?? {}), height: e.target.value } })} />
              </Field>
              <Field label="Squat safeties">
                <Input defaultValue={info.racks?.squat?.safety ?? ""} onBlur={(e) => set("racks", { ...(info.racks ?? {}), squat: { ...(info.racks?.squat ?? {}), safety: e.target.value } })} />
              </Field>
              <Field label="Bench rack height">
                <Input defaultValue={info.racks?.bench?.height ?? ""} onBlur={(e) => set("racks", { ...(info.racks ?? {}), bench: { ...(info.racks?.bench ?? {}), height: e.target.value } })} />
              </Field>
              <Field label="Bench safeties">
                <Input defaultValue={info.racks?.bench?.safety ?? ""} onBlur={(e) => set("racks", { ...(info.racks ?? {}), bench: { ...(info.racks?.bench ?? {}), safety: e.target.value } })} />
              </Field>
            </div>
            <Field label="Foot blocks (if you use them)">
              <Input defaultValue={info.racks?.bench?.footBlocks ?? ""} onBlur={(e) => set("racks", { ...(info.racks ?? {}), bench: { ...(info.racks?.bench ?? {}), footBlocks: e.target.value } })} />
            </Field>
            <Field label="Gear you're bringing">
              <div className="flex flex-wrap gap-1.5">
                {GEAR_OPTIONS.map((g) => {
                  const on = (info.gear ?? []).includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set("gear", on ? (info.gear ?? []).filter((x) => x !== g) : [...(info.gear ?? []), g])}
                      className={cn("h-9 rounded-full border px-3 text-[13px]", on ? "border-foreground bg-foreground text-background" : "border-border")}
                      aria-pressed={on}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Anything that limits you right now? (optional)">
              <Textarea rows={2} defaultValue={info.limitations ?? ""} onBlur={(e) => set("limitations", e.target.value)} />
            </Field>
          </>
        ) : null}

        {step === "travel" ? (
          <>
            <Field label="Getting there">
              <Choice
                value={info.travel?.mode ?? null}
                options={[
                  ["local", "It's local"],
                  ["drive", "Driving in"],
                  ["fly", "Flying"],
                ]}
                onChange={(v) => set("travel", { ...(info.travel ?? {}), mode: v as any })}
              />
            </Field>
            <Field label="Minutes from where you'll sleep to the venue">
              <Input
                inputMode="numeric"
                defaultValue={info.travel?.minutesToVenue != null ? String(info.travel.minutesToVenue) : ""}
                onBlur={(e) => set("travel", { ...(info.travel ?? {}), minutesToVenue: readNumber(e.target.value, 0, 600) })}
              />
            </Field>
            {follow.includes("arrive") ? (
              <Field label="When do you arrive in town?">
                <Input defaultValue={info.travel?.arrive ?? ""} onBlur={(e) => set("travel", { ...(info.travel ?? {}), arrive: e.target.value })} placeholder="e.g. Friday 6 PM" />
              </Field>
            ) : null}
            {follow.includes("flightDetails") ? (
              <Field label="Flight details">
                <Input defaultValue={info.travel?.flightDetails ?? ""} onBlur={(e) => set("travel", { ...(info.travel ?? {}), flightDetails: e.target.value })} />
              </Field>
            ) : null}
            {follow.includes("accommodation") ? (
              <Field label="Where you're staying">
                <Input defaultValue={info.travel?.accommodation ?? ""} onBlur={(e) => set("travel", { ...(info.travel ?? {}), accommodation: e.target.value })} />
              </Field>
            ) : null}
          </>
        ) : null}

        {step === "day" ? (
          <>
            <Field label="What you eat after weigh-in">
              <Input defaultValue={info.nutrition?.afterWeighIn ?? ""} onBlur={(e) => set("nutrition", { ...(info.nutrition ?? {}), afterWeighIn: e.target.value })} />
            </Field>
            <Field label="Snacks you like during a meet">
              <Input defaultValue={info.nutrition?.snacks ?? ""} onBlur={(e) => set("nutrition", { ...(info.nutrition ?? {}), snacks: e.target.value })} />
            </Field>
            <Field label="Caffeine you usually take before training (mg, optional)">
              <Input
                inputMode="numeric"
                defaultValue={info.nutrition?.caffeineMg != null ? String(info.nutrition.caffeineMg) : ""}
                onBlur={(e) => set("nutrition", { ...(info.nutrition ?? {}), caffeineMg: readNumber(e.target.value, 0, 600) })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Your phone on the day">
                <Input
                  inputMode="tel"
                  defaultValue={info.meetDay?.phone ?? meet.contact?.phone ?? ""}
                  onBlur={(e) => set("meetDay", { ...(info.meetDay ?? {}), phone: e.target.value })}
                />
              </Field>
              <Field label="Emergency contact">
                <Input defaultValue={info.meetDay?.emergencyName ?? ""} onBlur={(e) => set("meetDay", { ...(info.meetDay ?? {}), emergencyName: e.target.value })} />
              </Field>
            </div>
            <Field label="Their phone">
              <Input inputMode="tel" defaultValue={info.meetDay?.emergencyPhone ?? ""} onBlur={(e) => set("meetDay", { ...(info.meetDay ?? {}), emergencyPhone: e.target.value })} />
            </Field>
          </>
        ) : null}

        {step === "confirm" && meet.handling ? (
          <>
            <div className="max-h-60 overflow-y-auto whitespace-pre-line rounded-xl bg-muted/40 p-3 text-[13px] leading-relaxed" data-handling-terms>
              {meet.terms?.text}
            </div>
            {meet.handling.termsAcceptedAt ? (
              <p className="text-[13px] text-muted-foreground">You agreed to these on {String(meet.handling.termsAcceptedAt).slice(0, 10)}.</p>
            ) : (
              <label className="flex items-start gap-2 text-[13.5px]">
                <Checkbox checked={termsOk} onCheckedChange={(v) => setTermsOk(v === true)} className="mt-0.5" data-accept-terms />
                I agree to these terms
              </label>
            )}
            {meet.handling.payment === "link" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-[13.5px]" data-web-only>
                <span>Handling: {priceText(meet.handling.priceCents, meet.handling.currency)}</span>
                <Button size="sm" variant="outline" loading={pay.isPending} disabled={previewing} onClick={() => pay.mutate()}>
                  Pay
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <Button className="mt-4 w-full" loading={run.isPending} onClick={() => run.mutate()} data-onboarding-next>
        {last ? (previewing ? "They tap Done here" : "Done") : "Next"}
      </Button>
      {!last && step !== "event" ? (
        <button type="button" className="mt-2 w-full text-center text-[13px] text-muted-foreground" onClick={() => setI(i + 1)}>
          Skip for now
        </button>
      ) : null}
    </section>
  );
}

function eventPatch(ev: Ev, step: StepKey): Record<string, unknown> {
  const n = (s: string) => {
    const v = Number(s);
    return s.trim() && Number.isInteger(v) ? v : null;
  };
  if (step === "body") return { weight_class: ev.weight_class.trim() || null, division: ev.division.trim() || null };
  return {
    federation: ev.federation.trim() || null,
    location: ev.location.trim() || null,
    weigh_in_at: ev.weigh_in_at || null,
    lifting_start: ev.lifting_start || null,
    flight: ev.flight.trim() || null,
    flights_in_session: n(ev.flights_in_session),
    lifters_per_flight: n(ev.lifters_per_flight),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn("h-10 rounded-full border px-4 text-[14px]", value === k ? "border-foreground bg-foreground text-background" : "border-border")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function UnitSwitch({ unit, onChange }: { unit: InfoUnit; onChange: (u: InfoUnit) => void }) {
  return (
    <div className="flex justify-end">
      <div className="inline-flex rounded-full border border-border p-0.5 text-[12.5px]">
        {(["kg", "lb"] as const).map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => onChange(u)}
            className={cn("h-7 rounded-full px-3", unit === u ? "bg-secondary font-medium" : "text-muted-foreground")}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
