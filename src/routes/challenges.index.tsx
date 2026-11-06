import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, Trophy, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AthleteAvatar,
  ChallengeShell,
  ScoreText,
  StatusPill,
  useMounted,
} from "@/components/challenges/ui";
import { AppPromo } from "@/components/challenges/challenge-page";
import { fetchHub, mediaUrl, useHub } from "@/lib/challenges/api";
import { eventWhen, type HubChallenge } from "@/lib/challenges/model";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/challenges/")({
  loader: async () => {
    try {
      return { hub: await fetchHub() };
    } catch {
      return { hub: null };
    }
  },
  head: () => ({
    meta: [
      { title: "Fitness Challenges in Winnipeg & Manitoba | JF Effect" },
      {
        name: "description",
        content:
          "Real strength and fitness competitions with live leaderboards and verified results. Enter, compete, and share your result.",
      },
      ...shareMeta({
        title: "JF Effect Challenges",
        description: "Live leaderboards. Verified results. Your name on the board.",
        path: "/challenges",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/challenges" }],
  }),
  component: Hub,
});

function Hub() {
  const { hub: initial } = Route.useLoaderData();
  const q = useHub();
  const list = q.data ?? initial ?? null;
  const groups = useMemo(() => {
    const all = list ?? [];
    return {
      live: all.filter(
        (c) => c.status === "live" || c.status === "paused" || c.status === "verifying",
      ),
      upcoming: all
        .filter((c) => c.status === "upcoming")
        .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? "")),
      past: all.filter((c) => c.status === "completed" || c.status === "archived"),
    };
  }, [list]);

  return (
    <ChallengeShell>
      <h1 className="font-display text-4xl uppercase leading-[0.9] tracking-wide">Challenges</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Real competitions, judged rep by rep, on a live leaderboard.
      </p>

      {!list ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      ) : !list.length ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center">
          <Trophy className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-semibold">The first challenge is on its way</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back soon, or follow JF Effect to hear when sign-ups open.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.live.length ? <Group title="Live now" items={groups.live} live /> : null}
          {groups.upcoming.length ? <Group title="Upcoming" items={groups.upcoming} /> : null}
          {groups.past.length ? <Group title="Completed" items={groups.past} /> : null}
        </div>
      )}
      <AppPromo />
    </ChallengeShell>
  );
}

function Group({ title, items, live }: { title: string; items: HubChallenge[]; live?: boolean }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        {live ? <span className="jf-live-dot h-2 w-2 rounded-full bg-primary" /> : null}
        {title}
        <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <HubCard key={c.id} c={c} />
        ))}
      </div>
    </section>
  );
}

function HubCard({ c }: { c: HubChallenge }) {
  const mounted = useMounted();
  const when = mounted ? eventWhen(c.starts_at, c.timezone) : null;
  const done = c.status === "completed" || c.status === "archived";
  const cover = mediaUrl(c.cover_path);
  const facts = [c.load_label, c.prize_summary].filter(Boolean).join(" · ");
  return (
    <Link
      to="/challenges/$slug"
      params={{ slug: c.slug }}
      search={{}}
      className="flex flex-col rounded-2xl border border-border bg-card p-4 hover:bg-muted/40"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StatusPill status={c.status} final={c.final} />
            {c.starts_at ? <span>{when ?? " "}</span> : <span>Date to be announced</span>}
          </div>
          <h3 className="mt-2 font-display text-2xl uppercase leading-[0.95] tracking-wide">
            {c.title}
          </h3>
          {facts ? <p className="mt-1 text-sm text-muted-foreground">{facts}</p> : null}
        </div>
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-xl object-cover"
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {c.venue_name || c.city ? (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {c.venue_name ?? c.city?.split(",")[0]}
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {c.registered} {done ? "competed" : "registered"}
        </span>
      </div>
      {c.leader ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
          <AthleteAvatar name={c.leader.name} photo={c.leader.photo} size={28} medal={1} />
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted-foreground">
              {done && c.final ? (c.leader.tied ? "Co-winner" : "Winner") : "Leading"}{" "}
            </span>
            <span className="font-semibold">{c.leader.name}</span>
          </span>
          <ScoreText value={c.leader.score} shape={c} className="text-lg" />
        </div>
      ) : null}
    </Link>
  );
}
