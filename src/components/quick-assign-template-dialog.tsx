import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyTemplateToClient, getTemplateWeeks, computeEndDateFromStart } from "@/lib/pl-programs";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  clientName?: string;
};

export function QuickAssignTemplateDialog({ open, onOpenChange, clientId, clientName }: Props) {
  const qc = useQueryClient();
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

  const submit = async () => {
    if (!templateId) return toast.error("Pick a template");
    setBusy(true);
    try {
      const placement = selected?.template_type === "full_prep"
        ? { mode: "new_prep" as const, prep: {} }
        : { mode: "standalone_block" as const };
      await applyTemplateToClient({
        templateId, clientId, placement,
        clientVisible: visible,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      toast.success("Template assigned");
      qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
      qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
      qc.invalidateQueries({ queryKey: ["clients-blocks-all"] });
      qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
      onOpenChange(false);
      setTemplateId("");
      setEndDate("");
    } catch (e: any) {
      toast.error(e.message);
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
          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Visible to client</Label>
            <Switch checked={visible} onCheckedChange={setVisible} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!templateId || busy}>{busy ? "Assigning…" : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}