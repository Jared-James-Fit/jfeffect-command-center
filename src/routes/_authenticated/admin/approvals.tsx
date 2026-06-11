import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listApprovalQueue, approveItem, rejectItem } from "@/lib/media-manager.functions";

export const Route = createFileRoute("/_authenticated/admin/approvals")({
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const list = useServerFn(listApprovalQueue);
  const approve = useServerFn(approveItem);
  const reject = useServerFn(rejectItem);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["approval-queue"], queryFn: () => list() });

  async function handleApprove(kind: any, id: string) {
    try { await approve({ data: { kind, id } }); qc.invalidateQueries({ queryKey: ["approval-queue"] }); toast.success("Approved"); }
    catch (e: any) { toast.error(e.message); }
  }
  async function handleReject(kind: any, id: string) {
    const notes = prompt("Reason for sending back to draft?") || "";
    if (!notes.trim()) return;
    try { await reject({ data: { kind, id, notes } }); qc.invalidateQueries({ queryKey: ["approval-queue"] }); toast.success("Sent back to draft"); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Approvals Queue</h1>
        <p className="text-sm text-muted-foreground">Items submitted by Media Manager awaiting review.</p>
      </header>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      <Section title="Broadcasts" empty="No broadcast drafts awaiting review.">
        {data?.broadcasts?.map((b: any) => (
          <Row key={b.id} title={b.title} sub={new Date(b.submitted_at).toLocaleString()}
               onApprove={() => handleApprove("broadcast", b.id)} onReject={() => handleReject("broadcast", b.id)} />
        ))}
      </Section>

      <Section title="Events" empty="No event drafts awaiting review.">
        {data?.events?.map((e: any) => (
          <Row key={e.id} title={e.name} sub={new Date(e.submitted_at).toLocaleString()}
               onApprove={() => handleApprove("event", e.id)} onReject={() => handleReject("event", e.id)} />
        ))}
      </Section>

      <Section title="Sales Page Edits" empty="No sales page drafts awaiting review.">
        {data?.sales_pages?.map((s: any) => (
          <Row key={s.page_key} title={s.page_key} sub={`Draft: ${JSON.stringify(s.draft_payload || {}).slice(0, 80)}…`}
               onApprove={() => handleApprove("sales_page", s.page_key)} onReject={() => handleReject("sales_page", s.page_key)} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: any) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {!hasChildren && <Card className="p-3 text-sm text-muted-foreground">{empty}</Card>}
      {children}
    </section>
  );
}

function Row({ title, sub, onApprove, onReject }: any) {
  return (
    <Card className="p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{sub}</div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onReject}>Send back</Button>
        <Button size="sm" onClick={onApprove}>Approve</Button>
      </div>
    </Card>
  );
}