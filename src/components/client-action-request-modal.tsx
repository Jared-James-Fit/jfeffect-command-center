import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listOpenForClientUser,
  markActionSeen,
  markActionCompleted,
  dismissActionForNow,
  getFileSignedUrl,
} from "@/lib/client-action-requests";
import { CheckCircle2, ClipboardList, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export function ClientActionRequestModal({ clientId }: { clientId: string | null | undefined }) {
  const qc = useQueryClient();

  const { data: open = [] } = useQuery({
    queryKey: ["client-actions-for-client", clientId, "open"],
    enabled: !!clientId,
    queryFn: () => listOpenForClientUser(clientId!),
    refetchOnWindowFocus: false,
  });

  const current = open[0] ?? null;

  useEffect(() => {
    if (current && !current.seen_at) {
      markActionSeen(current.id).catch(() => {});
    }
  }, [current?.id]);

  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    setFileUrl(null);
    if (current?.file_path) {
      getFileSignedUrl(current.file_path).then(setFileUrl).catch(() => {});
    }
  }, [current?.id]);

  if (!current) return null;

  async function handleComplete() {
    if (!current) return;
    try {
      await markActionCompleted(current.id);
      toast.success("Marked complete");
      qc.invalidateQueries({ queryKey: ["client-actions-for-client", clientId] });
      qc.invalidateQueries({ queryKey: ["client-action-requests"] });
    } catch (e: any) {
      toast.error(e.message ?? "Could not mark complete");
    }
  }

  function handleLater() {
    if (!current) return;
    dismissActionForNow(current.id);
    qc.invalidateQueries({ queryKey: ["client-actions-for-client", clientId] });
  }

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) handleLater(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{current.title || "Action Needed"}</DialogTitle>
              <DialogDescription className="text-xs">
                From Coach Jared{current.due_date ? ` · Due ${current.due_date}` : ""}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">New</Badge>
          </div>
        </DialogHeader>

        <div className="rounded-2xl bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {current.message}
        </div>

        <p className="text-[11px] text-muted-foreground">
          This will keep popping up each time you open the app until you tap <span className="font-bold">Mark complete</span>.
        </p>

        <div className="space-y-2">
          {current.native_form_id && (current as any).native_form && (
            <Link
              to="/portal/check-ins/$formId"
              params={{ formId: current.native_form_id } as any}
            >
              <Button variant="outline" className="w-full justify-start">
                <ClipboardList className="mr-2 h-4 w-4" />
                Fill: {(current as any).native_form.title}
              </Button>
            </Link>
          )}
          {current.external_form_url && (
            <a href={current.external_form_url} target="_blank" rel="noreferrer">
              <Button variant="outline" className="w-full justify-start">
                <ExternalLink className="mr-2 h-4 w-4" /> Open form
              </Button>
            </a>
          )}
          {current.link_url && (
            <a href={current.link_url} target="_blank" rel="noreferrer">
              <Button variant="outline" className="w-full justify-start">
                <ExternalLink className="mr-2 h-4 w-4" /> {current.link_label || "Open link"}
              </Button>
            </a>
          )}
          {current.file_path && (
            fileUrl ? (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" className="w-full justify-start">
                  <FileText className="mr-2 h-4 w-4" /> {current.file_name ?? "View file"}
                </Button>
              </a>
            ) : (
              <Button variant="outline" className="w-full justify-start" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading file…
              </Button>
            )
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={handleLater}>View Later</Button>
          <Button size="sm" onClick={handleComplete} className="bg-gradient-primary font-bold">
            <CheckCircle2 className="mr-1 h-4 w-4" /> Mark complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}