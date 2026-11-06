import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { mediaUrl, useChallengeMe, useHub } from "@/lib/challenges/api";
import { eventWhen, formatScore, objectiveText, shortDate } from "@/lib/challenges/format";
import type { HubCard } from "@/lib/challenges/types";
import { AppCta, StatusPill } from "./ui";

function ChallengeCard({ c }: { c: HubCard }) {
  const live = c.status === "live" || c.status === "paused";
  const over = c.status === "completed" || c.status === "archived" || c.status === "cancelled";
  return (
    <Link to="/challenges/$slug" params={{ slug: c.slug }} className="group block overflow-hidden rounded-2xl border border-border bg-card">
      {c.cover_path ? (
        <div className="relative bg-muted" style={{ aspectRatio: "16 / 9" }}>
          <img src={mediaUrl(c.cover_path)!} alt="" className="h-full w-full object-cover" loading="lazy" />
          <StatusPill status={c.status} className="absolute left-3 top-3" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 bg-foreground px-4 py-5 text-background">
          <span className="font-display text-3xl uppercase leading-none">{c.title.split(" ").slice(0, 2).join(" ")}</span>
          <StatusPill status={c.status} />
        </div>
      )}
      <div className="space-y-2 p-4">
        <h3 className="text-base font-semibold leading-snug group-hover:underline">{c.title}</h3>
        <p className="text-sm text-muted-foreground">{objectiveText(c)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{over ? shortDate(c.starts_at ?? c.published_at, c.timezone) : (eventWhen(c.starts_at, c.ends_at, c.timezone) ?? "Date TBA")}</span>
          {c.city && <span>{c.city}</span>}
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {c.registered}
          </span>
          {c.prize && !over && <span className="font-semibold text-foreground">{c.prize}</span>}
        </div>
        {c.leader && (live || over) && c.status !== "cancelled" && (
          <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm", over ? "bg-warning/10" : "bg-muted")}>
            <Crown className="h-4 w-4 text-warning" />
            <span className="font-semibold">{c.leader.name}</span>
            <span className="text-muted-foreground">
              {over ? "won" : "leads"} with {formatScore(c.leader.score, c)}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

function Group({ title, items }: { title: string; items: HubCard[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <ChallengeCard key={c.id} c={c} />
        ))}
      </div>
    </section>
  );
}

export function ChallengesHub({ initial, inApp = false }: { initial?: HubCard[]; inApp?: boolean }) {
  const { user } = useAuth();
  const q = useHub(initial);
  const me = useChallengeMe(!!user);
  const [term, setTerm] = useState("");
  const all = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = q.data ?? initial ?? [];
    return t ? list.filter((c) => `${c.title} ${c.city ?? ""} ${c.activity}`.toLowerCase().includes(t)) : list;
  }, [q.data, initial, term]);
  const live = all.filter((c) => c.status === "live" || c.status === "paused" || c.status === "verifying");
  const upcoming = all.filter((c) => c.status === "upcoming");
  const past = all.filter((c) => c.status === "completed" || c.status === "archived" || c.status === "cancelled");
  const mine = me.data?.entries ?? [];

  return (
    <div className="space-y-8">
      {!inApp && (
        <section>
          <h1 className="font-display text-5xl uppercase leading-[0.95]">Challenges</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">Real events, real judges, a live leaderboard. Show up, put up a number, share it.</p>
        </section>
      )}

      {mine.length > 0 && me.data && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Your challenges</h2>
            <Link to="/athletes/$handle" params={{ handle: me.data.handle }} className="text-sm font-semibold text-primary">
              My profile
            </Link>
          </div>
          <ul className="space-y-2">
            {mine.slice(0, 4).map((e) => (
              <li key={e.entry_id}>
                <Link
                  to="/challenges/$slug/$handle"
                  params={{ slug: e.slug, handle: me.data!.handle }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      Bib #{e.bib} · {e.competed ? "See your result" : e.entry_status === "withdrawn" ? "Withdrawn" : "Registered"}
                    </div>
                  </div>
                  <StatusPill status={e.status as HubCard["status"]} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(q.data?.length ?? 0) > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search challenges" className="h-11 pl-9 text-base" />
        </div>
      )}

      <Group title="Live now" items={live} />
      <Group title="Upcoming" items={upcoming} />
      <Group title="Past challenges" items={past} />

      {!q.isLoading && all.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <div className="text-[15px] font-semibold">{term ? "No challenges match that." : "The first challenge is on its way."}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {term ? "Try another word." : "Make a free account and you'll be first to hear when it opens."}
          </p>
        </div>
      )}

      {!inApp && <AppCta />}
    </div>
  );
}
