import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, ClipboardList, FileSignature, UtensilsCrossed, ZapIcon, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { ClientActionRequestComposer } from "@/components/client-action-request-composer";
import { bulkAssignNativeFormToClients } from "@/lib/native-forms.functions";
import { createAgreement } from "@/lib/agreements.functions";
import { shareRecipeWithClients } from "@/lib/chat-requests.functions";

export type ChatSendAttachment = {
  kind: "form_request" | "signature_request" | "recipe_share";
  type: "link";
  url: string;
  form_id?: string;
  template_id?: string;
  recipe_id?: string;
  assignment_client_ids?: string[];
  agreement_ids?: string[];
  agreement_client_map?: { client_id: string; agreement_id: string }[];
  request_title?: string;
  request_note?: string;
};

export function ChatSendMenu({
  clientIds,
  defaultClientId,
  disabled,
  onAttach,
  surface,
  hideTrigger,
  externalOpen,
  onExternalOpenChange,
}: {
  /** Clients the request will target. For group chats: all client members. */
  clientIds: string[];
  /** Best-guess single client for Action Request composer prefill. */
  defaultClientId?: string;
  disabled?: boolean;
  onAttach: (att: ChatSendAttachment, body: string) => void | Promise<void>;
  surface: "dm" | "group";
  /** When true, render only the dialogs (no Plus trigger) — caller drives them. */
  hideTrigger?: boolean;
  externalOpen?: { form?: boolean; sig?: boolean; recipe?: boolean; action?: boolean };
  onExternalOpenChange?: (key: "form" | "sig" | "recipe" | "action", v: boolean) => void;
}) {
  const [actionOpenInt, setActionOpenInt] = useState(false);
  const [formOpenInt, setFormOpenInt] = useState(false);
  const [sigOpenInt, setSigOpenInt] = useState(false);
  const [recipeOpenInt, setRecipeOpenInt] = useState(false);

  const actionOpen = externalOpen?.action ?? actionOpenInt;
  const formOpen = externalOpen?.form ?? formOpenInt;
  const sigOpen = externalOpen?.sig ?? sigOpenInt;
  const recipeOpen = externalOpen?.recipe ?? recipeOpenInt;
  const setActionOpen = (v: boolean) => onExternalOpenChange ? onExternalOpenChange("action", v) : setActionOpenInt(v);
  const setFormOpen = (v: boolean) => onExternalOpenChange ? onExternalOpenChange("form", v) : setFormOpenInt(v);
  const setSigOpen = (v: boolean) => onExternalOpenChange ? onExternalOpenChange("sig", v) : setSigOpenInt(v);
  const setRecipeOpen = (v: boolean) => onExternalOpenChange ? onExternalOpenChange("recipe", v) : setRecipeOpenInt(v);

  const hasTargets = clientIds.length > 0;

  return (
    <>
      {!hideTrigger && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            disabled={disabled}
            title="Send request"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs">Send to {surface === "group" ? "group members" : "client"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasTargets}
            onClick={() => setFormOpen(true)}
          >
            <ClipboardList className="mr-2 h-4 w-4" /> Form to fill
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasTargets}
            onClick={() => setSigOpen(true)}
          >
            <FileSignature className="mr-2 h-4 w-4" /> Signature request
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasTargets}
            onClick={() => setRecipeOpen(true)}
          >
            <UtensilsCrossed className="mr-2 h-4 w-4" /> Share recipe
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={surface !== "dm" || !defaultClientId}
            onClick={() => setActionOpen(true)}
          >
            <ZapIcon className="mr-2 h-4 w-4" /> Action request
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )}

      <FormPickerDialog
        open={formOpen} onOpenChange={setFormOpen}
        clientIds={clientIds}
        onAttach={onAttach}
      />
      <SignaturePickerDialog
        open={sigOpen} onOpenChange={setSigOpen}
        clientIds={clientIds}
        onAttach={onAttach}
      />
      <RecipePickerDialog
        open={recipeOpen} onOpenChange={setRecipeOpen}
        clientIds={clientIds}
        onAttach={onAttach}
      />
      {surface === "dm" && defaultClientId && (
        <ClientActionRequestComposer
          open={actionOpen}
          onOpenChange={setActionOpen}
          defaultClientId={defaultClientId}
        />
      )}
    </>
  );
}

/* ------------------------------ Form picker ------------------------------ */

