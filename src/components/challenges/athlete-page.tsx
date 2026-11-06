import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Instagram, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { challengeKeys, challengeRpc, errorText, fetchAthlete, removeAthletePhoto, track, uploadAthletePhoto, useChallengeMe } from "@/lib/challenges/api";
import { achievements, personalBests } from "@/lib/challenges/achievements";
import { formatScore, ordinal, shortDate } from "@/lib/challenges/format";
import type { AthleteProfile } from "@/lib/challenges/types";
import { PhotoPicker, photoBlob, type PickedPhoto } from "./photo-picker";
import { AppCta, AthleteAvatar, PublicBar, PublicFooter, Section, StatusPill } from "./ui";

function EditProfile({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const me = useChallengeMe(true);
  const m = me.data;
  const [name, setName] = useState("");
  const [ig, setIg] = useState("");
  const [listed, setListed] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!m || !open) return;
    setName(m.name);
    setIg(m.instagram ?? "");
    setListed(m.discoverable);
    setMarketing(m.marketing);
    setPhoto(null);
  }, [m, open]);

  if (!m) return null;

  async function save() {
    setBusy(true);
    try {
      await challengeRpc("challenge_update_athlete", { p_athlete: m!.athlete_id, p: { display_name: name, instagram: ig, discoverable: listed, marketing } });
      if (photo) await uploadAthletePhoto(m!.athlete_id, await photoBlob(photo));
      await qc.invalidateQueries({ queryKey: ["challenges"] });
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function dropPhoto() {
    setBusy(true);
    try {
      await removeAthletePhoto(m!.athlete_id);
      await qc.invalidateQueries({ queryKey: ["challenges"] });
      toast.success("Photo removed everywhere");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function setShown(entryId: string, show: boolean) {
    try {
      await challengeRpc("challenge_my_entry", { p_entry: entryId, p_show_name: show, p_withdraw: false });
      await qc.invalidateQueries({ queryKey: ["challenges"] });
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function erase() {
    if (!confirm("Delete your email and phone from JF Effect challenges? Your results stay, but we can't contact you about prizes.")) return;
    try {
      await challengeRpc("challenge_erase_contact", { p_athlete: m!.athlete_id });
      await qc.invalidateQueries({ queryKey: challengeKeys.me });
      toast.success("Contact details deleted");
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold" htmlFor="ep-name">Name on leaderboards</label>
            <Input id="ep-name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold" htmlFor="ep-ig">Instagram</label>
            <Input id="ep-ig" className="h-12 text-base" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="@handle" autoCapitalize="none" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Photo</div>
            {m.photo && !photo && (
              <div className="flex items-center gap-3">
                <AthleteAvatar name={m.name} photo={m.photo} size={56} />
                <button type="button" onClick={dropPhoto} disabled={busy} className="h-10 rounded-lg border border-border px-3 text-sm font-semibold">
                  Remove photo
                </button>
              </div>
            )}
            <PhotoPicker value={photo} onChange={setPhoto} />
            <p className="text-xs text-muted-foreground">A photo you add here shows on your leaderboards and result cards.</p>
          </div>
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Findable profile</div>
              <p className="text-xs text-muted-foreground">Off: leaderboards still show your name, but your profile isn't linked.</p>
            </div>
            <Switch checked={listed} onCheckedChange={setListed} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Challenge news by email</div>
              <p className="text-xs text-muted-foreground">Future challenges and training from JF Effect.</p>
            </div>
            <Switch checked={marketing} onCheckedChange={setMarketing} />
          </label>
          {m.entries.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Name on each challenge</div>
              {m.entries.map((e) => (
                <label key={e.entry_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                  <span className="min-w-0 truncate text-sm">{e.title}</span>
                  <Switch checked={e.show_name} onCheckedChange={(v) => setShown(e.entry_id, v)} aria-label={`Show my name on ${e.title}`} />
                </label>
              ))}
            </div>
          )}
          <button type="button" onClick={save} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
          {(m.email || m.phone) && (
            <button type="button" onClick={erase} className="w-full text-center text-sm font-semibold text-destructive">
              Delete my contact details
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AthletePage({ handle, initial }: { handle: string; initial: AthleteProfile | null }) {
  const q = useQuery({ queryKey: challengeKeys.athlete(handle), queryFn: () => fetchAthlete(handle), initialData: initial ?? undefined, initialDataUpdatedAt: 0 });
  const a = q.data ?? initial;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    track(null, "profile_view", { handle });
  }, [handle]);

  if (!a) {
    return (
      <div className="min-h-screen bg-background">
        <PublicBar />
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="text-xl font-semibold">Athlete not found</h1>
          <Link to="/challenges" className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            See challenges
          </Link>
        </div>
      </div>
    );
  }

  const done = a.history.filter((h) => h.rank != null);
  const wins = done.filter((h) => h.final && h.rank === 1).length;
  const podiums = done.filter((h) => h.final && (h.rank ?? 99) <= 3).length;
  const badges = achievements(a.history);
  const pbs = personalBests(a.history);

  return (
    <div className="min-h-screen bg-background">
      <PublicBar />
      <main className="mx-auto max-w-3xl space-y-8 px-4 pb-6 pt-6">
        <section className="flex flex-col items-center text-center">
          <AthleteAvatar name={a.name} photo={a.photo} size={104} ring={wins > 0} />
          <h1 className="mt-3 font-display text-4xl uppercase leading-none">{a.name}</h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            {a.instagram && (
              <a href={`https://instagram.com/${a.instagram}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Instagram className="h-4 w-4" />@{a.instagram}
              </a>
            )}
            <span>Competing since {shortDate(a.since)}</span>
          </div>
          {a.is_me && (
            <button type="button" onClick={() => setEditing(true)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold">
              <Pencil className="h-4 w-4" /> Edit profile
            </button>
          )}
          {a.is_me && !a.listed && <p className="mt-2 text-xs text-muted-foreground">Your profile is unlisted. Only people with the link see it.</p>}
        </section>

        <section className="grid grid-cols-3 gap-2">
          {[
            { k: "Challenges", v: done.length },
            { k: "Podiums", v: podiums },
            { k: "Wins", v: wins },
          ].map((s) => (
            <div key={s.k} className="rounded-2xl border border-border bg-card p-3 text-center">
              <div className="font-display text-3xl leading-none">{s.v}</div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{s.k}</div>
            </div>
          ))}
        </section>

        {badges.length > 0 && (
          <Section title="Achievements">
            <ul className="grid gap-2 sm:grid-cols-2">
              {badges.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                    <Award className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{b.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{b.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {pbs.length > 0 && (
          <Section title="Personal bests">
            <ul className="space-y-2">
              {pbs.map(({ kind, item }) => (
                <li key={kind} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">
                      {item.activity}
                      {item.load_value ? ` · ${item.load_value} ${item.load_unit}` : ""}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{item.title}</div>
                  </div>
                  <span className="font-display text-2xl tabular-nums">{formatScore(item.score, item)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Competition history">
          {a.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No challenges yet.</p>
          ) : (
            <ul className="space-y-2">
              {a.history.map((h) => (
                <li key={h.slug}>
                  <Link to="/challenges/$slug/$handle" params={{ slug: h.slug, handle: a.handle }} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-muted">
                      <span className="font-display text-xl leading-none">{h.rank ? ordinal(h.rank) : "–"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{h.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {shortDate(h.starts_at)}
                        {h.rank ? ` · of ${h.field}` : h.entry_status === "withdrawn" ? " · withdrew" : " · registered"}
                        {h.won.length ? ` · ${h.won[0]}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      {h.score != null && <div className="font-display text-xl tabular-nums">{formatScore(h.score, h)}</div>}
                      {!h.final && <StatusPill status={h.status} className="mt-1" />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <AppCta variant="compact" />
      </main>
      <PublicFooter />
      {a.is_me && <EditProfile open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
