import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, ChevronRight, Clock, Loader2, Trophy, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { AthleteAvatar, ChallengeShell, ScoreText, StatusPill } from "@/components/challenges/ui";
import { ShareStudio } from "@/components/challenges/share-studio";
import {
  claimProfile,
  errorText,
  fetchEntry,
  invalidateChallenge,
  track,
  useEntry,
  useLiveChallenge,
} from "@/lib/challenges/api";
import {
  formatScore,
  gapToFirst,
  placeLabel,
  rankBadge,
  type EntryPublic,
} from "@/lib/challenges/model";
import { shareMeta } from "@/lib/share-meta";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/challenges/$slug/r/$code")({
  loader: async ({ params }) => {
    try {
      return { entry: await fetchEntry(params.code) };
    } catch {
      return { entry: null };
    }
  },
  head: ({ loaderData, params }) => {
    const e = loaderData?.entry;
    const c = e?.challenge;
    const title =
      e && c
        ? e.score != null
          ? `${e.name}: ${formatScore(e.score, c)}`
          : `${e.name} is in`
        : "Challenge result";
    const desc =
      e && c
        ? e.score != null && e.rank
          ? `${c.final ? "Finished" : "Currently"} ${placeLabel(e.rank, e.tied)} of ${e.of} at the ${c.title}. Can you beat it?`
          : `${e.name} entered the ${c.title}. Can you beat them?`
        : "A JF Effect challenge result.";
    return {
      meta: [
        { title: `${title} | ${c?.title ?? "JF Effect Challenges"}` },
        { name: "description", content: desc },
        { name: "robots", content: "noindex" },
        ...shareMeta({
          title: title.slice(0, 40),
          description: desc,
          path: `/challenges/${params.slug}/r/${params.code}`,
        }),
      ],
    };
  },
  component: ResultPage,
});

