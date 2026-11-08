import { ClientNameLink } from "@/components/clients/client-name-link";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Dumbbell, Plus, BookOpen, CalendarDays, Apple, HeartPulse,
  MessageSquare, ClipboardCheck, CreditCard, User, Star, Archive,
  Download, Loader2, ShoppingCart, Eye,
} from "lucide-react";
import { QuickSellSheet } from "./quick-sell-sheet";
import { ScheduleWorkoutSheet } from "@/components/schedule/ScheduleWorkoutSheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { AssignProgramDialog } from "./assign-program-dialog";
import { blockEnd } from "./clients-status";
import type { QuickPanelKind } from "./client-quick-sheet";
import { WorkoutArchiveDialog } from "./workout-archive-dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { markClientReviewsReviewed, refreshReviewQueries } from "@/lib/checkin-review";
import { getClientMealPlanForCoach } from "@/lib/nutrition-targets/admin-meal-plan.functions";
import { useServerFn } from "@tanstack/react-start";
import { TrainingReportSheet } from "@/components/workouts/training-report-sheet";

function useClientPdfDownloads(r: DirectoryRow) {
  const [mealPending, setMealPending] = useState(false);
  const fetchMealPlan = useServerFn(getClientMealPlanForCoach);

  const downloadMealPlan = async () => {
    setMealPending(true);
    const toastId = toast.loading("Generating meal plan PDF…");
    try {
      const plan = await fetchMealPlan({ data: { clientId: r.id } });
      if (!plan) {
        toast.error(
          `${r.full_name ?? "Client"} has no visible meal plan assigned.`,
          { id: toastId },
        );
        return;
      }
      const { downloadMealPlanPdf } = await import(
        "@/lib/nutrition-targets/meal-plan-pdf"
      );
      await downloadMealPlanPdf({
        client_name: plan.client_name ?? r.full_name ?? null,
        coach_name: plan.coach_name ?? null,
        updated_at: plan.updated_at ?? null,
        start_date: plan.start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        client_notes: plan.client_notes ?? null,
        food_weighing_rules: (plan as any).food_weighing_rules ?? null,
        days: (plan.days ?? []) as any[],
      });
      toast.success("Meal plan PDF downloaded", { id: toastId });
    } catch (err) {
      console.error("Meal plan PDF download failed", err);
      toast.error("Could not generate meal plan PDF.", { id: toastId });
    } finally {
      setMealPending(false);
    }
  };

  return { mealPending, downloadMealPlan };
}

/**
 * The Clients list row's ⋯: every action for the client. The row itself shows only View Profile,
 * so assigning a program, nutrition or cardio and View as client all live here.
 */
