import { Suspense, useEffect, useState } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { BIO_MAX } from "@/lib/community";
import { useMyCommunitySettings, useSetBio } from "@/lib/community.queries";
import {
  DISCIPLINES, MAX_DISCIPLINES, isValidUsername, useGymNames, useSetDiscoverable, useSetTraining, useSetUsername, useUsernameCheck,
} from "@/lib/community-discover";

import { CoachPublicRow, PrivateAccountRow, ShareWorkoutsRow } from "@/components/community/privacy-settings";

// Messages' blocked list, loaded only when it's opened (it lives with the chat screens).
const BlockedPeopleSheet = lazyWithRetry(() => import("@/components/messages/inbox-parts").then((m) => ({ default: m.BlockedPeopleSheet })));

/**
 * Edit profile (Instagram's): @username, bio, what you train and your gym,
 * then Privacy: a private account (athletes; a coach's is always public),
 * automatic workout stories, whether you're suggested to people you aren't
 * connected with, and the people you've blocked. Training and gym are optional and only help people who train
 * like you, or where you do, find you.
 */
export function ProfileEditSheet({ open, onOpenChange, userId, bio: bioNow, isCoach }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  bio: string | null;
  isCoach: boolean;
}) {
  const { data: settings } = useMyCommunitySettings(open);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [disc, setDisc] = useState<string[]>([]);
  const [gym, setGym] = useState("");
  const [gymFocus, setGymFocus] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !settings) return;
    setUsername(settings.username ?? "");
    setBio(bioNow ?? "");
    setDisc(settings.disciplines ?? []);
    setGym(settings.home_gym ?? "");
  }, [open, settings, bioNow]);

  const u = username.trim().replace(/^@+/, "").toLowerCase();
  const usernameChanged = !!settings && u !== (settings.username ?? "");
  const formatOk = isValidUsername(u);
  const check = useUsernameCheck(u, open && usernameChanged && formatOk);
  const usernameNote = !usernameChanged
    ? null
    : !formatOk
      ? { ok: false, text: "3–24 letters, numbers, dots or underscores" }
      : check.isFetching || !check.data
        ? { ok: null, text: "Checking…" }
        : check.data.ok
          ? { ok: true, text: "Available" }
          : { ok: false, text: check.data.reason === "taken" ? "That username is taken" : "That username isn't available" };
  const gyms = useGymNames(gym, open && gymFocus);
  const gymHints = (gyms.data ?? []).filter((g) => g.toLowerCase() !== gym.trim().toLowerCase()).slice(0, 4);

  const saveUsername = useSetUsername();
  const saveBio = useSetBio(userId);
  const saveTraining = useSetTraining();
  const setDiscoverable = useSetDiscoverable();

  const bioChanged = bio.trim() !== (bioNow ?? "").trim();
  const trainingChanged = !!settings && (disc.join() !== (settings.disciplines ?? []).join() || gym.trim() !== (settings.home_gym ?? ""));
  const usernameBlocking = usernameChanged && usernameNote?.ok !== true;
  const dirty = usernameChanged || bioChanged || trainingChanged;

  const save = async () => {
    if (!dirty || usernameBlocking) return;
    setSaving(true);
    try {
      if (usernameChanged) await saveUsername.mutateAsync(u);
      if (bioChanged) await saveBio.mutateAsync(bio);
      if (trainingChanged) await saveTraining.mutateAsync({ disciplines: disc, homeGym: gym.trim() || null });
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),12px)] sm:mx-auto sm:max-w-[520px]" data-profile-edit>
          <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 bg-background px-4 py-3 text-left">
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
            <div className="min-w-0 flex-1 text-center">
              <SheetTitle className="text-[16px] font-black">Edit profile</SheetTitle>
              <SheetDescription className="sr-only">Your username, bio, training, gym and privacy</SheetDescription>
            </div>
            <Button type="button" size="sm" className="h-9 rounded-full px-4 font-bold" disabled={!dirty || usernameBlocking || saving} onClick={() => void save()} data-profile-save>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </SheetHeader>

          {!settings ? (
            <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-5 px-4 pb-4 pt-4">
              <Field label="Username" hint={usernameNote?.text ?? "How people find you in Search, and your @ on your profile"} hintTone={usernameNote?.ok === false ? "bad" : usernameNote?.ok ? "good" : undefined}>
                <div className="flex h-11 items-center rounded-xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30">
                  <span className="text-[16px] text-muted-foreground">@</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "").toLowerCase().slice(0, 24))}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    aria-label="Username"
                    className="h-full min-w-0 flex-1 bg-transparent pl-0.5 text-[16px] outline-none"
                    data-username-input
                  />
                  {usernameNote?.ok === true && <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
                </div>
              </Field>

              <Field label="Bio">
                <Textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))} rows={2} placeholder="Lifter, goal, weight class… whatever you want people to know." className="resize-none rounded-xl text-[16px]" />
                <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{bio.length}/{BIO_MAX}</div>
              </Field>

              <Field label="What you train" hint={`Up to ${MAX_DISCIPLINES}. People who train the same way see you in their suggestions.`}>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="What you train">
                  {DISCIPLINES.map((d) => {
                    const on = disc.includes(d.key);
                    const full = !on && disc.length >= MAX_DISCIPLINES;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        aria-pressed={on}
                        disabled={full}
                        onClick={() => setDisc((cur) => (on ? cur.filter((k) => k !== d.key) : [...cur, d.key]))}
                        className={cn(
                          "h-9 rounded-full border px-3.5 text-[13px] font-bold transition-colors disabled:opacity-40",
                          on ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground active:bg-muted",
                        )}
                        data-discipline={d.key}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Home gym" hint="Optional. People who train there see you first.">
                <input
                  value={gym}
                  onChange={(e) => setGym(e.target.value.slice(0, 60))}
                  onFocus={() => setGymFocus(true)}
                  onBlur={() => window.setTimeout(() => setGymFocus(false), 150)}
                  placeholder="Where you train"
                  autoComplete="off"
                  aria-label="Home gym"
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[16px] outline-none focus:ring-2 focus:ring-primary/30"
                  data-gym-input
                />
                {gymFocus && gymHints.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5" data-gym-hints>
                    {gymHints.map((g) => (
                      <button key={g} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setGym(g)} className="h-8 rounded-full bg-muted px-3 text-[12px] font-semibold active:bg-muted/70">
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              {/* who sees what you post: private account (athletes) or always public (coaches), automatic workout stories, suggestions, blocks */}
              <Field label="Privacy">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card" data-privacy-settings>
                {isCoach ? <CoachPublicRow /> : <PrivateAccountRow />}
                <ShareWorkoutsRow />
                {!isCoach && (
                  <label className="flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3" data-discoverable-switch>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold">Suggest my account</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">Show me in Search and suggestions to people I'm not connected with. People I follow or who follow me can always find me.</span>
                    </span>
                    <Switch
                      checked={settings.discoverable !== false}
                      disabled={setDiscoverable.isPending}
                      onCheckedChange={(on) => setDiscoverable.mutate(on, { onError: (e: any) => toast.error(e?.message ?? "Couldn't save that") })}
                    />
                  </label>
                )}
                <button type="button" onClick={() => setBlockedOpen(true)} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 py-3 text-left active:bg-muted" data-blocked-open>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">Blocked accounts</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">They can't find you, see your posts or message you</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
              </Field>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {blockedOpen && (
        <Suspense fallback={null}>
          <BlockedPeopleSheet open={blockedOpen} onOpenChange={setBlockedOpen} />
        </Suspense>
      )}
    </>
  );
}

function Field({ label, hint, hintTone, children }: { label: string; hint?: string | null; hintTone?: "good" | "bad"; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      {children}
      {hint && <p className={cn("mt-1.5 text-[11.5px] leading-snug", hintTone === "bad" ? "text-destructive" : hintTone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}
