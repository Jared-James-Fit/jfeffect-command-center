import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Send } from "lucide-react";
import { listFormsForClient, pickNutritionUpdateForm } from "@/lib/native-forms";
import { listActionCentre, type ActionCentreItem } from "@/lib/action-centre.functions";
import { usePortalUserId } from "@/lib/client-impersonation";
import { ClientFormSheet } from "@/components/forms/client-form-sheet";
import { isExternalForm, useExternalFormOpener } from "@/lib/external-form-open";

/**
 * "Nutrition Review" card for the client Nutrition tab — one tap opens the
 * exact nutrition form (/portal/check-ins/$formId), so a client already in
 * Nutrition never has to go back Home to submit their update.
 *
 * Status badge is derived from the scheduled task occurrence (authoritative
 * for due/overdue) with the latest submission as a fallback.
 */
export function NutritionReviewCard() {
  const portalUserId = usePortalUserId();
  const list = useServerFn(listActionCentre);
  const [open, setOpen] = useState(false);
  const { openExternalForm, fallbackDialog } = useExternalFormOpener();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, first_name, last_name, email")
        .eq("user_id", portalUserId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ["nf-forms-for-client", client?.id],
    enabled: !!client?.id,
    queryFn: () => listFormsForClient(client!.id),
  });
  const nutritionForm = pickNutritionUpdateForm(forms as any);

  const { data: occurrences = [] } = useQuery({
    queryKey: ["action-centre", client?.id],
    enabled: !!client?.id,
    staleTime: 30_000,
    queryFn: () => list({ data: { clientId: client!.id } }),
  });
  const occ = (occurrences as ActionCentreItem[]).find((o) => o.task_type === "nutrition_review");

  const { data: latestSub } = useQuery({
    queryKey: ["nf-latest-nutrition-sub", nutritionForm?.id, client?.id],
    enabled: !!nutritionForm?.id && !!client?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("nf_submissions")
        .select("status")
        .eq("form_id", nutritionForm!.id)
        .eq("client_id", client!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { status: string } | null;
    },
  });

  // Render nothing until we know whether a nutrition form exists for this client.
  if (formsLoading || !nutritionForm) return null;

  const occCompleted = occ?.status === "completed" || occ?.chip.tone === "success";
  const subDone =
    latestSub?.status === "submitted" ||
    latestSub?.status === "pending_review" ||
    latestSub?.status === "reviewed";

  let badge: { label: string; className: string };
  if (occCompleted || (!occ && subDone)) {
    badge = { label: "Submitted", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" };
  } else if (occ?.chip.tone === "danger") {
    badge = { label: "Overdue", className: "border-red-500/50 bg-red-500/10 text-red-500" };
  } else if (latestSub?.status === "in_progress") {
    badge = { label: "Started", className: "border-blue-500/40 bg-blue-500/10 text-blue-400" };
  } else {
    badge = { label: "Not Started", className: "border-border bg-muted/30 text-muted-foreground" };
  }

  const buttonLabel =
    badge.label === "Submitted"
      ? "Submit New Nutrition Review"
      : badge.label === "Started"
        ? "Continue Nutrition Review"
        : "Submit Nutrition Review";

  const dueLine =
    occ && !occCompleted && occ.due_local_date
      ? ` · due ${new Date(occ.due_local_date + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`
      : "";

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black uppercase tracking-widest">Nutrition Review</h2>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send your coach a nutrition update.{dueLine}
          </p>
        </div>
        <Button
          className="w-full bg-gradient-primary font-bold sm:w-auto"
          onClick={() => {
            // External (Fillout) forms open in a real browser tab; native
            // forms still open in the in-app sheet.
            if (isExternalForm(nutritionForm as any) && client) {
              openExternalForm(nutritionForm as any, client as any, "Nutrition Review");
              return;
            }
            setOpen(true);
          }}
        >
          <Send className="mr-1.5 h-4 w-4" />
          {buttonLabel}
        </Button>
      </div>
      {fallbackDialog}
      <ClientFormSheet
        formId={nutritionForm.id}
        title="Nutrition Review"
        open={open}
        onOpenChange={setOpen}
      />
    </Card>
  );
}