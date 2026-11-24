/**
 * The cardio plan card in the coach chat (cardio/plan-message.ts): "Your cardio
 * plan has been updated", when it starts, each session in plain words (what,
 * which days, how long, how hard, when against lifting), what changed, and one
 * tap to the plan: the client's Cardio page, or the client's Cardio tab for
 * the coach. Read as it was published (the card is the message).
 */
import { Link } from "@tanstack/react-router";
import { Activity, ChevronRight } from "lucide-react";
import { CLIENT_CARDIO_URL, type CardioMessageAttachment } from "@/lib/cardio/plan-message";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function CardioPlanChatCard({ att, staff, clientId }: { att: CardioMessageAttachment; staff: boolean; clientId: string }) {
  const sessions = Array.isArray(att.sessions) ? att.sessions : [];
  const changes = Array.isArray(att.changes) ? att.changes : [];
  const link = staff
    ? { to: "/admin/clients/$id" as const, params: { id: clientId }, search: { tab: "cardio" } }
    : { to: CLIENT_CARDIO_URL as "/portal/cardio" };
  return (
    <div className="w-[300px] max-w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground" data-chat-card="cardio-plan">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <Activity className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{att.update === "changed" ? "Your cardio plan has been updated" : "Your cardio plan"}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {att.scheduled ? `Starts ${fmtDay(att.effective)}` : "From today"} · {att.weekly_minutes} min a week
          </div>
        </div>
      </div>
      {sessions.length > 0 ? (
        <ul className="divide-y divide-border">
          {sessions.map((s, i) => (
            <li key={i} className="px-3.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{s.title}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{s.minutes} min</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{[s.days, s.settings, s.effort, s.timing].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-2.5 text-[13px] text-muted-foreground">No cardio for now.</p>
      )}
      {changes.length > 0 && (
        <div className="border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">What changed: </span>
          {changes.join(" · ")}
        </div>
      )}
      <Link {...(link as any)} className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-sm font-semibold hover:bg-secondary/40" data-view-cardio-plan>
        {staff ? "Open their cardio" : "View cardio plan"}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
