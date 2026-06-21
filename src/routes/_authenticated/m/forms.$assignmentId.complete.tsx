import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, AlertCircle, Home } from "lucide-react";
import { toast } from "sonner";

/**
 * Landing page Fillout redirects to after submission. We poll for the
 * webhook-written nf_submissions row for ~15s. If it doesn't appear, the
 * client can manually "Confirm Submission" which records a client-confirmed
 * (not webhook-verified) submission.
 */
export const Route = createFileRoute(
  "/_authenticated/m/forms/$assignmentId/complete",
)({
  component: FormCompletePage,
});

function FormCompletePage() {
  const { assignmentId } = Route.useParams();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const { data: assignment } = useQuery({
    queryKey: ["nf-assignment", assignmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("nf_assignments")
        .select("id, form_id, client_id, form:form_id(id, title, recurrence, recurrence_day)")
        .eq("id", assignmentId)
        .maybeSingle();
      return data;
    },
  });

  const { data: submission, refetch } = useQuery({
    queryKey: ["nf-submission-by-assignment", assignmentId, attempts],
    enabled: !!assignment,
    queryFn: async () => {
      const { data } = await supabase
        .from("nf_submissions")
        .select("id, status, submitted_at, verification_source, client_confirmed_at, fillout_submission_id")
        .eq("assignment_id", assignmentId)
        .in("status", ["submitted", "pending_review", "reviewed"])
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const isSubmitted = !!submission;

  // Poll up to 10 times (15s) for the webhook to land.
  useEffect(() => {
    if (isSubmitted) return;
    if (attempts >= 10) return;
    const t = setTimeout(() => {
      setAttempts((a) => a + 1);
      refetch();
    }, 1500);
    return () => clearTimeout(t);
  }, [attempts, isSubmitted, refetch]);

  async function confirmManually() {
    if (!assignment) return;
    setConfirming(true);
    try {
      const { error } = await supabase.from("nf_submissions").insert({
        form_id: (assignment as any).form_id,
        client_id: (assignment as any).client_id,
        assignment_id: assignmentId,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        client_confirmed_at: new Date().toISOString(),
        verification_source: "client_confirmed",
      });
      if (error) throw error;
      toast.success("Submission recorded");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not record submission");
    } finally {
      setConfirming(false);
    }
  }

  const title = (assignment as any)?.form?.title ?? "Form";

  return (
    <>
      <PageHeader title="Form Submitted" backTo="/m" backLabel="Home" />
      <div className="mx-auto max-w-xl space-y-4 p-4 md:p-8">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            {isSubmitted ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500" />
            ) : attempts >= 10 ? (
              <AlertCircle className="mt-0.5 h-6 w-6 text-amber-500" />
            ) : (
              <Loader2 className="mt-0.5 h-6 w-6 animate-spin text-primary" />
            )}
            <div className="flex-1">
              <div className="text-lg font-black">
                {isSubmitted
                  ? "Check-In Submitted"
                  : attempts >= 10
                    ? "Awaiting Verification"
                    : "Syncing your submission…"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {isSubmitted
                  ? "Your response has been sent to your coach."
                  : attempts >= 10
                    ? "We didn't receive confirmation from the form provider. If you completed it, confirm below — your coach will review."
                    : `Recording your ${title} response…`}
              </div>
              {isSubmitted && (submission as any)?.verification_source && (
                <Badge variant="outline" className="mt-3">
                  {(submission as any).verification_source === "fillout_webhook"
                    ? "Verified submission"
                    : (submission as any).verification_source === "client_confirmed"
                      ? "Client-confirmed submission"
                      : (submission as any).verification_source}
                </Badge>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          {!isSubmitted && attempts >= 10 && (
            <Button onClick={confirmManually} disabled={confirming} className="bg-gradient-primary font-bold">
              {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm Submission
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate({ to: "/m" })}>
            <Home className="mr-1 h-4 w-4" /> Return Home
          </Button>
          {isSubmitted && (
            <Button variant="ghost" asChild>
              <Link to="/portal/check-ins">View Responses</Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}