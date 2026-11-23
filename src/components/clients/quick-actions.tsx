import { ClientNameLink } from "@/components/clients/client-name-link";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Dumbbell, Plus, CalendarDays, Apple, HeartPulse,
  MessageSquare, ClipboardCheck, CreditCard, User, Archive,
  Download, Loader2, ShoppingCart, Eye, ArrowRightLeft,
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
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { markClientReviewsReviewed, refreshReviewQueries } from "@/lib/checkin-review";
import { TrainingReportSheet } from "@/components/workouts/training-report-sheet";

/**
 * The Clients list row's ⋯ (Nov 23 2026): what the row's own buttons don't already do, grouped
 * by what the coach is doing. Open client and Client view are the row's buttons, so they aren't
 * repeated here; everything that was here is still reachable (the profile's tabs hold program
 * history, the workout archive, agreements and the nutrition PDF). Rarely used but important
 * actions (payment exemption, change plan, archive) stay, under Billing and Account.
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
  onChangePlan,
}: {
  r: DirectoryRow;
  trigger: React.ReactNode;
  onArchive?: (r: DirectoryRow) => void;
  /** Optional hover hint for the trigger (needs a surrounding TooltipProvider). */
  tip?: string;
  /** View as client, only where the caller has no Client view button of its own. */
  onViewAsClient?: () => void;
  viewAsBusy?: boolean;
  /** Opens the row's own Assign program (else the menu opens its own). */
  onAssignProgram?: () => void;
  /** Opens nutrition or cardio in place, over the list (else the profile's Nutrition tab). */
  onOpenPanel?: (kind: QuickPanelKind) => void;
  /** Move between coaching and the free membership (admins). */
  onChangePlan?: () => void;
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
  const [sellOpen, setSellOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
        <DropdownMenuLabel className="truncate text-xs">{r.full_name}</DropdownMenuLabel>
        {r.f_needs_review && (
          <DropdownMenuItem onSelect={() => void markReviewed()}>
            <ClipboardCheck className="h-4 w-4" /> Mark check-in reviewed
          </DropdownMenuItem>
        )}
        {onViewAsClient && (
          <DropdownMenuItem disabled={viewAsBusy} onSelect={() => onViewAsClient()}>
            {viewAsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} View as client
          </DropdownMenuItem>
        )}

        <DropdownMenuLabel className="pt-2 text-xs text-muted-foreground">Training</DropdownMenuLabel>
        {r.block_id ? (
          <DropdownMenuItem asChild>
            <ClientNameLink clientId={r.id} tab="training" className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Program & schedule
            </ClientNameLink>
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
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setScheduleOpen(true); }}>
            <CalendarDays className="h-4 w-4" /> Schedule a workout
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setReportOpen(true); }}>
          <Download className="h-4 w-4" /> Training PDF
        </DropdownMenuItem>

        <DropdownMenuLabel className="pt-2 text-xs text-muted-foreground">Coaching</DropdownMenuLabel>
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
          <DropdownMenuItem asChild>
            <ClientNameLink clientId={r.id} tab="nutrition" className="flex items-center gap-2">
              <Apple className="h-4 w-4" /> Nutrition & cardio
            </ClientNameLink>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/messages" search={{ client: r.id } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Message
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="sessions" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book a session
          </ClientNameLink>
        </DropdownMenuItem>

        <DropdownMenuLabel className="pt-2 text-xs text-muted-foreground">Billing</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSellOpen(true); }}>
          <ShoppingCart className="h-4 w-4" /> Sell or send a payment link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="billing" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Billing & packages
          </ClientNameLink>
        </DropdownMenuItem>
        {(r.payment_state === "not_set_up" || r.payment_state === "pending" || isExempt) && (
          <DropdownMenuItem onSelect={() => void setPaymentExempt(!isExempt)}>
            <CreditCard className="h-4 w-4" />
            {isExempt ? "Require payment again" : "Mark: no payment needed"}
          </DropdownMenuItem>
        )}

        <DropdownMenuLabel className="pt-2 text-xs text-muted-foreground">Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <ClientNameLink clientId={r.id} tab="account" className="flex items-center gap-2">
            <User className="h-4 w-4" /> Account, access & agreement
          </ClientNameLink>
        </DropdownMenuItem>
        {onChangePlan && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onChangePlan(); }}>
            <ArrowRightLeft className="h-4 w-4" /> Change plan
          </DropdownMenuItem>
        )}
        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(r)}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="h-4 w-4" /> Archive Client
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