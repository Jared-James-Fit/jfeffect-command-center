import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import {
  validateConditionalLogic,
  type NfConditionalRule,
  type NfQuestion,
} from "@/lib/native-forms";

type Mode = "show" | "hide";
type Op = NfConditionalRule["op"];

const OPS_BY_TYPE: Record<string, Op[]> = {
  short_text: ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty"],
  long_text: ["contains", "not_contains", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "gt", "lt", "is_empty", "is_not_empty"],
  rating: ["equals", "not_equals", "gt", "lt"],
  single_choice: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multi_choice: ["contains", "not_contains", "is_empty", "is_not_empty"],
  dropdown: ["equals", "not_equals", "is_empty", "is_not_empty"],
  date: ["equals", "not_equals", "gt", "lt", "is_empty", "is_not_empty"],
  file: ["is_empty", "is_not_empty"],
  video: ["is_empty", "is_not_empty"],
};

const OP_LABEL: Record<Op, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  gt: "greater than",
  lt: "less than",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export function ConditionalLogicEditor({
  question,
  allQuestions,
  onChange,
}: {
  question: NfQuestion;
  allQuestions: NfQuestion[];
  onChange: (cl: NfQuestion["conditional_logic"]) => void;
}) {
  const cl = question.conditional_logic ?? {};
  const mode: Mode = (cl.hide_if?.length ?? 0) > (cl.show_if?.length ?? 0) ? "hide" : "show";
  const rules: NfConditionalRule[] = (mode === "hide" ? cl.hide_if : cl.show_if) ?? [];
  const match = cl.match ?? "all";

  const sources = allQuestions.filter(
    (q) => q.id !== question.id && !q.archived_at,
  );

  const error = useMemo(() => validateConditionalLogic(question, allQuestions), [question, allQuestions]);

  function update(next: { mode?: Mode; rules?: NfConditionalRule[]; match?: "all" | "any" }) {
    const m = next.mode ?? mode;
    const r = next.rules ?? rules;
    const mt = next.match ?? match;
    onChange({
      match: mt,
      show_if: m === "show" ? r : [],
      hide_if: m === "hide" ? r : [],
    });
  }

  function addRule() {
    const first = sources[0];
    update({
      rules: [...rules, { question_id: first?.id ?? "", op: "equals", value: "" }],
    });
  }

  function updateRule(i: number, patch: Partial<NfConditionalRule>) {
    const next = rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    update({ rules: next });
  }

  function removeRule(i: number) {
    update({ rules: rules.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/10 p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Label className="text-xs font-semibold">Conditional logic</Label>
        <Select value={mode} onValueChange={(v) => update({ mode: v as Mode })}>
          <SelectTrigger className="h-7 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="show">Show if</SelectItem>
            <SelectItem value="hide">Hide if</SelectItem>
          </SelectContent>
        </Select>
        {rules.length > 1 && (
          <Select value={match} onValueChange={(v) => update({ match: v as "all" | "any" })}>
            <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All match (AND)</SelectItem>
              <SelectItem value="any">Any match (OR)</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={addRule} className="ml-auto h-7">
          <Plus className="mr-1 h-3 w-3" /> Add rule
        </Button>
      </div>

      {rules.length === 0 && (
        <div className="text-[11px] text-muted-foreground">Always visible.</div>
      )}

      {rules.map((r, i) => {
        const src = sources.find((s) => s.id === r.question_id);
        const ops = src ? (OPS_BY_TYPE[src.question_type] ?? ["equals", "not_equals"]) : ["equals"];
        const needsValue = !["is_empty", "is_not_empty"].includes(r.op);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Select value={r.question_id} onValueChange={(v) => updateRule(i, { question_id: v })}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Question…" /></SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.label || "(untitled)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={r.op} onValueChange={(v) => updateRule(i, { op: v as Op })}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ops.map((op) => (
                  <SelectItem key={op} value={op} className="text-xs">{OP_LABEL[op as Op]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue && (
              src && ["single_choice", "dropdown", "multi_choice"].includes(src.question_type) ? (
                <Select
                  value={String(r.value ?? "")}
                  onValueChange={(v) => updateRule(i, { value: v })}
                >
                  <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Value…" /></SelectTrigger>
                  <SelectContent>
                    {(src.options ?? []).map((o) => (
                      <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-7 w-32 text-xs"
                  value={String(r.value ?? "")}
                  onChange={(e) => updateRule(i, { value: e.target.value })}
                  placeholder="Value"
                />
              )
            )}
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => removeRule(i)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        );
      })}

      {error && (
        <div className="flex items-start gap-1 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3" /> {error}
        </div>
      )}
    </div>
  );
}