import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyTemplateToClient, getTemplateWeeks, computeEndDateFromStart } from "@/lib/pl-programs";
import { toast } from "sonner";
import { findOverlappingBlock, suggestNextStartISO } from "@/lib/block-schedule";
import { AlertTriangle } from "lucide-react";
import { runJob } from "@/lib/progress-jobs";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  clientName?: string;
};

export function QuickAssignTemplateDialog({ open, onOpenChange, clientId, clientName }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [templateId, setTemplateId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["pl-templates-assignable"],
    enabled: open,
    queryFn: async () => (await (supabase as any)
      .from("pl_templates")
      .select("id, name, template_type, weeks, training_style, training_focus")
      .in("template_type", ["block", "full_prep"])
      .eq("archived", false)
      .order("updated_at", { ascending: false })).data ?? [],
  });

  const selected = (templates as any[]).find((t) => t.id === templateId);
  const selectedWeeks = selected ? getTemplateWeeks(selected) : 0;

  const { data: existingBlocks = [] } = useQuery({
    queryKey: ["pl-blocks-schedule", clientId],
    enabled: open && !!clientId,
    queryFn: async () => (await (supabase as any)
      .from("pl_blocks")
      .select("id, name, start_date, end_date, status, archived")
      .eq("client_id", clientId)).data ?? [],
  });

  useEffect(() => {
    if (startDate && selectedWeeks > 0) {
      setEndDate(computeEndDateFromStart(startDate, selectedWeeks));
    }
  }, [startDate, selectedWeeks]);

  const conflict = findOverlappingBlock(existingBlocks as any[], startDate, endDate || startDate);
  const suggestedStart = suggestNextStartISO(existingBlocks as any[]);
  const useSuggestion = () => {
    setStartDate(suggestedStart);
    if (selectedWeeks > 0) setEndDate(computeEndDateFromStart(suggestedStart, selectedWeeks));
  };

  const submit = async () => {
    if (!templateId) return toast.error("Pick a template");
    if (conflict) {
      return toast.error(
        `Overlaps with "${conflict.name ?? "another block"}" (${conflict.start_date ?? "?"} – ${conflict.end_date ?? "?"}). Use the suggested start date.`,
      );
    }
    setBusy(true);
    try {
      const placement = selected?.template_type === "full_prep"
        ? { mode: "new_prep" as const, prep: {} }
        : { mode: "standalone_block" as const };
      await runJob(
        {
          title: "Assigning program template",
          description: `${selected?.name ?? "Template"}${clientName ? ` → ${clientName}` : ""}`,
          steps: ["Validating schedule", "Creating assignment", "Syncing client access"],
          successToast: "Template assigned",
          successAction: {
            label: "Open client",
            onClick: () => navigate({ to: "/admin/client-programs/$clientId", params: { clientId } }),
          },
        },
        async (job) => {
          job.completeStep(0);
          await applyTemplateToClient({
            templateId, clientId, placement,
            clientVisible: visible,
            startDate: startDate || null,
            endDate: endDate || null,
          });
          job.completeStep(1);
          qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
          qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
          qc.invalidateQueries({ queryKey: ["clients-blocks-all"] });
          qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
          job.completeStep(2);
        },
      );
      onOpenChange(false);
      setTemplateId("");
      setEndDate("");
      navigate({ to: "/admin/client-programs/$clientId", params: { clientId } });
    } catch (e: any) {
      // runJob already surfaced the error toast + drawer entry with Retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Program Template{clientName ? ` · ${clientName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder={(templates as any[]).length ? "Choose from Program Library…" : "No templates yet"} /></SelectTrigger>
              <SelectContent>
                {(templates as any[]).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} {t.weeks ? `· ${t.weeks}w` : ""} {t.training_focus ? `· ${t.training_focus}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">End date (optional)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {conflict && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">Schedule conflict</div>
                  <div>
                    Overlaps with <span className="font-semibold">{conflict.name ?? "an existing block"}</span>
                    {conflict.start_date && conflict.end_date ? ` (${conflict.start_date} – ${conflict.end_date})` : ""}.
                  </div>
                  <button
                    type="button"
                    onClick={useSuggestion}
                    className="mt-1 underline underline-offset-2 hover:no-underline"
                  >
                    Use suggested start: {suggestedStart}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!conflict && suggestedStart !== startDate && (existingBlocks as any[]).some((b: any) => b.end_date) && (
            <button
              type="button"
              onClick={useSuggestion}
              className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50"
            >
              Next free start after current blocks: {suggestedStart} · click to use
            </button>
          )}
          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Visible to client</Label>
            <Switch checked={visible} onCheckedChange={setVisible} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!templateId || busy || !!conflict}>{busy ? "Assigning…" : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}