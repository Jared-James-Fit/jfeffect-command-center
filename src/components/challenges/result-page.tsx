import { useCallback, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Instagram, Medal, Swords, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { arrival, challengeKeys, fetchResult, mediaUrl, track, useChallengeLive } from "@/lib/challenges/api";
import { formatScore, gapText, ordinal, scoreParts, shortDate } from "@/lib/challenges/format";
import { cardFromResult, challengeUrl, headlineOptions, resultCaption } from "@/lib/challenges/share";
import type { ResultData } from "@/lib/challenges/types";
import { ShareStudio, copyText } from "./share-studio";
import { AppCta, AthleteAvatar, PublicBar, PublicFooter, Section, StatusPill } from "./ui";

export function ResultPage({ slug, handle, initial, search }: { slug: string; handle: string; initial: ResultData | null; search: { ref?: string; src?: string } }) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: challengeKeys.result(slug, handle),
    queryFn: () => fetchResult(slug, handle),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 5_000,
    refetchInterval: (s) => (s.state.data && !s.state.data.final && s.state.data.challenge.status === "live" ? 20_000 : false),
  });
  const r = q.data ?? initial;
  useChallengeLive(r?.challenge.id);

  useEffect(() => {
    const a = arrival(search);
    track(slug, "result_view", { handle, ref: a.ref, source: a.source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, handle]);

  const photoUrl = mediaUrl(r?.athlete.photo);
  const headlines = useMemo(() => (r ? headlineOptions({ ...r, city: r.challenge.city }) : []), [r]);
  const build = useCallback((h: string) => cardFromResult(r!, { headline: h, photoUrl }), [r, photoUrl]);

  if (!r) {
    return (
      <div className="min-h-screen bg-background">
        <PublicBar back={{ to: "/challenges/$slug", params: { slug }, label: "Challenge" }} />
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="text-xl font-semibold">Result not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">This athlete isn't on this challenge, or chose not to be named.</p>
          <Link to="/challenges/$slug" params={{ slug }} className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            See the leaderboard
          </Link>
        </div>
      </div>
    );
  }

  const c = r.challenge;
  const competed = r.rank != null && r.score != null;
  const s = scoreParts(r.score, c);
  const inviteLink = challengeUrl(slug, { ref: r.athlete.handle ?? undefined });
  const caption = resultCaption(r, challengeUrl(slug, { handle: r.athlete.handle, ref: r.athlete.handle }));
  const canJoin = !c.final && ["upcoming", "live", "paused"].includes(c.status);

  async function challengeFriend() {
    const text = competed
      ? `I got ${formatScore(r!.score, c)} at the ${c.title}. Think you can beat me?`
      : `I'm in the ${c.title}. You in?`;
    track(slug, "invite_link", { handle: r!.athlete.handle });
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url: inviteLink });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }
    const ok = await copyText(`${text} ${inviteLink}`);
    toast[ok ? "success" : "error"](ok ? "Invite copied. Send it to a friend." : "Couldn't copy the invite.");
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicBar back={{ to: "/challenges/$slug", params: { slug }, label: c.title }} />
      <main className="mx-auto max-w-3xl space-y-8 px-4 pb-6 pt-5">
        {/* ── The result ── */}
        <section className="rounded-2xl border border-border bg-card p-5 text-center">
          <div className="flex justify-center">
            <AthleteAvatar name={r.athlete.name} photo={r.athlete.photo} size={96} ring={competed && r.rank === 1} />
          </div>
          <h1 className="mt-3 font-display text-4xl uppercase leading-none">{r.athlete.name}</h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>Bib #{r.athlete.bib}</span>
            {r.division && r.divisions > 1 && <span>{r.division}</span>}
            {r.athlete.instagram && (
              <a href={`https://instagram.com/${r.athlete.instagram}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Instagram className="h-3.5 w-3.5" />@{r.athlete.instagram}
              </a>
            )}
          </div>

          {competed ? (
            <div className="mt-5 animate-[jf-score-in_500ms_ease-out]">
              <div className="font-display text-[96px] leading-[0.9] tabular-nums">{s.value}</div>
              {s.unit && <div className="font-display text-2xl uppercase tracking-[0.12em] text-primary">{s.unit}</div>}
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="font-display text-4xl">
                  {r.tied ? "T" : "#"}
                  {r.rank}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">of {r.ranked}</span>
              </div>
              <div className="mt-2 flex justify-center">
                {r.final ? (
                  <StatusPill status="completed" />
                ) : (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    Live ranking · can still change until results are final
                  </span>
                )}
              </div>
              {r.won.length > 0 && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-warning/15 px-3 py-1.5 text-sm font-semibold text-warning">
                  <Medal className="h-4 w-4" />
                  {r.won.map((w) => `${w.prize}${w.share < 1 ? " (shared)" : ""}`).join(" · ")}
                </div>
              )}
              <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                {r.division_rank != null && r.divisions > 1 && r.division && (
                  <p>
                    {ordinal(r.division_rank)} of {r.division_ranked} in {r.division}
                  </p>
                )}
                {!r.final && r.above && r.score != null && <p>{gapText(r.score, r.above.score, c, r.above.name)}</p>}
                {r.rank !== 1 && r.leader && (
                  <p>
                    Leader: {r.leader.name}, {formatScore(r.leader.score, c)}
                  </p>
                )}
                {r.attempts.length > 1 && (
                  <p>
                    Attempts: {r.attempts.map((a) => (a.r === "valid" ? formatScore(a.v, c) : "no lift")).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-2">
              <div className="font-display text-3xl uppercase">{r.attempts.length ? "No valid attempt" : "You're registered"}</div>
              <p className="text-sm text-muted-foreground">
                {r.status === "withdrawn"
                  ? "This entry was withdrawn."
                  : r.attempts.length
                    ? "The judges didn't count this attempt, so it isn't on the leaderboard."
                    : c.status === "upcoming"
                    ? `The score shows here the moment the judge saves it${c.starts_at ? `, from ${shortDate(c.starts_at, c.timezone)}` : ""}.`
                    : "The score shows here the moment the judge saves it."}
              </p>
            </div>
          )}
        </section>

        {/* ── Share ── */}
        {r.status !== "withdrawn" && (competed || r.attempts.length === 0) && (
          <Section title={competed ? "Share your result" : "Tell people you're in"}>
            <ShareStudio
              build={build}
              headlines={headlines}
              caption={caption}
              link={challengeUrl(slug, { handle: r.athlete.handle })}
              slug={slug}
              handle={r.athlete.handle}
              fileWho={r.athlete.handle}
              defaultStyle={photoUrl ? "spotlight" : "championship"}
            />
          </Section>
        )}

        {canJoin && (
          <button type="button" onClick={challengeFriend} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Swords className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Challenge a friend</div>
              <div className="text-sm text-muted-foreground">
                {competed ? `Send them a link to beat ${formatScore(r.score, c)}.` : "Send them the link to sign up."}
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

        {/* ── Keep it ── */}
        {!r.athlete.claimed && !user && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[15px] font-semibold">Is this you? Keep your results</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Make a free JF Effect account with the email you signed up with. Every challenge you enter lands on one profile, and you can change your name, photo
              and privacy.
            </p>
            <Link to="/join" onClick={() => track(slug, "join_click")} className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Claim my profile <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link to="/challenges/$slug" params={{ slug }} hash="leaderboard" className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold">
            Full leaderboard
          </Link>
          {r.athlete.handle && (r.athlete.listed || r.athlete.is_me) && (
            <Link to="/athletes/$handle" params={{ handle: r.athlete.handle }} className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold">
              <UserRound className="h-4 w-4" /> {r.athlete.is_me ? "My profile" : "Profile"}
            </Link>
          )}
        </div>

        <AppCta slug={slug} />
      </main>
      <PublicFooter />
    </div>
  );
}
