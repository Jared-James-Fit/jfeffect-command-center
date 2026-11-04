/**
 * Home's leads card (admin): who applied for coaching and is waiting on you
 * (a first text to send, or a follow-up that's due), each with one tap to
 * copy the text the AI wrote. Hidden when nobody's waiting.
 */
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Loader2, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { chatAge } from "@/components/messages/chat-list-row";
import { firstNameOf, leadLine, leadNeeds } from "@/lib/coaching-leads";
import { markLeadFn } from "@/lib/coaching-leads.functions";
import { useLeads } from "@/components/leads/use-leads";

export function NewLeadsCard() {
  const { waiting, enabled } = useLeads();
  const mark = useServerFn(markLeadFn);
  if (!enabled || waiting.length === 0) return null;
  return (
    <Card className="p-4" data-new-leads>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          {waiting.length === 1 ? "1 lead waiting on you" : `${waiting.length} leads waiting on you`}
        </h2>
        <Link to="/admin/leads" className="shrink-0 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          All leads →
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {waiting.slice(0, 3).map(({ app, reply }) => {
          const needs = leadNeeds(app);
          const text = needs === "follow_up" ? reply?.follow_up : reply?.reply;
          const writing = reply?.status === "pending" || reply?.status === "generating";
          return (
            <li key={app.id} className="flex items-center gap-3 py-2.5">
              <Link to="/admin/leads" search={{ id: app.id }} className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{app.full_name || "Someone"}</span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {needs === "follow_up" ? "No answer yet · follow up" : leadLine(app)}
                  {` · ${chatAge(needs === "follow_up" ? app.follow_up_at : app.created_at)}`}
                </span>
                {reply?.brief?.read && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug">{reply.brief.read}</span>}
              </Link>
              {writing ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Writing the text" />
              ) : text ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      toast.success(`Copied. Paste it to ${firstNameOf(app) || "them"}.`);
                      void mark({ data: { applicationId: app.id, action: "copied" } });
                    } catch {
                      toast.error("Couldn't copy. Open the lead to copy it.");
                    }
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4" /> Copy text
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
