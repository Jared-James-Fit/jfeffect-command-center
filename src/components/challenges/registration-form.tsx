// One sign-up form for both doors: the athlete on their own phone (QR / link)
// and event staff signing someone up in about 30 seconds. Only what running
// the event needs; the email and phone stay private.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { lbToKg } from "@/lib/challenges/format";
import type { RegistrationInput } from "@/lib/challenges/api";
import type { ChallengePublic, Division } from "@/lib/challenges/types";
import { PhotoPicker, type PickedPhoto } from "./photo-picker";

export interface RegistrationDraft {
  input: RegistrationInput;
  photo: PickedPhoto | null;
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "h-12 text-base";

export function RegistrationForm({
  mode,
  challenge,
  divisions,
  prefill,
  submitting,
  error,
  onSubmit,
}: {
  mode: "self" | "staff";
  challenge: ChallengePublic;
  divisions: Division[];
  prefill?: { display_name?: string; full_name?: string; email?: string };
  submitting: boolean;
  error?: string | null;
  onSubmit: (d: RegistrationDraft) => void;
}) {
  const staff = mode === "staff";
  const phoneMode = challenge.reg_fields?.phone ?? "optional";
  const igMode = challenge.reg_fields?.instagram ?? "optional";
  const needsBodyweight = staff && (challenge.tiebreak === "bodyweight_lower" || challenge.scoring === "bodyweight_ratio");

  const [displayName, setDisplayName] = useState(prefill?.display_name ?? "");
  const [fullName, setFullName] = useState(prefill?.full_name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [division, setDivision] = useState<string | null>(divisions.length === 1 ? divisions[0].id : null);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoConsent, setPhotoConsent] = useState(true);
  const [showName, setShowName] = useState(true);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [staffConfirmed, setStaffConfirmed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [bw, setBw] = useState("");
  const [bwUnit, setBwUnit] = useState<"lb" | "kg">("lb");
  const [checkIn, setCheckIn] = useState(true);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (prefill?.display_name && !displayName) setDisplayName(prefill.display_name);
    if (prefill?.full_name && !fullName) setFullName(prefill.full_name);
    if (prefill?.email && !email) setEmail(prefill.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.display_name, prefill?.full_name, prefill?.email]);

  const ackList = challenge.acknowledgments ?? [];
  const allAcked = staff ? staffConfirmed || ackList.length === 0 : ackList.every((a) => acks[a]);
  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const bwNum = bw.trim() ? Number(bw.replace(",", ".")) : null;
  const bwKg = bwNum != null && Number.isFinite(bwNum) ? (bwUnit === "lb" ? lbToKg(bwNum) : bwNum) : null;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!displayName.trim()) p.push("Add the name for the leaderboard.");
    if (!staff && !fullName.trim()) p.push("Add your full name (private).");
    if (!staff && !email.trim()) p.push("Add your email.");
    if (!emailOk) p.push("Check the email.");
    if (!staff && phoneMode === "required" && !phone.trim()) p.push("Add a phone number.");
    if (!staff && igMode === "required" && !instagram.trim()) p.push("Add your Instagram.");
    if (divisions.length > 1 && !division) p.push("Pick a division.");
    if (!allAcked) p.push(staff ? "Confirm the athlete agreed to everything listed." : "Tick every box under Before you enter.");
    if (bwNum != null && (!bwKg || bwKg < 20 || bwKg > 400)) p.push("Check the bodyweight.");
    return p;
  }, [displayName, fullName, email, emailOk, phone, instagram, division, divisions.length, allAcked, staff, phoneMode, igMode, bwNum, bwKg]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problems.length || submitting) return;
    onSubmit({
      input: {
        display_name: displayName.trim(),
        full_name: fullName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        instagram: instagram.trim() || undefined,
        division_id: division,
        acks: ackList,
        show_name: showName,
        photo_consent: !!photo && photoConsent,
        marketing,
        bodyweight_kg: bwKg ? Math.round(bwKg * 10) / 10 : null,
        check_in: staff ? checkIn : undefined,
      },
      photo: photo && photoConsent ? photo : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div className="space-y-4">
        <Field label="Name on the leaderboard" hint="public" htmlFor="cr-display">
          <Input id="cr-display" className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 40))} placeholder="e.g. Jared M." autoComplete="nickname" enterKeyHint="next" />
        </Field>
        <Field label="Full name" hint={staff ? "private · optional" : "private"} htmlFor="cr-full">
          <Input id="cr-full" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value.slice(0, 80))} autoComplete="name" enterKeyHint="next" />
        </Field>
        <Field label="Email" hint={staff ? "private · for their result and claiming their profile" : "private · for your result and prize"} htmlFor="cr-email">
          <Input id="cr-email" className={inputCls} type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} enterKeyHint="next" />
        </Field>
        {phoneMode !== "off" && (
          <Field label="Phone" hint={phoneMode === "required" && !staff ? "private" : "private · optional"} htmlFor="cr-phone">
            <Input id="cr-phone" className={inputCls} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 30))} />
          </Field>
        )}
        {igMode !== "off" && (
          <Field label="Instagram" hint={igMode === "required" && !staff ? "shown on the profile" : "optional · shown on the profile"} htmlFor="cr-ig">
            <Input id="cr-ig" className={inputCls} autoCapitalize="none" autoCorrect="off" value={instagram} onChange={(e) => setInstagram(e.target.value.slice(0, 60))} placeholder="@handle" />
          </Field>
        )}
        {divisions.length > 1 && (
          <Field label="Division">
            <div className="flex flex-wrap gap-2">
              {divisions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDivision(d.id)}
                  className={cn("h-11 rounded-full border px-4 text-sm font-semibold", division === d.id ? "border-foreground bg-foreground text-background" : "border-border")}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        {needsBodyweight && (
          <Field label="Bodyweight" hint={challenge.tiebreak === "bodyweight_lower" ? "breaks ties" : "needed for the score"} htmlFor="cr-bw">
            <div className="flex gap-2">
              <Input id="cr-bw" className={cn(inputCls, "flex-1")} inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} placeholder="Weigh in" />
              <div className="flex rounded-lg border border-border p-1">
                {(["lb", "kg"] as const).map((u) => (
                  <button key={u} type="button" onClick={() => setBwUnit(u)} className={cn("h-10 rounded-md px-3 text-sm font-semibold", bwUnit === u ? "bg-secondary" : "text-muted-foreground")}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </Field>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-4">
        <div>
          <div className="text-sm font-semibold">Photo <span className="font-normal text-muted-foreground">optional</span></div>
          <p className="text-xs text-muted-foreground">For the leaderboard and result cards. You can compete without one.</p>
        </div>
        <PhotoPicker value={photo} onChange={setPhoto} facing={staff ? "environment" : "user"} />
        {photo && (
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={photoConsent} onCheckedChange={(v) => setPhotoConsent(!!v)} className="mt-0.5 h-5 w-5" />
            <span>{staff ? "They're happy for this photo to show publicly." : "Show this photo on the public leaderboard and result cards."}</span>
          </label>
        )}
      </div>

      <label className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4">
        <div>
          <div className="text-sm font-semibold">Show {staff ? "their" : "my"} name publicly</div>
          <p className="text-xs text-muted-foreground">{showName ? "Name shows on the leaderboard." : "Shows as “Athlete #bib” instead."}</p>
        </div>
        <Switch checked={showName} onCheckedChange={setShowName} />
      </label>

      {ackList.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <div className="text-sm font-semibold">Before you enter</div>
          {staff ? (
            <>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {ackList.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <label className="flex items-start gap-3 text-sm font-medium">
                <Checkbox checked={staffConfirmed} onCheckedChange={(v) => setStaffConfirmed(!!v)} className="mt-0.5 h-5 w-5" />
                The athlete confirmed all of the above (and is {challenge.min_age}+).
              </label>
            </>
          ) : (
            ackList.map((a) => (
              <label key={a} className="flex items-start gap-3 text-sm">
                <Checkbox checked={!!acks[a]} onCheckedChange={(v) => setAcks((s) => ({ ...s, [a]: !!v }))} className="mt-0.5 h-5 w-5" />
                <span>{a}</span>
              </label>
            ))
          )}
        </div>
      )}

      <label className="flex items-start gap-3 px-1 text-sm">
        <Checkbox checked={marketing} onCheckedChange={(v) => setMarketing(!!v)} className="mt-0.5 h-5 w-5" />
        <span className="text-muted-foreground">
          {staff ? "They'd like emails from JF Effect about training and future challenges." : "Email me about future challenges and training from JF Effect. (Optional, separate from this event.)"}
        </span>
      </label>

      {staff && (
        <label className="flex items-center justify-between gap-4 px-1">
          <span className="text-sm font-semibold">Checked in and here now</span>
          <Switch checked={checkIn} onCheckedChange={setCheckIn} />
        </label>
      )}

      {(error || (touched && problems.length > 0)) && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error ?? problems[0]}
        </div>
      )}

      <button type="submit" disabled={submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-60">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Saving…" : staff ? "Register athlete" : "Enter the challenge"}
      </button>
      {!staff && (
        <p className="text-center text-xs text-muted-foreground">
          Your email and phone are private: they're used to run this event and contact winners, never shown publicly. Ask JF Effect to delete them any time.
        </p>
      )}
    </form>
  );
}