function ResultPage() {
  const { slug, code } = Route.useParams();
  const { entry: initial } = Route.useLoaderData();
  const q = useEntry(code, initial);
  const e = q.data;
  useLiveChallenge(e?.challenge.id);
  useEffect(() => {
    track("result_view", { slug, code });
  }, [slug, code]);

  if (q.isPending && !e) {
    return (
      <ChallengeShell back={{ to: `/challenges/${slug}`, label: "Leaderboard" }}>
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-8 w-1/2" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </ChallengeShell>
    );
  }
  if (!e) {
    return (
      <ChallengeShell>
        <p className="py-16 text-center text-sm text-muted-foreground">
          This result isn't available.
        </p>
      </ChallengeShell>
    );
  }
  const c = e.challenge;
  const sep = c.separate_divisions;
  const rank = sep ? e.rank_div : e.rank;
  const tied = sep ? e.tied_div : e.tied;
  const of = sep ? e.of_div : e.of;
  const top = sep ? e.top_div : e.top;
  const division = c.divisions.find((d) => d.id === e.division_id);
  const gap = gapToFirst(e.score, top, c);

  return (
    <ChallengeShell back={{ to: `/challenges/${slug}`, label: "Leaderboard" }}>
      <div className="text-center">
        <Link
          to="/challenges/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          {c.title} <StatusPill status={c.status} final={c.final} className="h-6" />
        </Link>
        <div className="mt-5 flex justify-center">
          <AthleteAvatar name={e.name} photo={e.photo} size={96} medal={c.final ? rank : null} />
        </div>
        <h1 className="mt-3 text-2xl font-semibold">{e.name}</h1>
        {division ? (
          <p className="text-sm text-muted-foreground">
            {division.name}
            {division.load_label ? ` · ${division.load_label}` : ""}
          </p>
        ) : null}

        {e.status === "disqualified" ? (
          <p className="mx-auto mt-4 max-w-sm rounded-xl bg-muted px-3 py-2 text-sm">
            This entry isn't ranked.
          </p>
        ) : e.score != null ? (
          <>
            <div className="mt-4">
              <ScoreText
                value={e.score}
                shape={c}
                className="text-7xl leading-none"
                unitClassName="text-xl"
              />
            </div>
            <p className="mt-3 text-lg font-semibold">
              {rank === 1 && c.final ? (
                <span className="inline-flex items-center gap-1.5 text-warning">
                  <Trophy className="h-5 w-5" /> {tied ? "Co-champion" : "Champion"}
                </span>
              ) : c.final ? (
                `${placeLabel(rank, tied)} of ${of}`
              ) : (
                `${rankBadge(rank, tied)} of ${of} right now`
              )}
            </p>
            {gap && !(rank === 1) ? <p className="text-sm text-muted-foreground">{gap}</p> : null}
            {!c.final ? (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />{" "}
                {c.status === "verifying"
                  ? "Results are being checked."
                  : "Live: your place can change until results are final."}
              </p>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-success">
                <BadgeCheck className="h-3.5 w-3.5" /> Final, verified result
              </p>
            )}
          </>
        ) : (
          <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-dashed border-border p-5">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Waiting for your set</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This page updates by itself the moment a judge records your score.
            </p>
          </div>
        )}
      </div>

      {e.attempts.filter((a) => !a.tiebreak).length > 1 ? (
        <div className="mx-auto mt-5 flex max-w-sm justify-center gap-2">
          {e.attempts
            .filter((a) => !a.tiebreak)
            .map((a) => (
              <span
                key={`${a.no}-${a.at}`}
                className={
                  a.valid
                    ? "rounded-lg bg-secondary px-3 py-1.5 text-sm"
                    : "rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground line-through"
                }
              >
                {a.valid ? formatScore(a.value, c) : "No lift"}
              </span>
            ))}
        </div>
      ) : null}

      {e.status !== "disqualified" ? (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold">
            {e.score != null ? "Share your result" : "Tell people you're in"}
          </h2>
          <ShareStudio entry={e} />
        </section>
      ) : null}

      <ProfileBox entry={e} />

      <Button asChild variant="outline" className="mt-6 h-11 w-full">
        <Link to="/challenges/$slug" params={{ slug }}>
          See the full leaderboard <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    </ChallengeShell>
  );
}

/** Claim this result into a profile that follows you to every challenge. */
function ProfileBox({ entry }: { entry: EntryPublic }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // from the entry itself, so the server and the phone build the same link
  const here = `/challenges/${entry.challenge.slug}/r/${entry.code}`;
  if (entry.is_mine && entry.handle) {
    return (
      <div className="mt-8 flex items-center gap-3 rounded-2xl border border-border p-4">
        <UserRound className="h-5 w-5 text-muted-foreground" />
        <p className="flex-1 text-sm">This result is on your athlete profile.</p>
        <Button asChild variant="outline" className="h-10">
          <Link to="/athletes/$handle" params={{ handle: entry.handle }}>
            View
          </Link>
        </Button>
      </div>
    );
  }
  if (entry.claimed) {
    return entry.handle ? (
      <div className="mt-8 text-center">
        <Link
          to="/athletes/$handle"
          params={{ handle: entry.handle }}
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          {entry.name}'s athlete profile
        </Link>
      </div>
    ) : null;
  }
  return (
    <div className="mt-8 rounded-2xl border border-border p-5">
      <h2 className="text-base font-semibold">Is this you? Keep it.</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Claim your athlete profile and every challenge you enter lands in one place: your results,
        podiums and bests. Free, with the email you registered with.
      </p>
      {user ? (
        <Button
          className="mt-4 h-11 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await claimProfile();
              if (r.claimed > 0 || r.handle) {
                toast.success("Profile claimed");
                invalidateChallenge(qc);
              } else {
                toast(
                  "Nothing to claim with this login's email. Sign in with the email you registered with.",
                );
              }
            } catch (e) {
              toast.error(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Claim my profile
        </Button>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button asChild className="h-11">
            <Link to="/join">Create a free account</Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to="/auth" search={{ next: here }}>
              Sign in
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
