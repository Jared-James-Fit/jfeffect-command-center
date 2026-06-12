import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createClientActionRequest, uploadActionFile } from "@/lib/client-action-requests";
import { toast } from "sonner";
import { Loader2, Send, Upload, X } from "lucide-react";

export function ClientActionRequestComposer({
  open,
  onOpenChange,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClientId?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [clientId, setClientId] = useState<string>(defaultClientId ?? "");
  const [title, setTitle] = useState("Action Needed");
  const [message, setMessage] = useState("");
  const [nativeFormId, setNativeFormId] = useState<string>("none");
  const [externalFormUrl, setExternalFormUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [priority, setPriority] = useState<string>("none");
  const [dueDate, setDueDate] = useState<string>("");
  const [internalNotes, setInternalNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (defaultClientId) setClientId(defaultClientId); }, [defaultClientId]);

  const { data: clients = [] } = useQuery({
    queryKey: ["action-composer-client-list"],
    enabled: open && !defaultClientId,
    queryFn: async () => {
      const { data } = await (supabase.from("clients") as any)
        .select("id, full_name, email")
        .eq("archived", false)
        .order("full_name", { ascending: true });
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["action-composer-forms"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("nf_forms") as any)
        .select("id, title")
        .eq("active", true)
        .eq("archived", false)
        .order("title", { ascending: true });
      return (data ?? []) as { id: string; title: string }[];
    },
  });

  function reset() {
    setTitle("Action Needed"); setMessage("");
    setNativeFormId("none"); setExternalFormUrl("");
    setLinkUrl(""); setLinkLabel("");
    setFile(null); setPriority("none"); setDueDate("");
    setInternalNotes("");
  }

  async function submit() {
    if (!user) return;
    if (!clientId) { toast.error("Pick a client"); return; }
    if (!message.trim()) { toast.error("Write a message"); return; }

    const hasAction =
      (nativeFormId && nativeFormId !== "none") ||
      externalFormUrl.trim() ||
      linkUrl.trim() ||
      file;
    if (!hasAction) { toast.error("Add at least one action: form, link, or file."); return; }

    setSending(true);
    try {
      let uploaded: { path: string; name: string; mime: string } | null = null;
      if (file) uploaded = await uploadActionFile(clientId, file);

      await createClientActionRequest({
        clientId,
        coachUserId: user.id,
        title: title.trim() || "Action Needed",
        message: message.trim(),
        nativeFormId: nativeFormId === "none" ? null : nativeFormId,
        externalFormUrl: externalFormUrl.trim() || null,
        linkUrl: linkUrl.trim() || null,
        linkLabel: linkLabel.trim() || null,
        filePath: uploaded?.path ?? null,
        fileName: uploaded?.name ?? null,
        fileMime: uploaded?.mime ?? null,
        priority: priority === "none" ? null : priority,
        internalNotes: internalNotes.trim() || null,
        dueDate: dueDate || null,
        notifyClient: notify,
      });
      toast.success("Action request sent" + (notify ? " — pops up until completed" : ""));
      qc.invalidateQueries({ queryKey: ["client-action-requests"] });
      qc.invalidateQueries({ queryKey: ["client-actions-for-client"] });
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not send action request");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Client Action Request</DialogTitle>
          <DialogDescription>
            Send a form to fill, a link to open, or a file to review. Pops up for the client every time they open the app until they confirm it's done.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!defaultClientId && (
            <div>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email ?? c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Action Needed" />
          </div>

          <div>
            <Label>Message to Client</Label>
            <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What do you need them to do?" />
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actions (add one or more)</div>

            <div>
              <Label className="text-xs">Fill a Native Form</Label>
              <Select value={nativeFormId} onValueChange={setNativeFormId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">External Form URL <span className="text-muted-foreground">(Fillout, Google Form, Typeform…)</span></Label>
              <Input value={externalFormUrl} onChange={(e) => setExternalFormUrl(e.target.value)} placeholder="https://…" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Link URL</Label>
                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <Label className="text-xs">Link Button Label</Label>
                <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Open link" />
              </div>
            </div>

            <div>
              <Label className="text-xs">File Attachment</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="mt-1 flex items-center justify-between rounded-md border border-border bg-card px-2 py-1.5 text-xs">
                  <span className="truncate">{file.name}</span>
                  <ActionButton variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFile(null)}>
                    <X className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              ) : (
                <ActionButton type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-1 h-3.5 w-3.5" /> Choose file
                </ActionButton>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Internal Notes <span className="text-xs text-muted-foreground">(admin-only)</span></Label>
            <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div>
              <div className="text-sm font-bold">Pop up until completed</div>
              <div className="text-xs text-muted-foreground">Re-appears each time the client opens the app until they confirm it's done.</div>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>
        </div>

        <DialogFooter>
          <ActionButton variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</ActionButton>
          <ActionButton onClick={submit} jobLabel="Sending action request" className="bg-gradient-primary font-bold">
            <Send className="mr-2 h-4 w-4" />
            Send Request
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}