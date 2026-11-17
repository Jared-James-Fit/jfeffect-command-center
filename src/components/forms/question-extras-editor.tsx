import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { checklistItems, itemKey, PRIORITIES, PRIORITY_LABEL, type ChecklistItem, type Priority } from "@/lib/form-checklist";
import type { NfQuestion } from "@/lib/native-forms";

type SaveValidation = (patch: Record<string, unknown>) => void;

/**
 * A checklist's items, edited in the builder: the words, how much each one
 * matters (critical / important / optional), a line of help, and "only show
 * when …" on an earlier choice question. Keys stay as they were, so answers
 * already given keep matching their item after a rename.
 */
export function ChecklistItemsEditor({ q, allQuestions, saveValidation }: { q: NfQuestion; allQuestions: NfQuestion[]; saveValidation: SaveValidation }) {
  const [items, setItems] = useState<ChecklistItem[]>(() => checklistItems(q));
  const [newLabel, setNewLabel] = useState("");
  const myIndex = allQuestions.findIndex((x) => x.id === q.id);
  const sources = allQuestions.filter((x, i) => i < myIndex && (x.question_type === "single_choice" || x.question_type === "dropdown") && (x.options ?? []).length > 0);

  const commit = (next: ChecklistItem[]) => {
    setItems(next);
    saveValidation({
      items: next.map((i) => ({
        key: i.key,
        label: i.label,
        priority: i.priority,
        ...(i.help ? { help: i.help } : {}),
        ...(i.show_if?.length ? { show_if: i.show_if } : {}),
      })),
    });
  };
  const patch = (key: string, p: Partial<ChecklistItem>, save = true) => {
    const next = items.map((i) => (i.key === key ? { ...i, ...p } : i));
    if (save) commit(next);
    else setItems(next);
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    commit(next);
  };
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    let key = itemKey(label);
    let n = 2;
    while (items.some((i) => i.key === key)) key = `${itemKey(label)}-${n++}`;
    commit([...items, { key, label, priority: "important" }]);
    setNewLabel("");
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2" data-checklist-editor>
      <p className="text-xs font-semibold">Items · athletes mark each one Ready, Still need or N/A</p>
      {items.map((i, idx) => {
        const rule = i.show_if?.[0] ?? null;
        const src = rule ? sources.find((s) => s.id === rule.question_id) : null;
        return (
          <div key={i.key} className="space-y-1.5 rounded-md bg-muted/50 p-2">
            <div className="flex items-center gap-1.5">
              <Input
                value={i.label}
                onChange={(e) => patch(i.key, { label: e.target.value }, false)}
                onBlur={() => commit(items)}
                className="h-9 flex-1"
                aria-label="Item"
              />
              <Select value={i.priority} onValueChange={(v) => patch(i.key, { priority: v as Priority })}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => move(idx, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => move(idx, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => commit(items.filter((x) => x.key !== i.key))} aria-label="Remove item">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <Input
              placeholder="Help under the item (optional)"
              defaultValue={i.help ?? ""}
              onBlur={(e) => patch(i.key, { help: e.target.value.trim() || null })}
              className="h-9"
            />
            {sources.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="shrink-0 text-muted-foreground">Only show when</span>
                <Select
                  value={rule?.question_id ?? "__always"}
                  onValueChange={(v) => patch(i.key, { show_if: v === "__always" ? null : [{ question_id: v, op: "equals", value: sources.find((s) => s.id === v)?.options?.[0] ?? "" }] })}
                >
                  <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__always">Always shown</SelectItem>
                    {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.label.slice(0, 40)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {src && (
                  <Select value={String(rule!.value)} onValueChange={(v) => patch(i.key, { show_if: [{ question_id: src.id, op: "equals", value: v }] })}>
                    <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(src.options ?? []).map((o) => <SelectItem key={o} value={o}>is {o.slice(0, 40)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-1.5">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add an item"
          className="h-9"
        />
        <Button type="button" variant="outline" className="h-9" onClick={add}><Plus className="mr-1 h-4 w-4" /> Add</Button>
      </div>
      <Input
        placeholder='What "Ready" reads as, e.g. Packed (optional)'
        defaultValue={typeof q.validation?.ready_label === "string" ? (q.validation.ready_label as string) : ""}
        onBlur={(e) => saveValidation({ ready_label: e.target.value.trim() || null })}
        className="h-9"
      />
    </div>
  );
}

/**
 * Readiness: which area a question counts toward on the coach's summary
 * (Documents, Equipment, …) and, for a choice, the answers that need the
 * coach's attention (I need help finding a handler).
 */
export function ReadinessFieldsEditor({ q, areas, saveValidation }: { q: NfQuestion; areas: string[]; saveValidation: SaveValidation }) {
  const v = (q.validation ?? {}) as Record<string, unknown>;
  const flags = Array.isArray(v.flag_options) ? (v.flag_options as string[]) : [];
  const isChoice = ["single_choice", "multi_choice", "dropdown"].includes(q.question_type);
  const listId = `areas-${q.id}`;
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-muted-foreground">Readiness area</span>
        <Input
          list={listId}
          className="h-8"
          placeholder="None (e.g. documents, equipment)"
          defaultValue={typeof v.area === "string" ? v.area : ""}
          onBlur={(e) => saveValidation({ area: e.target.value.trim().toLowerCase() || null })}
        />
        <datalist id={listId}>
          {areas.map((a) => <option key={a} value={a} />)}
        </datalist>
      </div>
      {isChoice && (q.options ?? []).length > 0 && (
        <div>
          <p className="mb-1 text-muted-foreground">Flag these answers for you to look at</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {(q.options ?? []).map((o) => (
              <label key={o} className="flex items-center gap-1">
                <Checkbox
                  checked={flags.includes(o)}
                  onCheckedChange={(c) => saveValidation({ flag_options: c ? [...flags, o] : flags.filter((x) => x !== o) })}
                />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PREFILLS: Array<{ value: string; label: string; types: string[] }> = [
  { value: "full_name", label: "Their name", types: ["short_text"] },
  { value: "meet_name", label: "Their next meet's name", types: ["short_text"] },
  { value: "meet_date", label: "Their next meet's date", types: ["date"] },
  { value: "meet_weight_class", label: "Their weight class for the meet", types: ["single_choice", "dropdown", "short_text"] },
  { value: "bodyweight", label: "Their latest weigh-in", types: ["number"] },
  { value: "sex", label: "Their sex", types: ["single_choice", "dropdown", "short_text"] },
  { value: "height", label: "Their height", types: ["short_text"] },
];

/** Start from what's on their account (they can change it), and how a text box opens on a phone. */
export function AnswerSourceEditor({ q, saveValidation }: { q: NfQuestion; saveValidation: SaveValidation }) {
  const v = (q.validation ?? {}) as Record<string, unknown>;
  const options = PREFILLS.filter((p) => p.types.includes(q.question_type));
  const units = Array.isArray(v.units) && v.units.length > 0;
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      {options.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-muted-foreground">Fill in from</span>
          <Select value={typeof v.prefill === "string" ? v.prefill : "__none"} onValueChange={(x) => saveValidation({ prefill: x === "__none" ? null : x })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Nothing</SelectItem>
              {options.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {q.question_type === "short_text" && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-muted-foreground">Keyboard</span>
          <Select value={typeof v.input === "string" ? v.input : "text"} onValueChange={(x) => saveValidation({ input: x === "text" ? null : x })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Words</SelectItem>
              <SelectItem value="tel">Phone number</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {q.question_type === "number" && (
        <label className="flex items-center gap-1.5">
          <Checkbox checked={units} onCheckedChange={(c) => saveValidation({ units: c ? ["lb", "kg"] : null })} />
          Answer in lb or kg (their choice)
        </label>
      )}
    </div>
  );
}
