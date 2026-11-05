import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { REPORT_REASONS } from "@/components/community/report-sheet";

export type OpenReport = {
  target_kind: "post" | "comment" | "program" | "profile";
  target_id: string;
  owner: { name?: string | null; username?: string | null; avatar_url?: string | null } | null;
  reports: number;
  reasons: string[];
  details: string[] | null;
  snapshot: Record<string, any> | null;
  last_at: string;
};

export const OPEN_REPORTS_KEY = ["community-reports-open"] as const;

/** Staff: everything reported in Crew that's still open (community_reports_open returns [] for anyone else). */
export function useOpenReports(enabled = true) {
  return useQuery({
    queryKey: OPEN_REPORTS_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<OpenReport[]> => {
      const { data, error } = await (supabase as any).rpc("community_reports_open");
      if (error) throw error;
      return (data ?? []) as OpenReport[];
    },
  });
}

const KIND: Record<OpenReport["target_kind"], string> = {
  post: "Post",
  comment: "Comment",
  program: "Program",
  profile: "Account",
};
const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.id === r)?.label ?? r;

/** What was reported, as it read when it was reported. */
function snapshotText(r: OpenReport): string {
  const s = r.snapshot ?? {};
  if (r.target_kind === "post")
    return (
      s.caption ||
      (s.media_type
        ? `(${s.media_type === "video" ? "a clip" : "a photo"} with no caption)`
        : "(no words)")
    );
  if (r.target_kind === "comment") return s.body || "";
  if (r.target_kind === "program") return [s.title, s.description].filter(Boolean).join(" · ");
  return s.name ? `${s.name}${s.username ? ` (@${s.username})` : ""}` : "";
}

/**
 * The team's review of Crew reports. Remove takes it out of Crew (a post goes
 * to its author's archive, a comment is hidden, a program taken down);
 * Dismiss leaves it. Who reported is never shown here or to the author.
 */
export function ReportsReviewSheet({
  open,
  onOpenChange,
  onOpenPost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPost?: (postId: string) => void;
}) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useOpenReports(open);
  const resolve = useMutation({
    mutationFn: async ({ r, action }: { r: OpenReport; action: "remove" | "dismiss" }) => {
      const { error } = await (supabase as any).rpc("community_report_resolve", {
        _kind: r.target_kind,
        _target: r.target_id,
        _action: action,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === "remove" ? "Removed from Crew" : "Dismissed");
      void qc.invalidateQueries({ queryKey: OPEN_REPORTS_KEY });
      void qc.invalidateQueries({ queryKey: ["community"] });
    },
    onError: () => toast.error("Couldn't do that. Try again."),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Reports</SheetTitle>
          <SheetDescription>
            What people reported in Crew. They're never told who reported them.
          </SheetDescription>
        </SheetHeader>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : !data.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing to review.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.map((r) => (
              <li
                key={`${r.target_kind}:${r.target_id}`}
                className="rounded-2xl border border-border p-4"
              >
                <div className="flex items-center gap-2">
                  <UserAvatar
                    src={r.owner?.avatar_url ?? null}
                    name={r.owner?.name ?? "?"}
                    size={28}
                    expandable={false}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">
                      {r.owner?.username ? `@${r.owner.username}` : (r.owner?.name ?? "Someone")}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {KIND[r.target_kind]} · {r.reports} {r.reports === 1 ? "report" : "reports"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.reasons.map((x) => (
                    <span key={x} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {reasonLabel(x)}
                    </span>
                  ))}
                </div>
                {snapshotText(r) && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-[14px]">
                    {snapshotText(r)}
                  </p>
                )}
                {!!r.details?.length && (
                  <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
                    {r.details.map((d, i) => (
                      <li key={i}>“{d}”</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.target_kind === "post" && onOpenPost && (
                    <Button size="sm" variant="ghost" onClick={() => onOpenPost(r.target_id)}>
                      Open post
                    </Button>
                  )}
                  {r.target_kind !== "profile" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ r, action: "remove" })}
                    >
                      Remove
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ r, action: "dismiss" })}
                  >
                    {r.target_kind === "profile" ? "Done" : "Dismiss"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
