import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2, PenLine, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { povLogFn, type PovLogEntry } from "@/lib/pov/pov-session.functions";

const KIND_WORDS: Record<string, string> = {
  start: "Opened",
  view: "Looked at",
  edit_on: "Switched on edits",
  edit_off: "Edits off",
  write: "Changed",
  blocked: "Stopped (view only)",
  end: "Closed",
  expired: "Timed out",
};

/**
 * Who opened this account with View as, when, why, what they looked at and what they changed
 * (admin_pov_log: an admin sees every view; a coach sees their own).
 */
export function PovAccessLogDialog({ clientId, name, open, onOpenChange }: { clientId: string; name: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const fn = useServerFn(povLogFn);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pov-log", clientId],
    enabled: open,
    queryFn: () => fn({ data: { clientId, limit: 30 } }),
    staleTime: 15_000,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account access</DialogTitle>
          <DialogDescription>Every time someone opened {name ?? "this"} account with View as, and what they did.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid h-24 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load the access record.</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Nobody has opened this account with View as.</p>
        ) : (
          <ul className="space-y-2" data-pov-log>
            {data.map((s) => (
              <SessionRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SessionRow({ s }: { s: PovLogEntry }) {
  const changes = s.events.filter((e) => e.kind === "write" || e.kind === "blocked");
  return (
    <li className="rounded-xl border p-3 text-sm">
      <div className="flex items-center gap-2">
        {s.edited ? <PenLine className="h-4 w-4 text-amber-600" aria-hidden /> : <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />}
        <span className="font-medium">{s.staff_name}</span>
        <span className="ml-auto text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        “{s.reason}” · {s.views} page{s.views === 1 ? "" : "s"} · {s.writes} change{s.writes === 1 ? "" : "s"}
        {s.ended_at ? ` · ${s.end_reason === "expired" ? "timed out" : "closed"} ${new Date(s.ended_at).toLocaleTimeString()}` : " · still open"}
      </div>
      {changes.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-muted/50 p-2 text-xs">
          {changes.slice(0, 12).map((e, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {e.kind === "blocked" && <ShieldAlert className="h-3 w-3 text-muted-foreground" aria-hidden />}
              <span>{KIND_WORDS[e.kind] ?? e.kind}</span>
              <span className="truncate text-muted-foreground">{e.detail?.target ?? e.detail?.path ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
