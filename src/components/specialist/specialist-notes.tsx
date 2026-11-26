/**
 * A specialist's own notes on a clip, a set or a session. Private by default:
 * only they read them. Sharing one sends it to the athlete, and the button
 * says so before anything is saved. Nothing notifies anyone; nothing changes
 * the training.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/loading";
import { cn } from "@/lib/utils";
import {
  deleteMyNote,
  listMyNotes,
  saveMyNote,
  type MyNote,
} from "@/lib/team-access/specialist.functions";

type Target = {
  clientId: string;
  athleteFirstName: string;
  targetKind: MyNote["targetKind"];
  targetId: string;
};

export function SpecialistNotes({ clientId, athleteFirstName, targetKind, targetId }: Target) {
  const list = useServerFn(listMyNotes);
  const qc = useQueryClient();
  const key = ["specialist-notes", clientId, targetKind, targetId];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => list({ data: { clientId, targetKind, targetId } }),
  });
  const [editing, setEditing] = useState<MyNote | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Your notes</h3>
      <QueryState query={notes} what="your notes" errorSize="inline">
        {(rows) => (
          <div className="space-y-2">
            {rows.map((n) =>
              editing?.id === n.id ? null : (
                <div key={n.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {n.visibility === "shared" ? (
                      <Users className="h-3.5 w-3.5" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )}
                    {n.visibility === "shared" ? `Shared with ${athleteFirstName}` : "Only you"}
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-muted"
                        aria-label="Edit note"
                        onClick={() => setEditing(n)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DeleteButton id={n.id} onDone={refresh} />
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{n.body}</p>
                </div>
              ),
            )}
          </div>
        )}
      </QueryState>
      <Composer
        key={editing?.id ?? "new"}
        target={{ clientId, athleteFirstName, targetKind, targetId }}
        editing={editing}
        onDone={() => {
          setEditing(null);
          void refresh();
        }}
      />
    </section>
  );
}

function DeleteButton({ id, onDone }: { id: string; onDone: () => unknown }) {
  const del = useServerFn(deleteMyNote);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="rounded p-1 hover:bg-muted"
      aria-label="Delete note"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await del({ data: { id } });
          toast.success("Note deleted");
          await onDone();
        } catch (e: any) {
          toast.error(e?.message ?? "Couldn't delete the note");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function Composer({
  target,
  editing,
  onDone,
}: {
  target: Target;
  editing: MyNote | null;
  onDone: () => void;
}) {
  const save = useServerFn(saveMyNote);
  const [body, setBody] = useState(editing?.body ?? "");
  const [shared, setShared] = useState(editing?.visibility === "shared");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await save({
        data: {
          id: editing?.id,
          clientId: target.clientId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          body: body.trim(),
          visibility: shared ? "shared" : "private",
        },
      });
      setBody("");
      toast.success(shared ? `Shared with ${target.athleteFirstName}` : "Note saved");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you notice?"
        rows={3}
        maxLength={2000}
        className="text-[16px] md:text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-border p-0.5 text-xs"
          role="radiogroup"
          aria-label="Who sees it"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!shared}
            onClick={() => setShared(false)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5",
              !shared ? "bg-secondary font-semibold" : "text-muted-foreground",
            )}
          >
            <Lock className="h-3.5 w-3.5" /> Only you
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={shared}
            onClick={() => setShared(true)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5",
              shared ? "bg-secondary font-semibold" : "text-muted-foreground",
            )}
          >
            <Users className="h-3.5 w-3.5" /> Share with {target.athleteFirstName}
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!body.trim() || busy}
            loading={busy}
          >
            {shared ? `Share with ${target.athleteFirstName}` : "Save private note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
