import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Eye, EyeOff, Loader2, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { noteText, STYLE_LABEL, type RoadmapNoteRow } from "@/lib/training-roadmap";
import { rewriteBlockRoadmap } from "@/lib/training-roadmap.functions";

const sb = supabase as any;

/* ──────────────────────────────────────────────────────────────────────────
   Roadmap notes for one block, as the athlete reads them: the block's phase
   + purpose and every week's label + focus. Cleo writes them from the
   program and rewrites them when it changes; the coach can reword any of
   them (theirs always wins and Cleo never overwrites it), go back to
   Cleo's, or hide one from the athlete.
   ────────────────────────────────────────────────────────────────────────── */

type Note = RoadmapNoteRow & { id: string; client_id: string };

export function BlockRoadmapPanel({ blockId }: { blockId: string }) {
  const qc = useQueryClient();
  const rewriteFn = useServerFn(rewriteBlockRoadmap);
  const [rewriting, setRewriting] = useState(false);

  const { data } = useQuery({
    queryKey: ["block-roadmap-notes", blockId],
    queryFn: async () => {
      const [block, weeks, notes] = await Promise.all([
        sb.from("pl_blocks").select("id, client_id").eq("id", blockId).maybeSingle(),
        sb.from("pl_weeks").select("id, week_index, archived, deleted_at").eq("block_id", blockId).order("week_index"),
        sb.from("pl_roadmap_notes").select("*").eq("block_id", blockId),
      ]);
      return {
        clientId: (block.data?.client_id ?? null) as string | null,
        weeks: ((weeks.data ?? []) as any[]).filter((w) => !w.archived && !w.deleted_at),
        notes: (notes.data ?? []) as Note[],
        missingTable: !!notes.error,
      };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["block-roadmap-notes", blockId] });
    qc.invalidateQueries({ queryKey: ["program-roadmap"] });
  };

  const rewrite = async () => {
    setRewriting(true);
    try {
      const r = await rewriteFn({ data: { blockId } });
      if (r.outcome === "empty") toast.message("Nothing programmed in this block yet, so there's nothing to describe.");
      else toast.success("Cleo rewrote this block's notes. Your own wording was kept.");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Cleo couldn't rewrite these right now.");
    } finally {
      setRewriting(false);
    }
  };

  if (!data || data.missingTable || !data.clientId) return null;
  const blockNote = data.notes.find((n) => !n.week_id) ?? null;
  const weekNote = new Map(data.notes.filter((n) => n.week_id).map((n) => [n.week_id as string, n]));
  const generatedAt = blockNote?.generated_at ?? null;

  return (
    <Card id="roadmap" className="scroll-mt-20 space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Athlete roadmap</h3>
            {blockNote?.ai_style && STYLE_LABEL[blockNote.ai_style] && (
              <Badge variant="outline" className="text-[10px]">{STYLE_LABEL[blockNote.ai_style]}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What the athlete reads about this block and each week. Cleo writes it from the program and updates it a few
            minutes after you change the program. Your edits always win and are never overwritten.
            {generatedAt ? ` Cleo last updated it ${formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}.` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={rewrite} disabled={rewriting}>
          {rewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {rewriting ? "Cleo is reading…" : "Rewrite with Cleo"}
        </Button>
      </div>

      {!blockNote?.ai_summary && !blockNote?.coach_summary && (
        <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          Cleo hasn't written this block's notes yet. They appear a few minutes after the program has exercises, or tap
          Rewrite with Cleo.
        </p>
      )}

      <NoteEditor
        title="Block"
        labelHint="Phase, e.g. Hypertrophy"
        note={blockNote}
        keyFields={{ client_id: data.clientId, block_id: blockId, week_id: null }}
        onSaved={refresh}
      />
      <div className="space-y-2">
        {data.weeks.map((w) => (
          <NoteEditor
            key={w.id}
            title={`Week ${w.week_index}`}
            labelHint="Label, e.g. Volume build"
            note={weekNote.get(w.id) ?? null}
            keyFields={{ client_id: data.clientId!, block_id: blockId, week_id: w.id }}
            onSaved={refresh}
          />
        ))}
      </div>
    </Card>
  );
}

function NoteEditor({
  title,
  labelHint,
  note,
  keyFields,
  onSaved,
}: {
  title: string;
  labelHint: string;
  note: Note | null;
  keyFields: { client_id: string; block_id: string; week_id: string | null };
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = noteText(note ? { ...note, hidden: false } : null);
  const hidden = !!note?.hidden;

  const write = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const stamp = { ...patch, edited_by: user?.id ?? null, edited_at: new Date().toISOString() };
      const res = note?.id
        ? await sb.from("pl_roadmap_notes").update(stamp).eq("id", note.id)
        : await sb.from("pl_roadmap_notes").insert({ ...keyFields, ...stamp });
      if (res.error) throw res.error;
      onSaved();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setLabel(shown.label ?? "");
    setSummary(shown.summary ?? "");
    setEditing(true);
  };

  const save = async () => {
    const l = label.trim();
    const s = summary.trim();
    // Saving Cleo's text unchanged keeps it Cleo's (so it still updates with the program).
    const sameAsCleo = l === (note?.ai_label ?? "").trim() && s === (note?.ai_summary ?? "").trim();
    const ok = await write(sameAsCleo ? { coach_label: null, coach_summary: null } : { coach_label: l || null, coach_summary: s || null });
    if (ok) setEditing(false);
  };

  return (
    <div className={cn("rounded-lg border px-3 py-2", hidden && "opacity-60")}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</span>
        {shown.byCoach ? (
          <Badge variant="outline" className="h-4 px-1 text-[9px]">Your words</Badge>
        ) : shown.label || shown.summary ? (
          <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[9px]"><Sparkles className="h-2.5 w-2.5" />Cleo</Badge>
        ) : null}
        {hidden && <Badge variant="outline" className="h-4 px-1 text-[9px]">Hidden from athlete</Badge>}
        <div className="ml-auto flex items-center gap-0.5">
          {!editing && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={startEdit} disabled={busy} aria-label={`Edit ${title} note`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {!editing && shown.byCoach && (note?.ai_label || note?.ai_summary) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => write({ coach_label: null, coach_summary: null })}
              disabled={busy}
            >
              Use Cleo's
            </Button>
          )}
          {!editing && note && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => write({ hidden: !hidden })}
              disabled={busy}
              aria-label={hidden ? `Show ${title} note to athlete` : `Hide ${title} note from athlete`}
            >
              {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={labelHint} maxLength={60} className="h-8 text-sm" />
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={keyFields.week_id ? "What this week asks of the athlete" : "What this block builds and why it's here"}
            maxLength={400}
            rows={3}
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" className="h-8" onClick={save} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save
            </Button>
          </div>
        </div>
      ) : shown.label || shown.summary ? (
        <div className="mt-1">
          {shown.label && <div className="text-sm font-semibold">{shown.label}</div>}
          {shown.summary && <p className="text-xs leading-snug text-foreground/80">{shown.summary}</p>}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No note yet.</p>
      )}
    </div>
  );
}
