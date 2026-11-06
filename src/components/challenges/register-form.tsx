import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PhotoCapture } from "@/components/challenges/photo-capture";
import {
  errorText,
  registerEntry,
  type RegisterInput,
  type RegisterResult,
} from "@/lib/challenges/api";
import { uploadChallengePhoto } from "@/lib/challenges/photo.functions";
import { defaultBoardName, type ChallengePublic } from "@/lib/challenges/model";

export type RegisterDone = RegisterResult & {
  name: string;
  photoSaved: boolean;
  photoError: string | null;
  photoDataUrl: string | null;
};

/**
 * One registration form for both ways in: a person signing themselves up from
 * the QR code, and staff registering someone at the table (compact, the back
 * camera, one tick for "they confirmed everything", a weigh-in when ties go
 * to the lighter lifter).
 */
export function RegisterForm({
  challenge,
  mode,
  refCode,
  refSource,
  onDone,
}: {
  challenge: Pick<
    ChallengePublic,
    "id" | "divisions" | "collect" | "acknowledgments" | "tiebreak" | "relative" | "unit" | "title"
  >;
  mode: "self" | "staff";
  refCode?: string | null;
  refSource?: RegisterInput["ref_source"];
  onDone: (r: RegisterDone) => void;
}) {
  const staff = mode === "staff";
  const [fullName, setFullName] = useState("");
  const [boardName, setBoardName] = useState("");
  const [boardTouched, setBoardTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [division, setDivision] = useState<string | null>(
    challenge.divisions.length === 1 ? challenge.divisions[0]!.id : null,
  );
  const [showPhoto, setShowPhoto] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [acks, setAcks] = useState<string[]>([]);
  const [allConfirmed, setAllConfirmed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [bw, setBw] = useState("");
  const [bwUnit, setBwUnit] = useState<"lb" | "kg">(challenge.unit === "kg" ? "kg" : "lb");
  const [busy, setBusy] = useState<null | "saving" | "photo">(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useServerFn(uploadChallengePhoto);
  // the button waits for the page's scripts: a tap before then would post the form natively and lose it
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const collectPhone = challenge.collect?.phone ?? "optional";
  const collectIg = challenge.collect?.instagram ?? "optional";
  const wantsWeighIn = staff && (challenge.tiebreak === "lighter" || challenge.relative);
  const shownName = boardTouched ? boardName : defaultBoardName(fullName);
  const ackList = challenge.acknowledgments ?? [];

  const missing = useMemo(() => {
    const m: string[] = [];
    if (fullName.trim().length < 2) m.push("full name");
    if (!shownName.trim()) m.push("leaderboard name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) m.push("email");
    if (collectPhone === "required" && !phone.trim()) m.push("phone");
    if (collectIg === "required" && !instagram.trim()) m.push("Instagram");
    if (challenge.divisions.length && !division) m.push("division");
    if (staff ? ackList.length > 0 && !allConfirmed : ackList.some((a) => !acks.includes(a)))
      m.push("the confirmations");
    return m;
  }, [
    fullName,
    shownName,
    email,
    phone,
    instagram,
    division,
    acks,
    allConfirmed,
    staff,
    ackList,
    collectPhone,
    collectIg,
    challenge.divisions.length,
  ]);

  const submit = async () => {
    setError(null);
    if (missing.length) {
      setError(`Still needed: ${missing.join(", ")}.`);
      return;
    }
    const bwNum = bw.trim() ? Number(bw.replace(",", ".")) : null;
    if (bwNum != null && (!Number.isFinite(bwNum) || bwNum <= 0)) {
      setError("That bodyweight doesn't look right.");
      return;
    }
    setBusy("saving");
    try {
      const res = await registerEntry(challenge.id, {
        public_name: shownName.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        instagram: instagram.trim() || undefined,
        division_id: division,
        show_photo: showPhoto && !!photo,
        marketing_opt_in: marketing,
        acknowledged: staff ? (allConfirmed ? ackList : []) : acks,
        bodyweight_kg:
          bwNum == null
            ? null
            : Math.round((bwUnit === "lb" ? bwNum / 2.2046226218 : bwNum) * 10) / 10,
        ref: refCode ?? null,
        ref_source: refSource ?? null,
      });
      let photoSaved = false;
      let photoError: string | null = null;
      if (showPhoto && photo && res.photo_ticket) {
        setBusy("photo");
        try {
          await upload({ data: { token: res.photo_ticket, dataUrl: photo } });
          photoSaved = true;
        } catch (e) {
          photoError = errorText(e);
        }
      }
      onDone({ ...res, name: shownName.trim(), photoSaved, photoError, photoDataUrl: photo });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className="space-y-4">
        <Field
          label={staff ? "Full name" : "Your full name"}
          hint="Private. Used for prizes, never shown."
        >
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete={staff ? "off" : "name"}
            autoCapitalize="words"
            className="h-12 text-base"
            maxLength={80}
          />
        </Field>
        <Field
          label="Name on the leaderboard"
          hint="First name and last initial by default. Use a nickname if you'd rather."
        >
          <Input
            value={shownName}
            onChange={(e) => {
              setBoardTouched(true);
              setBoardName(e.target.value);
            }}
            className="h-12 text-base"
            maxLength={40}
          />
        </Field>
        <Field
          label="Email"
          hint={
            staff
              ? "For their result link and prize contact. Never shown."
              : "To claim your profile and reach you if you win. Never shown."
          }
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete={staff ? "off" : "email"}
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            maxLength={200}
          />
        </Field>
        {collectPhone !== "off" ? (
          <Field
            label={`Phone${collectPhone === "optional" ? " (optional)" : ""}`}
            hint="Only used if you win."
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete={staff ? "off" : "tel"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-12 text-base"
              maxLength={30}
            />
          </Field>
        ) : null}
        {collectIg !== "off" ? (
          <Field label={`Instagram${collectIg === "optional" ? " (optional)" : ""}`}>
            <Input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="@handle"
              className="h-12 text-base"
              maxLength={60}
            />
          </Field>
        ) : null}
        {challenge.divisions.length ? (
          <div>
            <Label className="text-sm font-medium">Division</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {challenge.divisions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDivision(d.id)}
                  className={cn(
                    "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium",
                    division === d.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background",
                  )}
                >
                  {d.name}
                  {d.load_label ? (
                    <span className="block text-xs font-normal opacity-70">{d.load_label}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {wantsWeighIn ? (
          <Field
            label="Weigh-in (optional now)"
            hint={
              challenge.relative
                ? "Needed for their score. Never shown."
                : "Only used to break a tie. Never shown."
            }
          >
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                value={bw}
                onChange={(e) => setBw(e.target.value)}
                className="h-12 flex-1 text-base"
                placeholder="Bodyweight"
              />
              <div className="flex rounded-lg bg-secondary p-1">
                {(["lb", "kg"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setBwUnit(u)}
                    className={cn(
                      "h-10 rounded-md px-3 text-sm",
                      bwUnit === u ? "bg-background font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </Field>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border p-4">
        <label className="flex items-start gap-3">
          <Switch
            checked={showPhoto}
            onCheckedChange={(v) => {
              setShowPhoto(v);
              if (!v) setPhoto(null);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">
              Photo on the leaderboard and result card
            </span>
            <span className="block text-xs text-muted-foreground">
              Optional. Without one, {staff ? "they" : "you"} still compete and get a card with
              initials.
            </span>
          </span>
        </label>
        {showPhoto ? (
          <div className="mt-4">
            <PhotoCapture
              value={photo}
              onChange={setPhoto}
              facing={staff ? "environment" : "user"}
            />
          </div>
        ) : null}
      </div>

      {ackList.length ? (
        <div className="space-y-3">
          {staff ? (
            <label className="flex items-start gap-3 rounded-2xl border border-border p-4">
              <Checkbox
                checked={allConfirmed}
                onCheckedChange={(v) => setAllConfirmed(v === true)}
                className="mt-0.5 h-5 w-5"
              />
              <span className="text-sm">
                <span className="font-medium">They confirmed each of these:</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {ackList.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </span>
            </label>
          ) : (
            ackList.map((a) => (
              <label key={a} className="flex items-start gap-3">
                <Checkbox
                  checked={acks.includes(a)}
                  onCheckedChange={(v) =>
                    setAcks((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))
                  }
                  className="mt-0.5 h-5 w-5"
                />
                <span className="text-sm">{a}</span>
              </label>
            ))
          )}
        </div>
      ) : null}

      <label className="flex items-start gap-3">
        <Checkbox
          checked={marketing}
          onCheckedChange={(v) => setMarketing(v === true)}
          className="mt-0.5 h-5 w-5"
        />
        <span className="text-sm text-muted-foreground">
          {staff ? "They'd like" : "Send me"} news about future JF Effect challenges. Optional, and
          separate from anything about this event.
        </span>
      </label>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full text-base" disabled={!!busy || !ready}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {busy === "photo"
          ? "Saving photo…"
          : busy
            ? "Registering…"
            : staff
              ? "Register"
              : "Enter the challenge"}
      </Button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // a wrapping label ties the words to the box (taps focus it, screen readers read it)
  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium">{label}</span>
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
