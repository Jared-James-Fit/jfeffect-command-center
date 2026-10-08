/**
 * Admin → My Voice. How the app talks when it writes as the coach: AI
 * suggested check-in replies, form-review replies and the Wednesday Wins post.
 * Edit the rules, word lists and examples, set per-client nicknames / edgy
 * humour, and try a sample before saving.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Save, Search, Sparkles, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VOICE,
  VOICE_LIST_KEYS,
  VOICE_LIST_LABELS,
  type VoiceListKey,
  type VoiceProfile,
} from "@/lib/coach-voice";
import {
  getCoachVoiceFn,
  saveClientVoiceFn,
  saveCoachVoiceFn,
  tryCoachVoiceFn,
  type ClientVoiceRow,
  type VoiceScenario,
} from "@/lib/coach-voice.functions";

const SCENARIOS: Array<{ value: VoiceScenario; label: string }> = [
  { value: "great_week", label: "Great week" },
  { value: "pr_week", label: "PR week" },
  { value: "rough_week", label: "Rough week" },
  { value: "pain", label: "Pain flagged" },
];

export function CoachVoicePage() {
  const qc = useQueryClient();
  const get = useServerFn(getCoachVoiceFn);
  const save = useServerFn(saveCoachVoiceFn);
  const { data, isLoading } = useQuery({ queryKey: ["coach-voice"], queryFn: () => get() });

  const [draft, setDraft] = useState<VoiceProfile | null>(null);
  useEffect(() => {
    if (data?.profile) setDraft(data.profile);
  }, [data?.profile]);
  const dirty = useMemo(() => !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.profile), [draft, data]);

  const saveMut = useMutation({
    mutationFn: async () => save({ data: { profile: draft! } }),
    onSuccess: async () => {
      toast.success("Voice saved. New replies will use it.");
      await qc.invalidateQueries({ queryKey: ["coach-voice"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const setList = (k: VoiceListKey, next: string[]) => setDraft((d) => (d ? { ...d, [k]: next } : d));

  return (
    <>
      <PageHeader
        title="My Voice"
        subtitle="How the app talks when it writes as you: suggested check-in replies, form replies and the Wednesday Wins post."
      />
      <SettingsTabs />
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-28 md:p-6">
        {isLoading || !draft ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your voice…
          </div>
        ) : (
          <>
            <Card className="space-y-2 p-4">
              <div>
                <div className="text-sm font-bold">How I text</div>
                <div className="text-xs text-muted-foreground">Plain rules, one per line. The AI follows these first.</div>
              </div>
              <Textarea
                value={draft.rules}
                onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
                className="min-h-[180px] text-sm"
              />
            </Card>

            {VOICE_LIST_KEYS.map((k) => (
              <Card key={k} className="space-y-2 p-4">
                <div>
                  <div className="text-sm font-bold">{VOICE_LIST_LABELS[k].title}</div>
                  <div className="text-xs text-muted-foreground">{VOICE_LIST_LABELS[k].hint}</div>
                </div>
                <TagEditor values={draft[k]} onChange={(next) => setList(k, next)} emoji={k === "emojis"} />
              </Card>
            ))}

            <Card className="space-y-3 p-4">
              <div>
                <div className="text-sm font-bold">Example replies</div>
                <div className="text-xs text-muted-foreground">
                  Write them exactly how you'd text. Used for style only, never copied. Keep client names out.
                </div>
              </div>
              {draft.examples.map((ex, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea
                    value={ex}
                    onChange={(e) =>
                      setDraft({ ...draft, examples: draft.examples.map((x, j) => (j === i ? e.target.value : x)) })
                    }
                    className="min-h-[110px] text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove example"
                    onClick={() => setDraft({ ...draft, examples: draft.examples.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {draft.examples.length < 8 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft({ ...draft, examples: [...draft.examples, ""] })}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add example
                </Button>
              )}
            </Card>

            <ClientVoiceCard clients={data?.clients ?? []} />

            <TryItCard profile={draft} clients={data?.clients ?? []} />
          </>
        )}
      </div>

      {draft && (
        <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-clearance,0px)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Reset everything to the starting voice? Unsaved changes are lost.")) setDraft(DEFAULT_VOICE);
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "Saved"}</div>
            <Button type="button" size="sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save voice
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** Chips + an input. Enter or comma adds; × removes. */
function TagEditor({ values, onChange, emoji }: { values: string[]; onChange: (v: string[]) => void; emoji?: boolean }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    onChange([...values, ...parts.filter((p) => !seen.has(p.toLowerCase()))]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-xs text-muted-foreground">Nothing yet.</span>}
        {values.map((v) => (
          <span
            key={v}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 py-0.5 pl-2.5 pr-1",
              emoji ? "text-base" : "text-xs font-medium",
            )}
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={emoji ? "Add an emoji…" : "Add a word or phrase… (comma for several)"}
          className="h-9 text-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!text.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

/** Per-client: guy / girl, a nickname only they get, edgy humour OK. Saves on change. */
function ClientVoiceCard({ clients }: { clients: ClientVoiceRow[] }) {
  const qc = useQueryClient();
  const saveClient = useServerFn(saveClientVoiceFn);
  const [q, setQ] = useState("");
  const [nickDraft, setNickDraft] = useState<Record<string, string>>({});
  const shown = clients.filter((c) => c.full_name?.toLowerCase().includes(q.trim().toLowerCase()));

  const update = async (
    c: ClientVoiceRow,
    patch: { sex?: "male" | "female" | "unspecified" | null; nickname?: string | null; edgyOk?: boolean },
  ) => {
    // Optimistic: reflect it in the list right away.
    qc.setQueryData(["coach-voice"], (prev: any) =>
      prev
        ? {
            ...prev,
            clients: prev.clients.map((x: ClientVoiceRow) =>
              x.id === c.id
                ? {
                    ...x,
                    ...(patch.sex !== undefined ? { sex: patch.sex } : {}),
                    ...(patch.nickname !== undefined ? { voice_nickname: patch.nickname } : {}),
                    ...(patch.edgyOk !== undefined ? { voice_edgy_ok: patch.edgyOk } : {}),
                  }
                : x,
            ),
          }
        : prev,
    );
    try {
      await saveClient({ data: { clientId: c.id, ...patch } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
      await qc.invalidateQueries({ queryKey: ["coach-voice"] });
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <div className="text-sm font-bold">Clients</div>
        <div className="text-xs text-muted-foreground">
          Guy / girl decides which nicknames are used ("bro" vs "sis"). Not set = no gendered words. A nickname is only
          ever used for that one client. Edgy humour is guys only, and only when you switch it on.
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="h-9 pl-9 text-sm" />
      </div>
      <ul className="divide-y divide-border">
        {shown.map((c) => {
          const sex = c.sex === "male" || c.sex === "female" ? c.sex : "unset";
          const nick = nickDraft[c.id] ?? c.voice_nickname ?? "";
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-[8rem] flex-1 truncate text-sm font-semibold">{c.full_name}</div>
              <Select
                value={sex}
                onValueChange={(v) =>
                  void update(c, {
                    sex: v === "unset" ? null : (v as "male" | "female"),
                    ...(v !== "male" && c.voice_edgy_ok ? { edgyOk: false } : {}),
                  })
                }
              >
                <SelectTrigger className="h-8 w-[7.5rem] text-xs" aria-label={`${c.full_name}: guy or girl`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Guy</SelectItem>
                  <SelectItem value="female">Girl</SelectItem>
                  <SelectItem value="unset">Not set</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={nick}
                onChange={(e) => setNickDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                onBlur={() => {
                  const next = nick.trim() || null;
                  if (next !== (c.voice_nickname ?? null)) void update(c, { nickname: next });
                }}
                placeholder="Nickname"
                maxLength={40}
                className="h-8 w-[8rem] text-xs"
                aria-label={`${c.full_name}: nickname`}
              />
              <label className="flex items-center gap-1.5 text-xs" title={sex === "male" ? "" : "Guys only"}>
                <Switch
                  checked={!!c.voice_edgy_ok}
                  disabled={sex !== "male"}
                  onCheckedChange={(v) => void update(c, { edgyOk: v })}
                  aria-label={`${c.full_name}: edgy humour OK`}
                />
                Edgy OK
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-3 text-xs text-muted-foreground">No clients match.</li>}
      </ul>
    </Card>
  );
}

/** Write a sample reply with the current (unsaved) voice. */
function TryItCard({ profile, clients }: { profile: VoiceProfile; clients: ClientVoiceRow[] }) {
  const tryIt = useServerFn(tryCoachVoiceFn);
  const [scenario, setScenario] = useState<VoiceScenario>("great_week");
  const [clientId, setClientId] = useState<string>("none");
  const [out, setOut] = useState<string>("");
  const run = useMutation({
    mutationFn: async () =>
      tryIt({ data: { profile, scenario, clientId: clientId === "none" ? null : clientId } }),
    onSuccess: (r) => setOut(r.text),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't write a sample"),
  });
  return (
    <Card className="space-y-3 p-4">
      <div>
        <div className="text-sm font-bold">Try it</div>
        <div className="text-xs text-muted-foreground">
          Writes a sample check-in reply with what's on this page (saved or not). Pick a client to test their nickname and
          guy / girl settings.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={scenario} onValueChange={(v) => setScenario(v as VoiceScenario)}>
          <SelectTrigger className="h-9 w-[10rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCENARIOS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-9 w-[12rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Any client</SelectItem>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Write a sample
        </Button>
      </div>
      {out && <div className="whitespace-pre-wrap rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">{out}</div>}
    </Card>
  );
}
