/**
 * A competition update in the coach chat (competition/release.server.ts): the
 * game plan or a preparation update, one tap to the athlete's Competition
 * page (or, for the coach, the client's Competition tab on that assessment).
 * An automated update says it's automated; "from your coach" is said only for
 * what the coach approved.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, Trophy } from "lucide-react";

export type CompetitionUpdateAttachment = {
  kind: "competition_update";
  assessment_id: string;
  competition_id: string;
  milestone: string;
  version: number;
  title: string;
  summary: string;
  meet: string | null;
  meet_date: string | null;
  automated: boolean;
  plan: boolean;
  needs_ack: boolean;
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

export function CompetitionUpdateChatCard({
  att,
  staff,
  clientId,
}: {
  att: CompetitionUpdateAttachment;
  staff: boolean;
  clientId: string;
}) {
  const link = staff
    ? {
        to: "/admin/clients/$id" as const,
        params: { id: clientId },
        search: {
          tab: "competition",
          competition: att.competition_id,
          assessment: att.assessment_id,
        },
      }
    : { to: "/portal/competition" as const, search: { update: att.assessment_id } };
  return (
    <div
      className="w-[300px] max-w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground"
      data-chat-card="competition-update"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <Trophy className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{att.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {[
              att.meet,
              fmt(att.meet_date),
              att.automated ? "Automated update" : att.plan ? "Game plan" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
      {att.summary ? (
        <p className="line-clamp-4 px-3.5 py-2.5 text-[13px] text-muted-foreground">
          {att.summary}
        </p>
      ) : null}
      <Link
        {...(link as any)}
        className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-sm font-semibold hover:bg-secondary/40"
        data-open-competition-update
      >
        {staff
          ? "Open in their Competition tab"
          : att.plan
            ? "Review your game plan"
            : "Read the update"}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
