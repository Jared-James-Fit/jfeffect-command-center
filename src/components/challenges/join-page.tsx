import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Share2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { arrival, errorText, selfRegister, track, uploadAthletePhoto, usePage, type RegistrationResult } from "@/lib/challenges/api";
import { eventWhen, objectiveText } from "@/lib/challenges/format";
import type { ChallengePageData } from "@/lib/challenges/types";
import { RegistrationForm, type RegistrationDraft } from "./registration-form";
import { photoBlob } from "./photo-picker";
import { AppCta, PublicBar, PublicFooter } from "./ui";

export function JoinPage({ slug, initial, search }: { slug: string; initial: ChallengePageData | null; search: { ref?: string; src?: string } }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const pageQ = usePage(slug, initial);
  const page = pageQ.data ?? initial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(RegistrationResult & { photoFailed?: boolean; show: boolean }) | null>(null);
  const [from, setFrom] = useState<{ ref: string | null; source: string | null }>({ ref: null, source: null });

  useEffect(() => {
    const a = arrival(search);
    setFrom(a);
    track(slug, "join_view", { ref: a.ref, source: a.source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const meta = user?.user_metadata as { full_name?: string; first_name?: string } | undefined;
  const prefill = user ? { email: user.email ?? "", full_name: meta?.full_name ?? "", display_name: meta?.first_name ?? meta?.full_name?.split(" ")[0] ?? "" } : undefined;

  async function submit(d: RegistrationDraft) {
    setBusy(true);
    setError(null);
    try {
      const res = await selfRegister(slug, { ...d.input, ref: from.ref, via: from.source === "qr" ? "qr" : "link" });
      let photoFailed = false;
      if (d.photo && res.photo_nonce && res.athlete_id) {
        try {
          await uploadAthletePhoto(res.athlete_id, await photoBlob(d.photo), res.photo_nonce);
        } catch {
          photoFailed = true;
        }
      }
      setDone({ ...res, photoFailed, show: d.input.show_name });
      void qc.invalidateQueries({ queryKey: ["challenges"] });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!page) {
    return (
      <div className="min-h-screen bg-background">
        <PublicBar />
        <p className="px-4 py-20 text-center text-sm text-muted-foreground">This challenge isn't open.</p>
      </div>
    );
  }
  const c = page.challenge;
  const open = page.registration === "open" && c.self_registration;

  return (
    <div className="min-h-screen bg-background">
      <PublicBar back={{ to: "/challenges/$slug", params: { slug }, label: c.title }} />
      <main className="mx-auto max-w-xl space-y-6 px-4 pb-6 pt-5">
        {done ? (
          <section className="space-y-5 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <div>
              <h1 className="font-display text-4xl uppercase leading-none">{done.already ? "You're already in" : "You're in"}</h1>
              <p className="mt-2 text-muted-foreground">{c.title}</p>
            </div>
            <div className="mx-auto w-40 rounded-2xl border border-border bg-card p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your bib</div>
              <div className="font-display text-6xl leading-none">#{done.bib}</div>
            </div>
            <p className="text-sm text-muted-foreground">
              {done.status === "checked_in" ? "You're checked in." : "Show your bib number when you check in."}
              {c.starts_at ? ` ${eventWhen(c.starts_at, c.ends_at, c.timezone)}.` : ""}
            </p>
            {done.photoFailed && <p className="text-sm text-warning">Your photo didn't upload. Staff can add one at check-in.</p>}
            {done.show && done.handle && (
              <Link
                to="/challenges/$slug/$handle"
                params={{ slug, handle: done.handle }}
                className="flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
              >
                <Share2 className="h-4 w-4" /> Tell people you're in
              </Link>
            )}
            <Link to="/challenges/$slug" params={{ slug }} className="flex h-12 items-center justify-center rounded-lg border border-border text-[15px] font-semibold">
              Back to the challenge
            </Link>
            {!user && !done.claimed && (
              <div className="rounded-2xl border border-border bg-card p-4 text-left">
                <div className="text-[15px] font-semibold">Keep your result on your profile</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Make a free JF Effect account with the same email and this entry (and every challenge after it) is yours to edit and share.
                </p>
              </div>
            )}
            <AppCta slug={slug} />
          </section>
        ) : (
          <>
            <section>
              <h1 className="font-display text-4xl uppercase leading-none">Enter the challenge</h1>
              <p className="mt-2 text-[15px] text-muted-foreground">{objectiveText(c)}</p>
              {c.eligibility && <p className="mt-3 rounded-xl bg-muted p-3 text-sm">{c.eligibility}</p>}
            </section>
            {open ? (
              <RegistrationForm mode="self" challenge={c} divisions={page.divisions} prefill={prefill} submitting={busy} error={error} onSubmit={submit} />
            ) : (
              <div className="rounded-2xl border border-border p-5 text-center text-sm">
                {page.registration === "full" ? "This challenge is full." : c.self_registration ? "Registration is closed." : "Sign up with event staff at the venue."}
              </div>
            )}
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
