/**
 * The nutrition plan card in the coach chat (plan-message.ts): the plan's
 * dates, each day's calories and macros (with how a new plan's calories moved
 * from the one before), and one tap to the plan: the client's Nutrition page,
 * or the client's Nutrition tab for the coach.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIENT_PLAN_URL, kcalChange, type PlanMessageAttachment } from "@/lib/nutrition-targets/plan-message";

export function NutritionPlanChatCard({ att, staff, clientId }: { att: PlanMessageAttachment; staff: boolean; clientId: string }) {
  const days = Array.isArray(att.days) ? att.days : [];
  const link = staff
    ? { to: "/admin/clients/$id" as const, params: { id: clientId }, search: { tab: "nutrition" } }
    : { to: CLIENT_PLAN_URL as "/portal/nutrition-targets" };
  return (
    <div className="w-[300px] max-w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground" data-chat-card="nutrition-plan">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Utensils className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest">
            {att.update === "changed" ? "Plan updated" : "New nutrition plan"}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{[att.period, att.phase].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      {days.length > 0 && (
        <ul className="divide-y divide-border">
          {days.map((d) => {
            const change = kcalChange(d);
            return (
              <li key={d.label} className="px-3.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{d.label}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {d.kcal != null ? `${d.kcal.toLocaleString("en-US")} kcal` : "—"}
                    {change && (
                      <span className={cn("ml-1.5 text-[11px] font-semibold", change.startsWith("+") ? "text-success" : "text-info")}>
                        {change}
                      </span>
                    )}
                  </span>
                </div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  P {d.p ?? "—"} · C {d.c ?? "—"} · F {d.f ?? "—"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        {...(link as any)}
        className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-sm font-bold text-primary hover:bg-secondary/40"
      >
        {staff ? "Open their plan" : "Open my plan"}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
