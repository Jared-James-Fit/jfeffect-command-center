import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import type { WorkspaceAlert } from "./types";

const TONE_TO_CLASS: Record<string, string> = {
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  primary: "border-primary/40 bg-primary/10 text-primary",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

export function WorkspaceAlertsStrip({ alerts, className }: { alerts: WorkspaceAlert[]; className?: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className={className ?? "mb-4 space-y-2"}>
      {alerts.map((a) => {
        const Icon = a.icon ?? AlertCircle;
        const tone = TONE_TO_CLASS[a.tone] ?? TONE_TO_CLASS.warn;
        const body = (
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-semibold ${tone}`}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">{a.message}</span>
              </span>
              {a.description && (
                <span className="min-w-0 text-xs font-normal opacity-90">{a.description}</span>
              )}
            </span>
            {a.action && (
              a.action.to ? (
                <Link
                  to={a.action.to as any}
                  params={a.action.params as any}
                  className="shrink-0 text-xs underline underline-offset-2 hover:opacity-80"
                >
                  {a.action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={a.action.onClick}
                  className="shrink-0 text-xs underline underline-offset-2 hover:opacity-80"
                >
                  {a.action.label}
                </button>
              )
            )}
          </div>
        );
        return <div key={a.key}>{body}</div>;
      })}
    </div>
  );
}