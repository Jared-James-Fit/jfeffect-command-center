/**
 * AddExtraDayDialog
 *
 * Dummy-proof dialog for adding an extra workout day to any week in a client's
 * training block. Handles:
 *   - Date picker (required — ensures the day shows on the correct calendar date)
 *   - Auto-generated title from date (e.g. "Day 5 — Monday, August 3 — Primer")
 *   - Day type selector: Regular | Primer | Competition | Recovery | Technique
 *   - Immediately persists to the database via pl_days + optional exercise rows
 *   - Invalidates the block query so the UI refreshes instantly
 *
 * Usage:
 *   <AddExtraDayDialog weekId={week.id} blockId={block.id} existingDayCount={days.length} onAdded={() => refetch()} />
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Plus, CalendarPlus } from "lucide-react";

const DAY_TYPES = [
  { value: "regular", label: "Regular Training Day" },
  { value: "primer", label: "Primer — Very Light (day before comp)" },
  { value: "competition", label: "🏆 Competition Day" },
  { value: "recovery", label: "Recovery / Technique" },
  { value: "deload", label: "Deload / Easy" },
] as const;

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatDateTitle(dateStr: string, dayType: string, dayNum: number): string {
  if (!dateStr) return `Day ${dayNum}`;
  const d = new Date(dateStr + "T12:00:00"); // noon to avoid timezone issues
  const wd = DAY_NAMES[d.getDay()];
  const mn = MONTH_NAMES[d.getMonth()];
  const dom = d.getDate();

  switch (dayType) {
    case "competition":
      return `🏆 Competition Day — ${wd}, ${mn} ${dom}`;
    case "primer":
      return `Day ${dayNum} — ${wd}, ${mn} ${dom} — Primer — Very Light`;
    case "recovery":
      return `Day ${dayNum} — ${wd}, ${mn} ${dom} — Recovery`;
    case "deload":
      return `Day ${dayNum} — ${wd}, ${mn} ${dom} — Deload`;
    default:
      return `Day ${dayNum} — ${wd}, ${mn} ${dom}`;
  }
}

interface AddExtraDayDialogProps {
  weekId: string;
  blockId: string;
  existingDayCount: number;
  onAdded?: () => void;
  /** Optional: pass block start/end dates to constrain the date picker */
  blockStartDate?: string | null;
  blockEndDate?: string | null;
}

export function AddExtraDayDialog({ weekId, blockId, existingDayCount, onAdded, blockStartDate, blockEndDate }: AddExtraDayDialogProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [dayType, setDayType] = useState("regular");
  const [customTitle, setCustomTitle] = useState("");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const nextDayNum = existingDayCount + 1;
  const autoTitle = date ? formatDateTitle(date, dayType, nextDayNum) : "";
  const finalTitle = customTitle.trim() || autoTitle || `Day ${nextDayNum}`;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("Please select a date for this workout.");

      // Insert the new day
      const { data: newDay, error } = await supabase
        .from("pl_days")
        .insert({
          week_id: weekId,
          day_index: nextDayNum,
          title: finalTitle,
          scheduled_date: date,
          notes: notes.trim() || null,
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return newDay;
    },
    onSuccess: (newDay) => {
      toast.success(`Day added: ${finalTitle}`);
      // Invalidate all relevant queries so the block editor and client view refresh
      qc.invalidateQueries({ queryKey: ["block-tree", blockId] });
      qc.invalidateQueries({ queryKey: ["pl-block", blockId] });
      qc.invalidateQueries({ queryKey: ["pl-days"] });
      setOpen(false);
      setDate("");
      setDayType("regular");
      setCustomTitle("");
      setNotes("");
      onAdded?.();
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to add day");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 border-dashed">
          <CalendarPlus className="h-3.5 w-3.5" />
          Add Extra Day
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" />
            Add Extra Workout Day
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Date — required */}
          <div className="space-y-1.5">
            <Label htmlFor="extra-day-date" className="text-sm font-semibold">
              Date <span className="text-destructive">*</span>
            </Label>
            <input
              id="extra-day-date"
              type="date"
              className="w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={date}
              min={blockStartDate ?? undefined}
              max={blockEndDate ?? undefined}
              onChange={(e) => setDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This is the actual calendar date the workout will appear on.
            </p>
          </div>

          {/* Day type */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Day Type</Label>
            <Select value={dayType} onValueChange={setDayType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto-generated title preview */}
          {date && (
            <div className="rounded-md bg-muted/50 border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground mb-1">Auto-generated title:</p>
              <p className="text-sm font-medium">{autoTitle}</p>
            </div>
          )}

          {/* Custom title override */}
          <div className="space-y-1.5">
            <Label className="text-sm">Custom Title (optional override)</Label>
            <Input
              placeholder={autoTitle || `Day ${nextDayNum}`}
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm">Coach Notes (optional)</Label>
            <Input
              placeholder="e.g. Opener weight only. Feel the bar."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!date || mutation.isPending}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {mutation.isPending ? "Adding…" : "Add Day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
