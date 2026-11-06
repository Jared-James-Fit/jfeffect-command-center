import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Eye, Plus, Share2, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/challenges/ui";
import { fetchAdminList, keys } from "@/lib/challenges/api";
import { eventWhen } from "@/lib/challenges/model";

/** Admin → Challenges: every challenge with its headline numbers, side by side. */
export function AdminChallengesList() {
  const q = useQuery({ queryKey: keys.adminList, queryFn: fetchAdminList, staleTime: 15_000 });
  const all = q.data ?? [];
  const events = all.filter((c) => !c.is_template);
  const templates = all.filter((c) => c.is_template);
  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Challenges</h1>
        <Button asChild className="h-10">
          <Link to="/admin/challenges/new">
            <Plus className="mr-1.5 h-4 w-4" /> New challenge
          </Link>
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          to="/challenges"
          className="inline-flex h-9 items-center rounded-full bg-secondary px-3 text-muted-foreground hover:text-foreground"
        >
          Public Challenges page
        </Link>
      </div>
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : q.error ? (
        <p className="text-sm text-destructive">Couldn't load challenges.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {events.map((c) => (
              <li key={c.id}>
                <Link
                  to="/admin/challenges/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-3 rounded-2xl border border-border p-4 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{c.title}</span>
                      <StatusPill status={c.status} final={c.final} className="h-6" />
                      {c.is_test ? (
                        <span className="rounded-full bg-warning/15 px-2 text-xs text-warning">
                          Test
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {eventWhen(c.starts_at, c.timezone, { withYear: true }) ?? "No date yet"}
                      {c.venue_name ? ` · ${c.venue_name}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {c.registered} registered
                      </span>
                      <span className="flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5" /> {c.competed} scored
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" /> {c.visitors} visitors
                      </span>
                      <span className="flex items-center gap-1">
                        <Share2 className="h-3.5 w-3.5" /> {c.shares} shares
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
            {!events.length ? (
              <li className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No challenges yet.
              </li>
            ) : null}
          </ul>
          {templates.length ? (
            <section className="mt-8">
              <h2 className="mb-2 text-base font-semibold">Templates</h2>
              <ul className="space-y-2">
                {templates.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/admin/challenges/$id"
                      params={{ id: c.id }}
                      className="flex items-center justify-between rounded-2xl border border-border p-4 hover:bg-muted/40"
                    >
                      <span className="font-medium">{c.title}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
