import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Dumbbell, Plus, BookOpen, CalendarDays, Apple, HeartPulse,
  MessageSquare, ClipboardCheck, CreditCard, User, Zap, Star, Archive,
  Download, Loader2, ShoppingCart,
} from "lucide-react";
import { QuickSellSheet } from "./quick-sell-sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { AssignProgramDialog } from "./assign-program-dialog";
import { WorkoutArchiveDialog } from "./workout-archive-dialog";
import { toast } from "sonner";
import { getBlockTree } from "@/lib/pl-programs";
import { getClientMealPlanForCoach } from "@/lib/nutrition-targets/admin-meal-plan.functions";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

function useClientPdfDownloads(r: DirectoryRow) {
  const [workoutPending, setWorkoutPending] = useState(false);
  const [mealPending, setMealPending] = useState(false);
  const fetchMealPlan = useServerFn(getClientMealPlanForCoach);

  const downloadWorkout = async () => {
    if (!r.block_id) {
      toast.error(`${r.full_name ?? "Client"} has no active program.`);
      return;
    }
    setWorkoutPending(true);
    const toastId = toast.loading("Generating workout PDF…");
    try {
      const tree = await getBlockTree(r.block_id);
      if (!tree) throw new Error("Block not found");
      const { downloadWorkoutPdf } = await import(
        "@/lib/workouts/workout-pdf"
      );
      const weeksSorted = (tree.weeks ?? [])
        .slice()
        .sort((a: any, b: any) => (a.week_index ?? 0) - (b.week_index ?? 0));
      const daysByWeek = new Map<string, any[]>();
      for (const d of tree.days ?? []) {
        const list = daysByWeek.get(d.week_id) ?? [];
        list.push(d);
        daysByWeek.set(d.week_id, list);
      }
      const rowsByDay = new Map<string, any[]>();
      for (const rw of tree.rows ?? []) {
        const list = rowsByDay.get(rw.day_id) ?? [];
        list.push(rw);
        rowsByDay.set(rw.day_id, list);
      }
      // Fetch client-authored exercise notes for every day in the block so
      // the downloaded PDF surfaces what the client actually wrote.
      const allDayIds = (tree.days ?? []).map((d: any) => d.id);
      const notesByDay = new Map<string, any[]>();
      if (allDayIds.length) {
        const { data: noteRows } = await (supabase as any)
          .from("pl_exercise_notes")
          .select("day_id, row_id, exercise_name, content, status, created_at, updated_at")
          .in("day_id", allDayIds)
          .eq("client_id", r.id)
          .order("updated_at", { ascending: true });
        for (const n of (noteRows ?? []) as any[]) {
          const list = notesByDay.get(n.day_id) ?? [];
          list.push(n);
          notesByDay.set(n.day_id, list);
        }
      }
      downloadWorkoutPdf({
        client_name: r.full_name ?? null,
        program_name: (tree as any).block?.name ?? null,
        block_name: (tree as any).block?.name ?? null,
        block_status: (tree as any).block?.status ?? null,
        block_start: (tree as any).block?.start_date ?? null,
        block_end: (tree as any).block?.end_date ?? null,
        weeks: weeksSorted.map((w: any) => ({
          id: w.id,
          week_index: w.week_index,
          notes: w.notes ?? null,
          days: (daysByWeek.get(w.id) ?? [])
            .slice()
            .sort((a: any, b: any) => (a.day_index ?? 0) - (b.day_index ?? 0))
            .map((d: any) => ({
              id: d.id,
              day_index: d.day_index,
              title: d.title ?? null,
              notes: d.notes ?? null,
              notes_client_visible: d.notes_client_visible ?? null,
              scheduled_date: d.scheduled_date ?? null,
              rows: rowsByDay.get(d.id) ?? [],
              client_exercise_notes: notesByDay.get(d.id) ?? [],
            })),
        })),
      });
      toast.success("Workout PDF downloaded", { id: toastId });
    } catch (err) {
      console.error("Workout PDF download failed", err);
      toast.error("Could not generate workout PDF.", { id: toastId });
    } finally {
      setWorkoutPending(false);
    }
  };

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
      downloadMealPlanPdf({
        client_name: plan.client_name ?? r.full_name ?? null,
        coach_name: plan.coach_name ?? null,
        updated_at: plan.updated_at ?? null,
        start_date: plan.start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        client_notes: plan.client_notes ?? null,
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

  return { workoutPending, mealPending, downloadWorkout, downloadMealPlan };
}

/** Compact "Quick Actions" launcher for a client row. */
export function QuickActionsMenu({ r }: { r: DirectoryRow }) {
  const hasProgram = !!r.block_id;
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const pdfs = useClientPdfDownloads(r);
  return (
    <>
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 md:h-9 md:w-9"
              aria-label="Quick actions"
            >
              <Zap className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Quick actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Training</DropdownMenuLabel>
        {hasProgram ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Open Program
              </Link>
            </DropdownMenuItem>
            {r.block_id && (
              <DropdownMenuItem asChild>
                <Link to="/admin/blocks/$blockId" params={{ blockId: r.block_id }} className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4" /> Edit Current Program
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Build Next Phase
              </Link>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setAssignOpen(true); }}>
            <Dumbbell className="mr-2 h-4 w-4" /> Assign Program
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "training" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> View Schedule
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setArchiveOpen(true); }}>
          <Archive className="mr-2 h-4 w-4" /> Workout Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pdfs.workoutPending}
          onSelect={(e) => { e.preventDefault(); pdfs.downloadWorkout(); }}
        >
          {pdfs.workoutPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download Workout PDF
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Nutrition &amp; Cardio</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "nutrition" } as any} className="flex items-center gap-2">
            <Apple className="h-4 w-4" /> {!r.f_missing_nutrition ? "Update Nutrition" : "Add Nutrition"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "cardio" } as any} className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> {!r.f_missing_cardio ? "Update Cardio" : "Add Cardio"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pdfs.mealPending}
          onSelect={(e) => { e.preventDefault(); pdfs.downloadMealPlan(); }}
        >
          {pdfs.mealPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download Meal Plan PDF
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Client</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "messages" } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </Link>
        </DropdownMenuItem>
        {r.pending_reviews > 0 && (
          <DropdownMenuItem asChild>
            <Link to="/admin/check-in-reviews" className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Review Check-In
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "sessions" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book Session
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSellOpen(true); }}>
          <ShoppingCart className="mr-2 h-4 w-4 text-primary" /> Quick Sell / Send Payment Link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "billing" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Add Payment
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Open Profile
          </Link>
        </DropdownMenuItem>
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
    </>
  );
}

