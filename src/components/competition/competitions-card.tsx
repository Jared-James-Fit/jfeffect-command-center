/**
 * Competitions across every athlete, on the coach's dashboard and pinned in
 * Messages (Nov 24 2026): what needs the coach first (approvals, unread
 * assessments, interventions, unacknowledged game plans, a strategy call
 * worth booking, a meet in the next two days), then everyone by phase. Hidden
 * when nobody's preparing for a meet; read with the coach's own login, so a
 * coach only ever sees their own athletes.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { getCompetitionOverviewFn } from "@/lib/competition/competition.functions";
import { competitionOverview } from "@/lib/competition/overview";
import { countdownWords } from "@/lib/competition/milestones";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { CHAT_ROW_AVATAR, ChatListRow } from "@/components/messages/chat-list-row";
import { cn } from "@/lib/utils";

export function useCompetitionOverview() {
  const read = useServerFn(getCompetitionOverviewFn);
  const q = useQuery({
    queryKey: ["competition-overview"],
    queryFn: () => read(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const view = q.data
    ? competitionOverview({
        today: q.data.today,
        competitions: q.data.competitions as any,
        assessments: q.data.assessments as any,
      })
    : null;
  return { q, view };
}

const href = (i: {
  clientId: string;
  competitionId: string;
  assessmentId: string | null;
  kind: string;
}) =>
  i.kind === "meet_day"
    ? {
        to: "/admin/competition/$competitionId" as const,
        params: { competitionId: i.competitionId },
      }
    : {
        to: "/admin/clients/$id" as const,
        params: { id: i.clientId },
        search: {
          tab: "competition",
          competition: i.competitionId,
          ...(i.assessmentId ? { assessment: i.assessmentId } : {}),
        },
      };

export function CompetitionsCard() {
  const { view } = useCompetitionOverview();
  if (!view || !view.byPhase.length) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-competitions-card>
      <div className="mb-3 flex items-center gap-2">
        <CleoAvatar size="sm" />
        <div>
          <h2 className="text-[16px] font-semibold">Competitions</h2>
          <p className="text-[12px] text-muted-foreground">
            {view.needsYou
              ? `${view.needsYou} need${view.needsYou === 1 ? "s" : ""} you`
              : "Nothing waiting on you"}{" "}
            · {view.byPhase.length} preparing
          </p>
        </div>
      </div>
      {view.items.length ? (
        <ul className="divide-y divide-border">
          {view.items.slice(0, 6).map((i, n) => (
            <li key={`${i.kind}:${i.assessmentId ?? i.competitionId}:${n}`}>
              <Link
                {...(href(i) as any)}
                className="flex items-center gap-2 py-2 text-[14px] hover:opacity-80"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    i.urgent
                      ? "bg-destructive"
                      : i.unread
                        ? "bg-[#0095f6]"
                        : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.athlete}</span>
                  <span className="text-muted-foreground"> · {i.title}</span>
                  {i.detail ? (
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {i.detail}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {countdownWords(i.daysOut)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-muted-foreground">Everyone by phase</summary>
        <ul className="mt-2 space-y-1">
          {view.byPhase.map((c) => (
            <li key={c.id}>
              <Link
                to="/admin/clients/$id"
                params={{ id: c.client_id }}
                search={{ tab: "competition", competition: c.id } as any}
                className="flex flex-wrap justify-between gap-2 hover:opacity-80"
              >
                <span>
                  <span className="font-medium">{c.athlete}</span> · {c.name}
                </span>
                <span className="text-muted-foreground">
                  {c.phaseLabel} · {countdownWords(c.daysOut)}
                  {c.live?.total ? ` · ${c.live.total.expected} kg` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Pinned in Messages under the Coaching queue while a competition needs the coach. */
export function CompetitionsInboxRow() {
  const navigate = useNavigate();
  const { view } = useCompetitionOverview();
  const top = view?.items.find((i) => i.kind !== "meet_day" && i.kind !== "call") ?? null;
  if (!view || !top) return null;
  return (
    <ChatListRow
      data-competitions-row
      avatar={
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: CHAT_ROW_AVATAR, height: CHAT_ROW_AVATAR }}
        >
          <CleoAvatar size="lg" />
        </span>
      }
      name="Competitions"
      preview={`${top.athlete}: ${top.title}${top.detail ? ` · ${top.detail}` : ""}`}
      at={null}
      unread={view.unread > 0 || top.urgent}
      unreadLabel={`${view.needsYou} waiting`}
      after={
        view.needsYou > 1 ? (
          <span className="text-[13px] font-semibold text-muted-foreground">{view.needsYou}</span>
        ) : undefined
      }
      onClick={() => navigate(href(top) as any)}
    />
  );
}
