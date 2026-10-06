/**
 * Staff-only: "N deleted" link above the composer that opens a log of
 * messages an admin silently removed from this chat — what it said, when it
 * was sent and when it was deleted. Admins and the client's coach see it;
 * clients/members never do (RLS) and never see a placeholder.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listMessageDeletions, type MessageDeletion } from "@/lib/messages";

const stamp = (iso: string | null | undefined) => (iso ? format(new Date(iso), "MMM d, yyyy · h:mm a") : "—");

export function deletionsQueryKey(scope: { clientId?: string; groupId?: string }) {
  return ["message-deletions", scope.groupId ? `g:${scope.groupId}` : `c:${scope.clientId}`] as const;
}

export function DeletedMessagesStrip(scope: { clientId?: string; groupId?: string }) {
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: deletionsQueryKey(scope),
    enabled: !!(scope.clientId || scope.groupId),
    queryFn: () => listMessageDeletions(scope),
    staleTime: 30_000,
  });
  if (!rows.length) return null;

  return (
    <>
      <div className="flex justify-center border-t border-border/60 py-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="h-3 w-3" /> {rows.length} deleted · only you can see this
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>Deleted messages</SheetTitle>
            <SheetDescription>Only coaches and admins see this. The client sees nothing where these were.</SheetDescription>
          </SheetHeader>
          <div className="mt-3 space-y-2">
            {rows.map((r: MessageDeletion) => (
              <div key={r.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {r.sender_role === "client" ? "Client" : r.sender_role === "member" ? "Member" : "Coach / Admin"}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">
                  {r.body?.trim()
                    ? r.body
                    : r.attachments?.length
                      ? `Attachment: ${r.attachments[0]?.name ?? r.attachments[0]?.type ?? "file"}`
                      : <span className="italic text-muted-foreground">(empty)</span>}
                </div>
                <div className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <div><span className="font-semibold text-foreground">Sent</span> {stamp(r.original_created_at)}</div>
                  <div><span className="font-semibold text-destructive">Deleted</span> {stamp(r.deleted_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
