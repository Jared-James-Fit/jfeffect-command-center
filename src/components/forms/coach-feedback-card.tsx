import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MessageSquareQuote, ChevronRight } from "lucide-react";

type FeedbackRow = {
  id: string;
  reply_text: string;
  created_at: string;
  form_title: string;
};

/**
 * Lightweight "Coach Feedback" quick view for the client portal.
 * Reads the client's own submissions (RLS-scoped) and the coach replies
 * attached to them — latest first — and opens them in a sheet so the
 * client never leaves Home.
 */
export function CoachFeedbackCard({ clientId }: { clientId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data: feedback = [] } = useQuery({
    queryKey: ["portal-coach-feedback", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<FeedbackRow[]> => {
      const { data: subs } = await (supabase as any)
        .from("nf_submissions")
        .select("id, form:form_id(title)")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(30);
      const ids = (subs ?? []).map((s: any) => s.id);
      if (!ids.length) return [];
      const titleById = new Map<string, string>(
        (subs ?? []).map((s: any) => [s.id, s.form?.title ?? "Form"]),
      );
      const { data: reviews } = await (supabase as any)
        .from("nf_reviews")
        .select("id, submission_id, reply_text, created_at")
        .in("submission_id", ids)
        .order("created_at", { ascending: false });
      return ((reviews ?? []) as any[])
        .filter((r) => (r.reply_text ?? "").trim().length > 0)
        .map((r) => ({
          id: r.id,
          reply_text: r.reply_text as string,
          created_at: r.created_at as string,
          form_title: titleById.get(r.submission_id) ?? "Form",
        }));
    },
  });

  const latest = feedback[0];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <>
      <Card className="p-4 md:p-5">
        <button
          type="button"
          onClick={() => latest && setOpen(true)}
          disabled={!latest}
          className="-m-1 flex w-full items-center gap-3 rounded-lg p-1 text-left transition disabled:cursor-default enabled:hover:bg-muted/40"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <MessageSquareQuote className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black uppercase tracking-widest">Coach Feedback</div>
            {latest ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {latest.form_title} · {fmt(latest.created_at)} — tap to view
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">No coach feedback yet.</p>
            )}
          </div>
          {latest && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl p-4 pt-16 md:p-6 md:pt-16">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle className="text-base font-black uppercase tracking-widest">
              Coach Feedback
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 pb-10">
            {(showAll ? feedback : feedback.slice(0, 1)).map((f) => (
              <Card key={f.id} className="border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                  {f.form_title} Feedback
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{fmt(f.created_at)}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{f.reply_text}</p>
              </Card>
            ))}
            {!showAll && feedback.length > 1 && (
              <Button variant="outline" className="w-full font-bold" onClick={() => setShowAll(true)}>
                View all feedback ({feedback.length})
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
