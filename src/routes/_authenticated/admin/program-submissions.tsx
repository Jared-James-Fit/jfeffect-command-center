import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Check, X, MessageSquare, ExternalLink, Inbox } from "lucide-react";
import { listPendingSubmissions, decideSubmission, destinationLabel } from "@/lib/programs/sharing";

export const Route = createFileRoute("/_authenticated/admin/program-submissions")({
  component: ProgramSubmissions,
});

function ProgramSubmissions() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "team_submission" | "membership_submission" | "public_submission">("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["pl-pending-submissions"],
    queryFn: listPendingSubmissions,
  });
  const filtered = tab === "all" ? data : (data as any[]).filter((s) => s.destination === tab);

  return (
    <>
      <PageHeader title="Coach Submissions" subtitle="Review programs coaches have submitted for publication" />
      <div className="p-6 md:p-8 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All ({(data as any[]).length})</TabsTrigger>
            <TabsTrigger value="team_submission">Team</TabsTrigger>
            <TabsTrigger value="membership_submission">Membership</TabsTrigger>
            <TabsTrigger value="public_submission">Public</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <Card className="p-12 text-center">
                <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">No submissions awaiting review.</p>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((s: any) => (
                  <SubmissionCard
                    key={s.id}
                    submission={s}
                    onChanged={() => qc.invalidateQueries({ queryKey: ["pl-pending-submissions"] })}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function SubmissionCard({ submission, onChanged }: { submission: any; onChanged: () => void }) {
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const t = submission.template;

  const decide = async (decision: "approved" | "rejected" | "changes_requested") => {
    try {
      await decideSubmission(submission.id, decision, notes.trim() || null);
      toast.success(
        decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Changes requested",
      );
      setNotes("");
      setShowNotes(false);
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "Could not save decision");
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{t?.name ?? "Untitled program"}</div>
          <div className="text-xs text-muted-foreground">
            Submitted to {destinationLabel(submission.destination)} · v{submission.shared_version}
          </div>
        </div>
        <Badge variant={submission.status === "changes_requested" ? "secondary" : "default"}>
          {submission.status === "changes_requested" ? "Changes Requested" : "Pending"}
        </Badge>
      </div>

      {submission.notes && (
        <div className="mt-3 rounded-md border bg-secondary/30 p-2 text-xs">
          <MessageSquare className="mr-1 inline h-3 w-3" /> {submission.notes}
        </div>
      )}

      {showNotes && (
        <Textarea
          className="mt-3"
          rows={2}
          placeholder="Feedback for the coach (optional)…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/program-library/$templateId" params={{ templateId: submission.template_id }}>
            <ExternalLink className="mr-1 h-3 w-3" /> Open
          </Link>
        </Button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowNotes((s) => !s)}>
            <MessageSquare className="mr-1 h-3 w-3" /> Notes
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide("changes_requested")}>
            Request Changes
          </Button>
          <Button size="sm" variant="destructive" onClick={() => decide("rejected")}>
            <X className="mr-1 h-3 w-3" /> Reject
          </Button>
          <Button size="sm" onClick={() => decide("approved")}>
            <Check className="mr-1 h-3 w-3" /> Approve
          </Button>
        </div>
      </div>
    </Card>
  );
}