/** Expanded sectioned "More" menu (three-dot). */
export function ClientMoreMenu({
  r,
  trigger,
  onArchive,
}: {
  r: DirectoryRow;
  trigger: React.ReactNode;
  onArchive?: (r: DirectoryRow) => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const pdfs = useClientPdfDownloads(r);
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">{r.full_name}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} className="flex items-center gap-2">
            <Star className="h-4 w-4" /> Open Client
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "training" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> View Schedule
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Training</DropdownMenuLabel>
        {r.block_id ? (
          <DropdownMenuItem asChild>
            <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Open Program
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setAssignOpen(true); }}>
            <Dumbbell className="mr-2 h-4 w-4" /> Assign Program
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
          <Archive className="mr-2 h-4 w-4" /> Workout Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pdfs.workoutPending}
          onSelect={(e) => { e.preventDefault(); pdfs.downloadWorkout(); }}
        >
          {pdfs.workoutPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download Workout PDF
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Coaching</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "nutrition" } as any} className="flex items-center gap-2">
            <Apple className="h-4 w-4" /> {!r.f_missing_nutrition ? "Update Nutrition" : "Add Nutrition"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "cardio" } as any} className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> {!r.f_missing_cardio ? "Update Cardio" : "Add Cardio"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pdfs.mealPending}
          onSelect={(e) => { e.preventDefault(); pdfs.downloadMealPlan(); }}
        >
          {pdfs.mealPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download Meal Plan PDF
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "messages" } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "sessions" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book Session
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Billing</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSellOpen(true); }}>
          <ShoppingCart className="mr-2 h-4 w-4 text-primary" /> Quick Sell / Send Payment Link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "billing" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> View Payments
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "purchases" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Manage Package
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "info" } as any} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Edit Client
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "account" } as any} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Manage Access
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "agreements" } as any} className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> View Agreements
          </Link>
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
    </>
  );
}