import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import {
  listContent, schedulePublish, markPublished, returnToEditing, readinessChecklist,
  type ContentRecord,
} from "@/lib/media-content";
import { CheckCircle2, XCircle, Copy, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/media/publishing")({
  component: PublishingPage,
});

function PublishingPage() {
  const qc = useQueryClient();
  const { open } = useContentDrawer();

  const { data, isLoading } = useQuery({
    queryKey: ["media-content-records", "publishing"],
    queryFn: () => listContent({ archived: false, statuses: ["approved", "scheduled", "published"] }),
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["media-content-records"] });

  const copy = async (text: string | null | undefined, label: string) => {
    if (!text) { toast.error(`No ${label} to copy`); return; }
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader title="Publishing Queue"
        description="Approved content ready to schedule or publish. Manual publishing — no automatic posting." />

      <Card className="mb-4 bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>Manual publish steps:</strong> Copy caption → Open or download final asset → Open the platform →
        Publish manually → Mark Published.
      </Card>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : (data ?? []).length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing approved yet. Approve content in the pipeline to schedule it here.
        </Card>
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((r) => (
            <PublishingRow key={r.id} r={r}
              onOpen={() => open(r.id)}
              onSchedule={async () => {
                if (!r.publish_date) { toast.error("Set publish date in the drawer first"); open(r.id); return; }
                try { await schedulePublish(r.id, r.publish_date, r.publish_time); toast.success("Scheduled"); refresh(); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
              onMarkPublished={async () => {
                try { await markPublished(r.id); toast.success("Marked published"); refresh(); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
              onReturn={async () => {
                try { await returnToEditing(r.id); toast.success("Returned to editing"); refresh(); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
              onCopyCaption={() => copy(r.caption, "Caption")}
              onCopyCta={() => copy(r.cta, "CTA")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishingRow({ r, onOpen, onSchedule, onMarkPublished, onReturn, onCopyCaption, onCopyCta }: {
  r: ContentRecord; onOpen: () => void; onSchedule: () => void; onMarkPublished: () => void;
  onReturn: () => void; onCopyCaption: () => void; onCopyCta: () => void;
}) {
  const checks = readinessChecklist(r);
  const ready = checks.every((c) => c.ok);
  const firstLink = (r.reference_links ?? [])[0] as string | undefined;

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        {r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-16 w-24 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="text-left">
            <div className="truncate font-medium">{r.title}</div>
            <div className="text-xs text-muted-foreground">
              {r.platform ?? "—"}{r.publish_date ? ` · ${r.publish_date}${r.publish_time ? ` ${r.publish_time}` : ""}` : ""}
            </div>
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge variant={r.production_status === "scheduled" ? "default" : r.production_status === "published" ? "secondary" : "outline"}>
              {r.production_status}
            </Badge>
            {checks.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-0.5 text-[10px]">
                {c.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}
                <span className={c.ok ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{c.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={onOpen}>Open</Button>
        <Button size="sm" variant="outline" onClick={onSchedule} disabled={r.production_status === "published"}>
          {r.production_status === "scheduled" ? "Reschedule" : "Schedule"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCopyCaption}>
          <Copy className="mr-1 h-3 w-3" /> Caption
        </Button>
        <Button size="sm" variant="outline" onClick={onCopyCta}>
          <Copy className="mr-1 h-3 w-3" /> CTA
        </Button>
        {firstLink && (
          <a href={firstLink} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3 w-3" /> Link</Button>
          </a>
        )}
        <Button size="sm" variant="default" onClick={onMarkPublished} disabled={!ready && r.production_status !== "scheduled"}>
          Mark Published
        </Button>
        <Button size="sm" variant="ghost" onClick={onReturn}>Return to Editing</Button>
      </div>
    </Card>
  );
}