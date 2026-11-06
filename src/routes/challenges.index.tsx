import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Gift, MapPin, Trophy, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AthleteAvatar,
  ChallengeCover,
  ChallengeShell,
  ScoreText,
  StatusPill,
  useMounted,
} from "@/components/challenges/ui";
import { fetchHub, useHub } from "@/lib/challenges/api";
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
      <h1 className="font-display text-5xl uppercase leading-[0.9] tracking-wide">Challenges</h1>
      <p className="mt-2 max-w-md text-base text-muted-foreground">
        Real competitions, judged rep by rep, on a live leaderboard. Show up, put a number up, and
        share it.
      </p>

      {!list ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      ) : !list.length ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
          <Trophy className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-semibold">The first challenge is on its way</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back soon, or follow JF Effect to hear when sign-ups open.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.live.length ? <Group title="Live now" items={groups.live} /> : null}
          {groups.upcoming.length ? <Group title="Upcoming" items={groups.upcoming} /> : null}
          {groups.past.length ? <Group title="Past winners" items={groups.past} /> : null}
        </div>
      )}
    </ChallengeShell>
  );
}

function Group({ title, items }: { title: string; items: HubChallenge[] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
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
  return (
    <Link
      to="/challenges/$slug"
      params={{ slug: c.slug }}
      search={{}}
      className="block overflow-hidden rounded-2xl border border-border bg-card"
    >
      <ChallengeCover
        c={c}
        className={c.cover_path ? "aspect-[16/9] rounded-none" : "aspect-[5/2] rounded-none"}
      >
        <div className="absolute left-3 top-3">
          <StatusPill status={c.status} final={c.final} />
        </div>
      </ChallengeCover>
      <div className="p-4">
        <h3 className="font-display text-2xl uppercase leading-none tracking-wide">{c.title}</h3>
        {c.objective ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {c.objective}
            {c.load_label ? ` · ${c.load_label}` : ""}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {when ? (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" /> {when}
            </span>
          ) : null}
          {c.city ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {c.city.split(",")[0]}
            </span>
          ) : null}
          {c.prize_summary ? (
            <span className="flex items-center gap-1">
              <Gift className="h-3.5 w-3.5" /> {c.prize_summary}
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {c.registered} {done ? "competed" : "in"}
          </span>
        </div>
        {c.leader ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
            <AthleteAvatar name={c.leader.name} photo={c.leader.photo} size={28} medal={1} />
            <span className="flex-1 truncate text-sm">
              <span className="text-muted-foreground">
                {done && c.final ? (c.leader.tied ? "Co-winner" : "Winner") : "Leader"}{" "}
              </span>
              <span className="font-semibold">{c.leader.name}</span>
            </span>
            <ScoreText value={c.leader.score} shape={c} className="text-lg" />
          </div>
        ) : null}
      </div>
    </Link>
  );
}
