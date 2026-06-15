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
import { normalizeTemplatePayload, getActiveTemplateBlocks } from "@/lib/pl-template-blocks";
import { toast } from "sonner";
import { findOverlappingBlock, suggestNextStartISO } from "@/lib/block-schedule";
import { AlertTriangle } from "lucide-react";
import { runJob } from "@/lib/progress-jobs";
import { ProgramStatusBadge } from "@/components/programs/program-status-badge";
import { validateTemplatePayload } from "@/lib/pl-template-validation";

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
  const [ackIncomplete, setAckIncomplete] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["pl-templates-assignable"],
    enabled: open,
    queryFn: async () => (await (supabase as any)
      .from("pl_templates")
      .select("id, name, template_type, weeks, training_style, training_focus, payload")
      .in("template_type", ["block", "full_prep"])
      .eq("archived", false)
      .order("updated_at", { ascending: false })).data ?? [],
  });

  const selected = (templates as any[]).find((t) => t.id === templateId);
  const selectedWeeks = selected ? getTemplateWeeks(selected) : 0;
  const selectedIssues = selected ? validateTemplatePayload(selected) : [];
  const selectedIssueCount = selectedIssues.reduce((n, d) => n + d.missing.length, 0);
  const isIncomplete = selectedIssueCount > 0;
  useEffect(() => { setAckIncomplete(false); }, [templateId]);

  // v2 multi-block "block" templates expose individual blocks for selective assignment.
  const v2Blocks = (() => {
    if (!selected || selected.template_type !== "block") return [];
    const p = selected.payload;
    if (!p || p.schema_version !== 2 || !Array.isArray(p.blocks)) return [];
    return getActiveTemplateBlocks(normalizeTemplatePayload(p, { templateType: "block" }));
  })();
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  type AssignMode = "entire" | "selected" | "start_from";
  const [assignMode, setAssignMode] = useState<AssignMode>("entire");
  const [startFromBlockId, setStartFromBlockId] = useState<string>("");
  useEffect(() => {
    setSelectedBlockIds(v2Blocks.map((b) => b.id));
    setAssignMode("entire");
    setStartFromBlockId(v2Blocks[0]?.id ?? "");
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Empty "selected blocks" mode must never fall through to the legacy
    // single-block assignment path — the server now rejects this anyway but
    // we block in the UI for a clearer error and to keep the action
    // idempotent.
    if (v2Blocks.length > 0 && assignMode === "selected" && selectedBlockIds.length === 0) {
      return toast.error("Pick at least one block to assign");
    }
    setBusy(true);
    try {
      const placement = selected?.template_type === "full_prep"
        ? { mode: "new_prep" as const, prep: {} }
        : { mode: "standalone_block" as const };
      // Resolve the per-mode selected/start-from intent for v2 multi-block templates.
      let effectiveSelectedIds: string[] | undefined;
      let effectiveStartFromId: string | null | undefined;
      if (v2Blocks.length > 0) {
        if (assignMode === "entire") {
          effectiveSelectedIds = v2Blocks.map((b) => b.id);
        } else if (assignMode === "selected") {
          effectiveSelectedIds = selectedBlockIds;
        } else {
          // start_from: assign chosen block + every active block after it
          effectiveStartFromId = startFromBlockId || v2Blocks[0]?.id || null;
          effectiveSelectedIds = v2Blocks.map((b) => b.id);
        }
      }
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
            ...(effectiveSelectedIds ? { selectedBlockIds: effectiveSelectedIds } as any : {}),
            ...(effectiveStartFromId ? { startFromBlockId: effectiveStartFromId } as any : {}),
          } as any);
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
            {selected && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Build status</span>
                <ProgramStatusBadge template={selected} size="md" />
              </div>
            )}
          </div>
          {isIncomplete && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="font-semibold">
                    Template is incomplete — {selectedIssueCount} {selectedIssueCount === 1 ? "field is" : "fields are"} missing
                  </div>
                  <ul className="max-h-32 overflow-y-auto pl-3 text-[11px]">
                    {selectedIssues.slice(0, 6).map((d, i) => (
                      <li key={i} className="list-disc">
                        <span className="font-medium">{d.location}:</span> {d.missing.join("; ")}
                      </li>
                    ))}
                    {selectedIssues.length > 6 && (
                      <li className="list-disc">+{selectedIssues.length - 6} more day(s) with issues</li>
                    )}
                  </ul>
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={ackIncomplete}
                      onChange={(e) => setAckIncomplete(e.target.checked)}
                    />
                    Assign anyway — I'll finish these fields later
                  </label>
                </div>
              </div>
            </div>
          )}
          {v2Blocks.length > 1 && (() => {
            // Compute the preview of which blocks will be assigned given the mode.
            let preview = v2Blocks;
            if (assignMode === "selected") preview = v2Blocks.filter((b) => selectedBlockIds.includes(b.id));
            if (assignMode === "start_from") {
              const idx = v2Blocks.findIndex((b) => b.id === startFromBlockId);
              preview = idx >= 0 ? v2Blocks.slice(idx) : v2Blocks;
            }
            const totalWeeks = preview.reduce((n, b) => n + (b.weeks?.length ?? 0), 0);
            return (
              <div className="rounded-md border border-border bg-secondary/20 p-2">
                <Label className="text-xs">Assignment mode</Label>
                <div className="mt-1 grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-0.5 text-[11px]">
                  {(["entire","selected","start_from"] as AssignMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAssignMode(m)}
                      className={
                        "rounded px-2 py-1 " +
                        (assignMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")
                      }
                    >
                      {m === "entire" ? "Entire program" : m === "selected" ? "Selected blocks" : "Start from block"}
                    </button>
                  ))}
                </div>

                {assignMode === "selected" && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Pick blocks</Label>
                      <div className="flex gap-1">
                        <button type="button" className="text-[10px] underline" onClick={() => setSelectedBlockIds(v2Blocks.map((b) => b.id))}>All</button>
                        <button type="button" className="text-[10px] underline" onClick={() => setSelectedBlockIds([])}>None</button>
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {v2Blocks.map((b) => (
                        <li key={b.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={selectedBlockIds.includes(b.id)}
                              onChange={(e) =>
                                setSelectedBlockIds((prev) =>
                                  e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id),
                                )
                              }
                            />
                            <span className="font-medium">{b.name}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{b.weeks?.length ?? 0}w</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {assignMode === "start_from" && (
                  <div className="mt-2">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Start at</Label>
                    <Select value={startFromBlockId} onValueChange={setStartFromBlockId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a block" /></SelectTrigger>
                      <SelectContent>
                        {v2Blocks.map((b) => (
                          <SelectItem key={b.id} value={b.id} className="text-xs">
                            {b.name} · {b.weeks?.length ?? 0}w
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="mt-2 rounded-md bg-background/60 p-1.5 text-[10px] text-muted-foreground">
                  Preview: <span className="font-medium text-foreground">{preview.length}</span> of {v2Blocks.length} block{v2Blocks.length === 1 ? "" : "s"}
                  {totalWeeks > 0 && <> · {totalWeeks} week{totalWeeks === 1 ? "" : "s"}</>}
                  {preview.length > 0 && (
                    <> · {preview.map((b) => b.name).join(" → ")}</>
                  )}
                </div>
              </div>
            );
          })()}
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
          <Button
            onClick={submit}
            disabled={
              !templateId ||
              busy ||
              !!conflict ||
              (isIncomplete && !ackIncomplete) ||
              (v2Blocks.length > 0 && assignMode === "selected" && selectedBlockIds.length === 0)
            }
          >
            {busy ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}