function FormPickerDialog({
  open, onOpenChange, clientIds, onAttach,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientIds: string[];
  onAttach: (att: ChatSendAttachment, body: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const assign = useServerFn(bulkAssignNativeFormToClients);
  const qc = useQueryClient();

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ["chat-send-forms"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nf_forms")
        .select("id, title, description, active, archived, kind, external_url")
        .eq("archived", false)
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return (forms as any[]).filter((f) =>
      (f.title ?? "").toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q),
    );
  }, [forms, search]);

  async function handleSend() {
    if (!selectedId) return;
    setSending(true);
    try {
      await assign({ data: { formId: selectedId, clientIds } });
      const form = (forms as any[]).find((f) => f.id === selectedId);
      // Refresh the admin "Shared with" lists so the new share appears immediately.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["nf-assignments", selectedId] }),
        qc.invalidateQueries({ queryKey: ["nf-forms"] }),
        qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] }),
      ]);
      await onAttach(
        {
          kind: "form_request",
          type: "link",
          url: form?.kind === "external" && form?.external_url
            ? form.external_url
            : `/portal/check-ins/${selectedId}`,
          form_id: selectedId,
          assignment_client_ids: clientIds,
          request_title: form?.title ?? "Form",
          request_note: note || undefined,
        },
        note || `Shared a form: ${form?.title ?? "Form"}`,
      );
      onOpenChange(false);
      setSelectedId("");
      setNote("");
      toast.success(`Form shared with ${clientIds.length} ${clientIds.length === 1 ? "client" : "clients"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send form");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share a form</DialogTitle>
          <DialogDescription>
            Grants {clientIds.length} {clientIds.length === 1 ? "client" : "clients"} access and drops a live status card in chat. Tracked under the form's "Shared with" tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forms & check-ins…"
              className="pl-9 h-11 text-base"
            />
          </div>
          <div className="max-h-[55vh] min-h-[180px] overflow-y-auto rounded-md border">
            {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No forms found.</div>
            )}
            {filtered.map((f: any) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left text-sm last:border-b-0 hover:bg-accent/40 ${selectedId === f.id ? "bg-accent/60" : ""}`}
              >
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-medium">{f.title}</div>
                    {f.kind === "external" && (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">External</span>
                    )}
                    {!f.active && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Draft</span>
                    )}
                  </div>
                  {f.description && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.description}</div>}
                </div>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!selectedId || sending}>
            {sending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Send form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Signature picker ---------------------------- */

function SignaturePickerDialog({
  open, onOpenChange, clientIds, onAttach,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientIds: string[];
  onAttach: (att: ChatSendAttachment, body: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const sendCreate = useServerFn(createAgreement);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["chat-send-templates"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreement_templates")
        .select("id, name, agreement_type, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return (templates as any[]).filter((t) =>
      (t.name ?? "").toLowerCase().includes(q) || (t.agreement_type ?? "").toLowerCase().includes(q),
    );
  }, [templates, search]);

  async function handleSend() {
    if (!selectedId) return;
    setSending(true);
    try {
      const tpl = (templates as any[]).find((t) => t.id === selectedId);
      const created: { client_id: string; agreement_id: string }[] = [];
      for (const cid of clientIds) {
        try {
          const res: any = await sendCreate({
            data: {
              client_id: cid,
              template_id: selectedId,
              agreement_type: tpl?.agreement_type ?? null,
              send_now: true,
              signing_method: "Remote Invite",
            },
          });
          const agreementId = res?.id ?? res?.agreement?.id ?? res?.data?.id;
          if (agreementId) created.push({ client_id: cid, agreement_id: agreementId });
        } catch (e: any) {
          toast.error(`Couldn't send to a client: ${e?.message ?? "error"}`);
        }
      }
      if (created.length === 0) {
        toast.error("No signature requests were sent.");
        return;
      }
      await onAttach(
        {
          kind: "signature_request",
          type: "link",
          url: `/admin/agreements`,
          template_id: selectedId,
          agreement_ids: created.map((c) => c.agreement_id),
          agreement_client_map: created,
          request_title: tpl?.name ?? "Signature request",
          request_note: note || undefined,
        },
        note || `Please sign: ${tpl?.name ?? "Agreement"}`,
      );
      onOpenChange(false);
      setSelectedId("");
      setNote("");
      toast.success(`Signature request sent (${created.length})`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send signature request");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send signature request</DialogTitle>
          <DialogDescription>
            Creates a SignNow invite for {clientIds.length} {clientIds.length === 1 ? "client" : "clients"} and shows live signing status in chat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="pl-7 h-9"
            />
          </div>
          <div className="max-h-[55vh] min-h-[180px] overflow-y-auto rounded-md border">
            {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No active templates.</div>
            )}
            {filtered.map((t: any) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left text-sm last:border-b-0 hover:bg-accent/40 ${selectedId === t.id ? "bg-accent/60" : ""}`}
              >
                <FileSignature className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.name}</div>
                  {t.agreement_type && <div className="truncate text-[11px] text-muted-foreground">{t.agreement_type}</div>}
                </div>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!selectedId || sending}>
            {sending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Recipe picker ----------------------------- */

function RecipePickerDialog({
  open, onOpenChange, clientIds, onAttach,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientIds: string[];
  onAttach: (att: ChatSendAttachment, body: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const share = useServerFn(shareRecipeWithClients);

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ["chat-send-recipes"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, title, category, status")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return (recipes as any[]).filter((r) =>
      (r.title ?? "").toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q),
    );
  }, [recipes, search]);

  async function handleSend() {
    if (!selectedId) return;
    setSending(true);
    try {
      await share({ data: { recipe_id: selectedId, client_ids: clientIds } });
      const recipe = (recipes as any[]).find((r) => r.id === selectedId);
      await onAttach(
        {
          kind: "recipe_share",
          type: "link",
          url: `/portal/recipes/${selectedId}`,
          recipe_id: selectedId,
          assignment_client_ids: clientIds,
          request_title: recipe?.title ?? "Recipe",
          request_note: note || undefined,
        },
        note || `Check out this recipe: ${recipe?.title ?? ""}`,
      );
      onOpenChange(false);
      setSelectedId("");
      setNote("");
      toast.success("Recipe shared");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to share recipe");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share a recipe</DialogTitle>
          <DialogDescription>
            Grants {clientIds.length} {clientIds.length === 1 ? "client" : "clients"} access to the recipe and drops a card in chat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipes…"
              className="pl-7 h-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No recipes found.</div>
            )}
            {filtered.map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent/40 ${selectedId === r.id ? "bg-accent/60" : ""}`}
              >
                <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.category}{r.status !== "Published" ? ` · ${r.status}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!selectedId || sending}>
            {sending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Share recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}