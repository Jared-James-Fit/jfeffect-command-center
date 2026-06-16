import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Shared shell for editable client-profile cards.
 *
 * View mode: renders `view` content + an Edit button.
 * Edit mode: renders `edit(draft, setDraft)` content + sticky Save / Cancel pinned
 * to the bottom of the card (safe-area aware, stays above iOS keyboard).
 *
 * The card holds its own draft state seeded from `initial` so partial edits
 * on one card never bleed into another card's save.
 */
export function EditableCard<T extends Record<string, any>>({
  title,
  description,
  initial,
  onSave,
  view,
  edit,
  headerExtra,
  className,
}: {
  title: string;
  description?: string;
  initial: T;
  onSave: (patch: T) => Promise<void> | void;
  view: (values: T) => ReactNode;
  edit: (draft: T, setDraft: (next: T) => void) => ReactNode;
  headerExtra?: ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const initialRef = useRef(initial);

  // Keep view in sync with upstream changes when not editing.
  useEffect(() => {
    if (!editing) {
      initialRef.current = initial;
      setDraft(initial);
    }
  }, [initial, editing]);

  const cancel = () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(initialRef.current);
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setDraft(initialRef.current);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      initialRef.current = draft;
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={["border-border bg-card", className ?? ""].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          {!editing && (
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </div>
      <div className="px-6 pb-6">
        {editing ? edit(draft, setDraft) : view(initial)}
      </div>
      {editing && (
        <div
          className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-b-md border-t border-border bg-card/95 px-6 py-3 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button variant="outline" className="min-h-[44px]" onClick={cancel} disabled={saving}>
            <X className="mr-2 h-4 w-4" /> Cancel
          </Button>
          <Button className="min-h-[44px] bg-gradient-primary uppercase font-bold" onClick={save} disabled={saving}>
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Read-only field row for view mode. */
export function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="w-44 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground break-words">
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted-foreground italic">Not set</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}