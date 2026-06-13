import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { History, RotateCcw, Eye, Rocket } from "lucide-react";
import { listFormVersions, type NfFormVersion, type NfQuestion } from "@/lib/native-forms";
import { publishFormVersion, restoreFormVersion } from "@/lib/native-forms-versions.functions";

export function FormVersionHistory({ formId }: { formId: string }) {
  const qc = useQueryClient();
  const publishFn = useServerFn(publishFormVersion);
  const restoreFn = useServerFn(restoreFormVersion);
  const [reason, setReason] = useState("");
  const [view, setView] = useState<NfFormVersion | null>(null);
  const [compare, setCompare] = useState<NfFormVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: versions = [] } = useQuery({
    queryKey: ["nf-form-versions", formId],
    queryFn: () => listFormVersions(formId),
  });
  const current = versions[0] ?? null;

  async function publish() {
    setBusy(true);
    try {
      const r = await publishFn({ data: { formId, reason: reason.trim() || null } });
      if (!r.ok) { toast.error(r.error ?? "Publish failed"); return; }
      setReason("");
      await qc.invalidateQueries({ queryKey: ["nf-form-versions", formId] });
      toast.success(`Published v${r.version?.version_number}`);
    } finally { setBusy(false); }
  }

  async function restore(v: NfFormVersion) {
    if (!confirm(`Restore v${v.version_number}? This creates a new version on top — older history is kept.`)) return;
    setBusy(true);
    try {
      const r = await restoreFn({ data: { versionId: v.id, reason: null } });
      if (!r.ok) { toast.error(r.error ?? "Restore failed"); return; }
      await qc.invalidateQueries({ queryKey: ["nf-form-versions", formId] });
      await qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      toast.success(`Restored — now at v${r.version?.version_number}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <Card className="border-border bg-card p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Publish a new version
        </div>
        <Textarea
          rows={2}
          placeholder="Change reason (optional but recommended)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={publish} disabled={busy} className="bg-gradient-primary font-bold">
            <Rocket className="mr-1 h-4 w-4" /> Publish version
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <History className="h-4 w-4" /> {versions.length} version{versions.length === 1 ? "" : "s"}
        </div>
        {versions.length === 0 && (
          <Card className="border-dashed bg-card p-4 text-xs text-muted-foreground">
            No versions yet. Publish to lock in a snapshot.
          </Card>
        )}
        {versions.map((v) => (
          <Card key={v.id} className="border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold">
                  v{v.version_number}
                  {current?.id === v.id && <Badge variant="outline" className="text-[10px]">Current</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()} ·
                  {" "}{(v.questions_snapshot as NfQuestion[])?.length ?? 0} questions
                </div>
                {v.change_reason && (
                  <div className="mt-1 text-xs text-muted-foreground italic">"{v.change_reason}"</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setView(v)}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> View
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCompare(v)} disabled={!current || current.id === v.id}>
                  Compare with current
                </Button>
                <Button size="sm" variant="outline" disabled={busy || current?.id === v.id} onClick={() => restore(v)}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>v{view?.version_number} — read-only snapshot</DialogTitle></DialogHeader>
          <VersionQuestionsList questions={(view?.questions_snapshot ?? []) as NfQuestion[]} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!compare} onOpenChange={(o) => !o && setCompare(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compare v{compare?.version_number} ↔ v{current?.version_number} (current)</DialogTitle>
          </DialogHeader>
          {compare && current && (
            <VersionCompare older={compare} newer={current} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionQuestionsList({ questions }: { questions: NfQuestion[] }) {
  return (
    <ol className="space-y-2 text-sm">
      {questions.length === 0 && <li className="text-muted-foreground">No questions.</li>}
      {questions.map((q, i) => (
        <li key={q.id} className="rounded border border-border bg-card p-2">
          <div className="text-xs font-bold">{i + 1}. {q.label}</div>
          <div className="text-[11px] text-muted-foreground">
            {q.question_type}{q.required ? " · required" : ""}
            {(q.options ?? []).length > 0 && ` · options: ${(q.options ?? []).join(", ")}`}
          </div>
        </li>
      ))}
    </ol>
  );
}

function VersionCompare({ older, newer }: { older: NfFormVersion; newer: NfFormVersion }) {
  const oldQs = (older.questions_snapshot ?? []) as NfQuestion[];
  const newQs = (newer.questions_snapshot ?? []) as NfQuestion[];
  const oldIds = new Set(oldQs.map((q) => q.id));
  const newIds = new Set(newQs.map((q) => q.id));
  const added = newQs.filter((q) => !oldIds.has(q.id));
  const removed = oldQs.filter((q) => !newIds.has(q.id));
  const changed = newQs.filter((q) => {
    const prev = oldQs.find((p) => p.id === q.id);
    return prev && JSON.stringify(prev) !== JSON.stringify(q);
  });
  return (
    <div className="grid gap-3 text-xs sm:grid-cols-3">
      <Card className="border-emerald-500/40 bg-emerald-500/5 p-2">
        <div className="mb-1 font-bold text-emerald-700">Added ({added.length})</div>
        {added.map((q) => <div key={q.id}>+ {q.label}</div>)}
        {added.length === 0 && <div className="text-muted-foreground">None</div>}
      </Card>
      <Card className="border-amber-500/40 bg-amber-500/5 p-2">
        <div className="mb-1 font-bold text-amber-700">Changed ({changed.length})</div>
        {changed.map((q) => <div key={q.id}>~ {q.label}</div>)}
        {changed.length === 0 && <div className="text-muted-foreground">None</div>}
      </Card>
      <Card className="border-destructive/40 bg-destructive/5 p-2">
        <div className="mb-1 font-bold text-destructive">Removed ({removed.length})</div>
        {removed.map((q) => <div key={q.id}>- {q.label}</div>)}
        {removed.length === 0 && <div className="text-muted-foreground">None</div>}
      </Card>
    </div>
  );
}