export function ClientMoreMenu({
  r,
  trigger,
  onArchive,
  tip,
  onViewAsClient,
  viewAsBusy,
  onAssignProgram,
  onOpenPanel,
}: {
  r: DirectoryRow;
  trigger: React.ReactNode;
  onArchive?: (r: DirectoryRow) => void;
  /** Optional hover hint for the trigger (needs a surrounding TooltipProvider). */
  tip?: string;
  /** View as client, for logins allowed to (left out otherwise). */
  onViewAsClient?: () => void;
  viewAsBusy?: boolean;
  /** Opens the row's own Assign program (else the menu opens its own). */
  onAssignProgram?: () => void;
  /** Opens nutrition or cardio in place, over the list (else the profile's Nutrition tab). */
  onOpenPanel?: (kind: QuickPanelKind) => void;
}) {
  const qc = useQueryClient();
  const isExempt = r.payment_state === "exempt";
  const markReviewed = async () => {
    try {
      const n = await markClientReviewsReviewed(r.id);
      toast.success(n > 0 ? "Marked reviewed" : "Nothing was waiting");
      refreshReviewQueries(qc);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark this reviewed");
    }
  };
  const setPaymentExempt = async (exempt: boolean) => {
    const { error } = await (supabase as any)
      .from("clients")
      .update({ payment_status: exempt ? "Complimentary" : "Not Sent" })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(exempt ? "Marked as no payment needed" : "Payment is required again");
    qc.invalidateQueries({ queryKey: ["clients-directory"] });
  };
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const pdfs = useClientPdfDownloads(r);
  const assignProgram = () => (onAssignProgram ? onAssignProgram() : setAssignOpen(true));
  // A block that's ended or ending with nothing queued after it.
  const needsNextBlock = !!r.block_id && !!blockEnd(r.block_end, r.next_block_id)?.needsNext;
  return (
    <>
    <DropdownMenu>
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">{tip}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">{r.full_name}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} className="flex items-center gap-2">
            <Star className="h-4 w-4" /> View Profile
          </ClientNameLink>
        </DropdownMenuItem>
        {onViewAsClient && (
          <DropdownMenuItem disabled={viewAsBusy} onSelect={() => onViewAsClient()}>
            {viewAsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} View as client
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="training" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> View Schedule
          </ClientNameLink>
        </DropdownMenuItem>
        {r.f_needs_review && (
          <DropdownMenuItem onSelect={() => void markReviewed()}>
            <ClipboardCheck className="h-4 w-4" /> Mark check-in reviewed
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Training</DropdownMenuLabel>
        {r.block_id && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setScheduleOpen(true); }}>
            <Plus className="h-4 w-4" /> Schedule Workout
          </DropdownMenuItem>
        )}
        {r.block_id ? (
          <DropdownMenuItem asChild>
            <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Open Program
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); assignProgram(); }}>
            <Dumbbell className="h-4 w-4" /> Assign Program
          </DropdownMenuItem>
        )}
        {needsNextBlock && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); assignProgram(); }}>
            <Plus className="h-4 w-4" /> Assign Next Block
          </DropdownMenuItem>
        )}
        {r.block_id && (
          <DropdownMenuItem asChild>
            <Link to="/admin/blocks/$blockId" params={{ blockId: r.block_id }} className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> Edit Current Program
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/client-programs/$clientId/history" params={{ clientId: r.id }} className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Program History
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setArchiveOpen(true); }}>
          <Archive className="h-4 w-4" /> Workout Archive
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setReportOpen(true); }}>
          <Download className="h-4 w-4" /> Download Training Report
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Coaching</DropdownMenuLabel>
        {onOpenPanel ? (
          <>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onOpenPanel("nutrition"); }}>
              <Apple className="h-4 w-4" /> {!r.f_missing_nutrition ? "Update Nutrition" : "Assign Nutrition"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onOpenPanel("cardio"); }}>
              <HeartPulse className="h-4 w-4" /> {!r.f_missing_cardio ? "Update Cardio" : "Assign Cardio"}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem asChild>
              <ClientNameLink clientId={r.id} tab="nutrition" className="flex items-center gap-2">
                <Apple className="h-4 w-4" /> {!r.f_missing_nutrition ? "Update Nutrition" : "Add Nutrition"}
              </ClientNameLink>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ClientNameLink clientId={r.id} tab="nutrition" className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4" /> {!r.f_missing_cardio ? "Update Cardio" : "Add Cardio"}
              </ClientNameLink>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          disabled={pdfs.mealPending}
          onSelect={(e) => { e.preventDefault(); pdfs.downloadMealPlan(); }}
        >
          {pdfs.mealPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download Meal Plan PDF
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="messages" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </ClientNameLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="sessions" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book Session
          </ClientNameLink>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Billing</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSellOpen(true); }}>
          <ShoppingCart className="h-4 w-4" /> Quick Sell / Send Payment Link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="billing" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> View Payments
          </ClientNameLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="purchases" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Manage Package
          </ClientNameLink>
        </DropdownMenuItem>
        {(r.payment_state === "not_set_up" || r.payment_state === "pending" || isExempt) && (
          <DropdownMenuItem onSelect={() => void setPaymentExempt(!isExempt)}>
            <CreditCard className="h-4 w-4" />
            {isExempt ? "Require payment again" : "Mark: no payment needed"}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="info" className="flex items-center gap-2">
            <User className="h-4 w-4" /> Edit Client
          </ClientNameLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="account" className="flex items-center gap-2">
            <User className="h-4 w-4" /> Manage Access
          </ClientNameLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="agreements" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> View Agreements
          </ClientNameLink>
        </DropdownMenuItem>

        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(r)}
              className="text-destructive focus:text-destructive"
            >
              Archive Client
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <AssignProgramDialog
      open={assignOpen}
      onOpenChange={setAssignOpen}
      clientId={r.id}
      clientName={r.full_name}
    />
    <WorkoutArchiveDialog
      open={archiveOpen}
      onOpenChange={setArchiveOpen}
      clientId={r.id}
      clientName={r.full_name}
    />
    <QuickSellSheet
      open={sellOpen}
      onOpenChange={setSellOpen}
      clientId={r.id}
      clientName={r.full_name}
    />
    <ScheduleWorkoutSheet
      open={scheduleOpen}
      onOpenChange={setScheduleOpen}
      clientId={r.id}
      clientName={r.full_name}
    />
    <TrainingReportSheet
      open={reportOpen}
      onOpenChange={setReportOpen}
      clientId={r.id}
      clientName={r.full_name}
      audience="coach"
    />
    </>
  );
}