/**
 * The one system card Cleo Autopilot posts when a change goes live (autopilot/publish.ts
 * `systemCard`): "Your nutrition targets have been updated." with each change before → after,
 * from when, and one tap to the plan (the client's own page; the coach's copy opens the
 * client's tab). Deterministic words, never in the coach's first person. Read as it was posted.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { AutopilotCardAttachment } from "@/lib/autopilot/publish";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function AutopilotUpdateChatCard({ att, staff, clientId }: { att: AutopilotCardAttachment & { rollback?: boolean }; staff: boolean; clientId: string }) {
  const changes = Array.isArray(att.changes) ? att.changes : [];
  const first = changes[0]?.domain ?? "nutrition";
  const link = staff
    ? { to: "/admin/clients/$id" as const, params: { id: clientId }, search: { tab: first } }
    : { to: (att.open?.url ?? "/portal/nutrition-targets") as "/portal/nutrition-targets" };
  return (
    <div className="w-[300px] max-w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground" data-chat-card="autopilot-update">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <RefreshCw className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{att.title}</div>
          {att.effective && <div className="truncate text-[11px] text-muted-foreground">From {fmtDay(att.effective)}</div>}
        </div>
      </div>
      {changes.length > 0 && (
        <ul className="divide-y divide-border">
          {changes.map((c, i) => (
            <li key={i} className="px-3.5 py-2">
              <div className="text-sm font-semibold">{c.label}</div>
              {c.before && <div className="text-[11px] text-muted-foreground line-through decoration-muted-foreground/50">{c.before}</div>}
              {c.after && <div className="text-[12px]">{c.after}</div>}
            </li>
          ))}
        </ul>
      )}
      <Link {...(link as any)} className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-sm font-semibold hover:bg-secondary/40" data-open-plan>
        {staff ? "Open their plan" : att.open?.label ?? "Open my plan"}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
