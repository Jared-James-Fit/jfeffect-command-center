import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MEMBERS_KEY } from "@/components/members/members-directory";
import { RESTORE_DAYS, deletesInLabel } from "@/lib/recently-deleted";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  source: "self" | "admin";
  reason: string | null;
  requested_at: string;
  purge_after: string;
  client_id: string | null;
  member_id: string | null;
};

const KEY = ["recently-deleted"] as const;

function useRecentlyDeleted(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any)
        .from("account_deletions")
        .select("id, name, email, source, reason, requested_at, purge_after, client_id, member_id")
        .eq("status", "pending")
        .order("purge_after", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
}

/**
 * Recently deleted, iMessage's way: a row at the end of the accounts list
 * (admins only, and only while something's in it) that opens every account
 * waiting out its 30 days, soonest first, each with Restore. There is no
 * "Delete now": only the 30 days delete an account for good.
 */
export function RecentlyDeletedRow({ className }: { className?: string }) {
  const { role, viewOnly } = useAuth();
  const isAdmin = role === "admin";
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useRecentlyDeleted(isAdmin);
  if (!isAdmin || rows.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:bg-muted/40",
          className,
        )}
        data-recently-deleted-row
      >
        <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-[15px] font-medium">Recently deleted</span>
        <span className="text-[14px] tabular-nums text-muted-foreground">{rows.length}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <RecentlyDeletedSheet open={open} onOpenChange={setOpen} rows={rows} canRestore={!viewOnly} />
    </>
  );
}

function RecentlyDeletedSheet({
  open,
  onOpenChange,
  rows,
  canRestore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: Row[];
  canRestore: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const restore = async (r: Row) => {
    setBusy(r.id);
    try {
      const { data, error } = await (supabase as any).rpc("account_delete_restore", { _id: r.id });
      if (error) throw error;
      if (!data) throw new Error("It's no longer in Recently deleted.");
      toast.success(`${r.name ?? r.email ?? "Account"} is restored. Everything is back as it was.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEY }),
        qc.invalidateQueries({ queryKey: ["clients-directory"] }),
        qc.invalidateQueries({ queryKey: MEMBERS_KEY }),
        qc.invalidateQueries({ queryKey: ["admin-members"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't restore it. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] px-0 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 sm:mx-auto sm:max-w-lg"
      >
        <SheetHeader className="space-y-1 px-5 pb-3 text-left">
          <SheetTitle>Recently deleted</SheetTitle>
          <SheetDescription>
            Accounts wait here {RESTORE_DAYS} days before they're deleted for good. Restore puts
            everything back.
          </SheetDescription>
        </SheetHeader>
        <ul className="border-t border-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">
                  {r.name || r.email || "Account"}
                </div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {r.source === "self" ? "Deleted it themselves" : "Deleted by an admin"} ·{" "}
                  {format(new Date(r.requested_at), "MMM d")}
                  {r.client_id ? " · Client" : r.member_id ? " · Member" : ""}
                </div>
                {r.reason && (
                  <div className="mt-0.5 line-clamp-2 text-[13px] text-foreground/80">
                    "{r.reason}"
                  </div>
                )}
                <div className="mt-0.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                  {deletesInLabel(r.purge_after)}
                </div>
              </div>
              {canRestore && (
                <Button
                  variant="outline"
                  className="h-10 shrink-0"
                  disabled={busy === r.id}
                  onClick={() => void restore(r)}
                >
                  {busy === r.id ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
                  )}
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
