/**
 * Leads (/admin/leads): everyone who applied for coaching, the ones waiting
 * on you first (a first text to send, or a follow-up that's due), then the
 * ones who started applying and stopped, then everyone earlier. `?id=` opens
 * and scrolls to one lead (the push, the SMS / email alert, Home's card).
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { leadLine, leadNeeds, leadStage } from "@/lib/coaching-leads";
import { DraftLeadCard, LeadCard } from "@/components/leads/lead-card";
import { useLeads } from "@/components/leads/use-leads";

export function LeadsPage({ focusId }: { focusId?: string }) {
  const { leads, drafts, bookingUrl, isLoading, enabled } = useLeads();
  const [openEarlier, setOpenEarlier] = useState<string | null>(null);
  const now = Date.now();
  const waiting = leads.filter((l) => leadNeeds(l.app, now));
  const earlier = leads.filter((l) => !leadNeeds(l.app, now));

  // Open the lead a link points at, wherever it sits.
  useEffect(() => {
    if (!focusId || !leads.length) return;
    if (earlier.some((l) => l.app.id === focusId)) setOpenEarlier(focusId);
    const t = window.setTimeout(() => document.getElementById(`lead-${focusId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, leads.length]);

  return (
    <>
      <PageHeader title="Leads" backTo="/admin/communication" backLabel="Messages" />
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}>
        {!enabled ? (
          <p className="text-sm text-muted-foreground">Leads are for the admin login.</p>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-[16px] font-semibold">Waiting on you{waiting.length ? ` · ${waiting.length}` : ""}</h2>
              {waiting.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">Nobody's waiting. New applications show up here with a text ready to send.</p>
              ) : (
                waiting.map(({ app, reply }) => <LeadCard key={app.id} app={app} reply={reply} focused={app.id === focusId} />)
              )}
            </section>

            {drafts.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[16px] font-semibold">Started, didn't finish · {drafts.length}</h2>
                {drafts.map((d) => <DraftLeadCard key={d.id} draft={d} bookingUrl={bookingUrl} />)}
              </section>
            )}

            {earlier.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-[16px] font-semibold">Earlier</h2>
                <div className="divide-y divide-border rounded-2xl border border-border">
                  {earlier.map(({ app, reply }) => {
                    const open = openEarlier === app.id;
                    const stage = leadStage(app);
                    return (
                      <div key={app.id}>
                        <button
                          type="button"
                          onClick={() => setOpenEarlier(open ? null : app.id)}
                          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{app.full_name || "Someone"}</span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {[leadLine(app), new Date(app.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className={cn("shrink-0 text-[12px] font-semibold", stage.tone === "done" ? "text-success" : "text-muted-foreground")}>{stage.label}</span>
                          {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </button>
                        {open && (
                          <div className="p-2 pt-0">
                            <LeadCard app={app} reply={reply} focused={app.id === focusId} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
