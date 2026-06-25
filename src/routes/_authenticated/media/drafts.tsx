import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Plus, MoreVertical, Copy, Send, Archive, Trash2, FileText, ArrowRightCircle,
  CheckCircle2, Loader2, AlertCircle, History,
} from "lucide-react";
import {
  listDrafts, createDraft, patchDraft, deleteDraft, duplicateDraft,
  archiveDraft, snapshotVersion, submitDraftForReview, convertDraftToContent,
  listDraftVersions, DRAFT_TYPES, DRAFT_TYPE_LABELS, DRAFT_STATUS_LABELS,
  type Draft, type DraftType,
} from "@/lib/media-drafts";

export const Route = createFileRoute("/_authenticated/media/drafts")({
  component: DraftsPage,
});

type SaveState = "idle" | "saving" | "saved" | "error";

function DraftsPage() {
  const qc = useQueryClient();
  const { open: openContent } = useContentDrawer();
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: drafts, isLoading } = useQuery({
    queryKey: ["media-drafts", archived],
    queryFn: () => listDrafts({ archived }),
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return (drafts ?? []).filter((d) => {
      if (typeFilter !== "all" && d.draft_type !== typeFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        (d.body ?? "").toLowerCase().includes(q) ||
        (d.caption ?? "").toLowerCase().includes(q) ||
        (d.hook ?? "").toLowerCase().includes(q)
      );
    });
  }, [drafts, filter, typeFilter]);

  useEffect(() => {
    if (!activeId && filtered.length) setActiveId(filtered[0].id);
  }, [filtered, activeId]);

  async function onNew() {
    const d = await createDraft({ title: "Untitled draft", draft_type: "content_idea" });
    await qc.invalidateQueries({ queryKey: ["media-drafts"] });
    setActiveId(d.id);
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Drafts"
        description="Hooks, scripts, captions, and ideas with autosave and version history."
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New Draft
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search drafts…"
              className="h-9"
            />
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {DRAFT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{DRAFT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={archived ? "default" : "outline"}
                size="sm"
                onClick={() => setArchived((v) => !v)}
                className="shrink-0"
              >
                <Archive className="mr-1 h-4 w-4" /> {archived ? "Archived" : "Active"}
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[calc(100vh-280px)] rounded-md border">
            <div className="divide-y">
              {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
              {!isLoading && filtered.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No drafts.</div>
              )}
              {filtered.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setActiveId(d.id)}
                  className={`block w-full text-left p-3 hover:bg-accent ${
                    activeId === d.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">{d.title || "Untitled"}</div>
                      <div className="text-xs text-muted-foreground">
                        {DRAFT_TYPE_LABELS[(d.draft_type as DraftType)] ?? d.draft_type}
                        {" · "}
                        {new Date(d.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {DRAFT_STATUS_LABELS[d.status as keyof typeof DRAFT_STATUS_LABELS] ?? d.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div>
          {activeId ? (
            <DraftEditor
              key={activeId}
              id={activeId}
              onDeleted={() => { setActiveId(null); qc.invalidateQueries({ queryKey: ["media-drafts"] }); }}
              onConverted={(contentId) => {
                qc.invalidateQueries({ queryKey: ["media-drafts"] });
                openContent(contentId);
              }}
            />
          ) : (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Select a draft or create a new one.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftEditor({
  id, onDeleted, onConverted,
}: { id: string; onDeleted: () => void; onConverted: (contentId: string) => void }) {
  const qc = useQueryClient();
  const { data: source } = useQuery({
    queryKey: ["media-drafts", "one", id],
    queryFn: async () => {
      const list = await listDrafts({ archived: false });
      const archived = await listDrafts({ archived: true });
      return [...list, ...archived].find((x) => x.id === id) ?? null;
    },
  });
  const [local, setLocal] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showHistory, setShowHistory] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => { setLocal(source ?? null); setSaveState("idle"); dirty.current = false; }, [source]);

  function patchLocal(p: Partial<Draft>) {
    setLocal((d) => (d ? { ...d, ...p } : d));
    dirty.current = true;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await patchDraft(id, p);
        setSaveState("saved");
        dirty.current = false;
        qc.invalidateQueries({ queryKey: ["media-drafts"] });
      } catch {
        setSaveState("error");
      }
    }, 700);
  }

  if (!local) return <Card className="p-8 text-sm text-muted-foreground">Loading…</Card>;

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Input
            value={local.title}
            onChange={(e) => patchLocal({ title: e.target.value })}
            className="border-0 px-0 text-xl font-semibold focus-visible:ring-0"
            placeholder="Untitled draft"
          />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <SaveIndicator state={saveState} />
            <span>·</span>
            <span>v{local.current_version}</span>
            <span>·</span>
            <span>Updated {new Date(local.updated_at).toLocaleString()}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={async () => {
              const d = await duplicateDraft(id);
              qc.invalidateQueries({ queryKey: ["media-drafts"] });
              toast.success(`Duplicated as "${d.title}"`);
            }}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => {
              if (local) await snapshotVersion(local);
              qc.invalidateQueries({ queryKey: ["media-drafts"] });
              toast.success("Version saved");
            }}>
              <History className="mr-2 h-4 w-4" /> Save version
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowHistory((v) => !v)}>
              <History className="mr-2 h-4 w-4" /> {showHistory ? "Hide history" : "Show history"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => {
              await submitDraftForReview(id);
              qc.invalidateQueries({ queryKey: ["media-drafts"] });
              toast.success("Submitted for review");
            }}>
              <Send className="mr-2 h-4 w-4" /> Submit for Review
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => {
              const contentId = await convertDraftToContent(id);
              toast.success("Converted to content");
              onConverted(contentId);
            }}>
              <ArrowRightCircle className="mr-2 h-4 w-4" /> Convert to Content
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => {
              await archiveDraft(id, !local.is_archived);
              toast.success(local.is_archived ? "Restored" : "Archived");
              qc.invalidateQueries({ queryKey: ["media-drafts"] });
            }}>
              <Archive className="mr-2 h-4 w-4" /> {local.is_archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={async () => {
                if (!confirm("Delete this draft permanently?")) return;
                await deleteDraft(id);
                toast.success("Deleted");
                onDeleted();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Type">
          <Select value={local.draft_type as string} onValueChange={(v) => patchLocal({ draft_type: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DRAFT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{DRAFT_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Platform">
          <Input value={local.platform ?? ""} onChange={(e) => patchLocal({ platform: e.target.value })} placeholder="Instagram, YouTube, Email…" />
        </Field>
        <Field label="Content Pillar">
          <Input value={local.content_pillar ?? ""} onChange={(e) => patchLocal({ content_pillar: e.target.value })} />
        </Field>
        <Field label="Campaign">
          <Input value={local.campaign ?? ""} onChange={(e) => patchLocal({ campaign: e.target.value })} />
        </Field>
        <Field label="Assignee (user id)">
          <Input value={local.assignee ?? ""} onChange={(e) => patchLocal({ assignee: e.target.value || null })} placeholder="optional" />
        </Field>
        <Field label="CTA">
          <Input value={local.cta ?? ""} onChange={(e) => patchLocal({ cta: e.target.value })} />
        </Field>
      </div>

      <Field label="Hook">
        <Textarea rows={2} value={local.hook ?? ""} onChange={(e) => patchLocal({ hook: e.target.value })} />
      </Field>
      <Field label="Body / Script">
        <Textarea rows={8} value={local.body ?? ""} onChange={(e) => patchLocal({ body: e.target.value })} />
      </Field>
      <Field label="Caption">
        <Textarea rows={3} value={local.caption ?? ""} onChange={(e) => patchLocal({ caption: e.target.value })} />
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={local.notes ?? ""} onChange={(e) => patchLocal({ notes: e.target.value })} />
      </Field>
      <Field label="Reference Links (one URL per line)">
        <Textarea
          rows={2}
          value={(local.reference_links ?? []).map((l: any) => (typeof l === "string" ? l : l.url ?? "")).join("\n")}
          onChange={(e) => patchLocal({
            reference_links: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
          })}
        />
      </Field>

      {showHistory && <VersionHistory draftId={id} />}
    </Card>
  );
}

function VersionHistory({ draftId }: { draftId: string }) {
  const { data } = useQuery({
    queryKey: ["media-draft-versions", draftId],
    queryFn: () => listDraftVersions(draftId),
  });
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-medium">Version history</div>
      {(data ?? []).length === 0 && (
        <div className="text-xs text-muted-foreground">No saved versions yet. Use "Save version" from the menu.</div>
      )}
      <ul className="space-y-1 text-xs">
        {(data ?? []).map((v: any) => (
          <li key={v.id} className="flex justify-between">
            <span>v{v.version}</span>
            <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1 text-amber-600"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (state === "saved") return <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Saved</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" /> Failed to save</span>;
  return <span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-3 w-3" /> Autosave on</span>;
}