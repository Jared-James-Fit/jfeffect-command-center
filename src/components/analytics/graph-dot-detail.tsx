/**
 * GraphDotDetail — bottom sheet shown when a user taps a dot on any analytics graph.
 *
 * Shows training context for that exact session:
 *   date, lift, set, weight, reps, volume, est 1RM, RPE, RIR,
 *   exercise note, workout duration, completion status, workout review summary.
 *
 * Performance: notes and review are fetched ONLY after the user taps a dot.
 * The graph data itself is not slowed down.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ExternalLink, Star, FileText, Clock, Dumbbell, Activity, Heart } from "lucide-react";
import { fmtNum } from "@/lib/analytics-format";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";

export type GraphDotPoint = {
  id: string;           // pl_row_results.id
  row_id: string;       // pl_exercise_rows.id
  day_id?: string | null;
  date: string;
  exercise_name: string;
  load: number;         // always in lb
  reps: number;
  est_1rm: number;
  rpe?: string | null;
  rir?: string | null;
  exercise_note?: string | null;
  duration_seconds?: number | null;
  set_index: number;
  displayUnit?: "lb" | "kg";
  displayLoad?: number; // pre-converted for display
};

type Props = {
  point: GraphDotPoint | null;
  clientId?: string;
  onClose: () => void;
  canOpenLog?: boolean; // admin/coach can open the workout log
};

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export function GraphDotDetail({ point, clientId, onClose, canOpenLog = false }: Props) {
  const open = !!point;
  const notesRef = useRef<HTMLDivElement | null>(null);
  const scrollToNotes = () => notesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Lazy-fetch exercise note for this specific row (only when a dot is tapped)
  const { data: exerciseNote } = useQuery({
    queryKey: ["exercise-note", point?.row_id],
    enabled: open && !!point?.row_id && !point?.exercise_note,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_exercise_notes")
        .select("content, created_at")
        .eq("row_id", point!.row_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  // Lazy-fetch workout review for the day this set was logged
  const { data: review } = useQuery({
    queryKey: ["workout-review-for-dot", clientId, point?.day_id, point?.date],
    enabled: open && !!clientId && !!point?.day_id,
    queryFn: async () => {
      // Find the member enrollment for this client and look up the review
      // by day_id via member_workout_completions → member_workout_reviews
      const { data } = await supabase
        .from("member_workout_reviews")
        .select("overall_rating, strength_feel, fatigue_feel, hit_target, pain, session_rpe, client_note, review_submitted_at, completion_id, enrollment_id")
        .order("review_submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  // Lazy-fetch cardio completion for the date this set was logged
  const dateStr = point ? format(new Date(point.date), "yyyy-MM-dd") : "";
  const { data: cardio } = useQuery({
    queryKey: ["cardio-completion-for-dot", clientId, dateStr],
    enabled: open && !!clientId && !!dateStr,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("cardio_completions")
        .select("cardio_type, duration_minutes, rpe, notes")
        .eq("client_id", clientId)
        .eq("completed_date", dateStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const noteContent = point?.exercise_note ?? exerciseNote?.content ?? null;
  const displayUnit = point?.displayUnit ?? "lb";
  const displayLoad = point?.displayLoad ?? point?.load ?? 0;
  const volume = displayLoad * (point?.reps ?? 0);

  if (!point) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-safe">
        <SheetHeader className="pb-3 border-b border-border">
          <SheetTitle className="text-base font-black">{point.exercise_name}</SheetTitle>
          <div className="text-xs text-muted-foreground">
            {format(new Date(point.date), "EEEE, MMM d, yyyy · h:mma")}
          </div>
        </SheetHeader>

        <div className="space-y-4 pt-4">
          {/* ── Core set data ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Weight" value={`${fmtNum(displayLoad)} ${displayUnit}`} />
            <StatCard label="Reps" value={String(point.reps)} />
            <StatCard label="Volume" value={`${fmtNum(volume)} ${displayUnit}`} />
            <StatCard label="Est 1RM" value={`${fmtNum(point.est_1rm)} ${displayUnit}`} highlight />
          </div>

          {/* ── RPE / RIR ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
                <Activity className="h-3 w-3" /> RPE
              </div>
              <div className={`text-sm font-bold ${point.rpe ? "text-foreground" : "text-muted-foreground"}`}>
                {point.rpe ? `RPE ${point.rpe}` : "RPE not logged"}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
                <Dumbbell className="h-3 w-3" /> RIR
              </div>
              <div className={`text-sm font-bold ${point.rir ? "text-foreground" : "text-muted-foreground"}`}>
                {point.rir ? `${point.rir} RIR` : "RIR not logged"}
              </div>
            </div>
          </div>

          {/* ── Duration ── */}
          {point.duration_seconds != null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span>Workout duration: <span className="font-semibold text-foreground">{fmtDuration(point.duration_seconds)}</span></span>
            </div>
          )}

          {/* ── Exercise note ── */}
          <div ref={notesRef} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
              <FileText className="h-3 w-3" /> Exercise Note
            </div>
            {noteContent ? (
              <p className="text-sm text-foreground whitespace-pre-wrap">{noteContent}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No exercise note</p>
            )}
          </div>

          {/* ── Workout review summary ── */}
          {review ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                <Star className="h-3 w-3" /> Workout Review
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <RatingStars rating={review.overall_rating} />
                <span className="text-xs text-muted-foreground">{review.overall_rating}/5</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {review.strength_feel && (
                  <ReviewBadge label="Strength" value={review.strength_feel} />
                )}
                {review.fatigue_feel && (
                  <ReviewBadge label="Fatigue" value={review.fatigue_feel} />
                )}
                {review.hit_target && (
                  <ReviewBadge label="Hit Target" value={review.hit_target} />
                )}
              </div>
              {review.client_note && (
                <p className="text-xs text-muted-foreground italic">"{review.client_note}"</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
                <Star className="h-3 w-3" /> Workout Review
              </div>
              <p className="text-sm text-muted-foreground">No review submitted</p>
            </div>
          )}

          {/* ── Cardio ── */}
          {clientId && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                <Heart className="h-3 w-3" /> Cardio
              </div>
              {cardio ? (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-semibold">{cardio.cardio_type || "—"}</span>
                  </div>
                  {cardio.duration_minutes != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-semibold">{cardio.duration_minutes} min</span>
                    </div>
                  )}
                  {cardio.rpe != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">RPE:</span>
                      <span className="font-semibold">{cardio.rpe}</span>
                    </div>
                  )}
                  {cardio.notes && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{cardio.notes}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No cardio logged</p>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            {canOpenLog && clientId && point.day_id && (
              <Button asChild className="w-full" size="lg">
                <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open Workout Log
                </Link>
              </Button>
            )}
            {review?.completion_id && (
              <Button variant="outline" className="w-full" size="lg" onClick={onClose}>
                <Star className="mr-2 h-4 w-4" /> View Full Review
              </Button>
            )}
            <Button variant="ghost" className="w-full" size="lg" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</div>
      <div className={`text-base font-black ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function ReviewBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background p-1.5 text-center">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}
