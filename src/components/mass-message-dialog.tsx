import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Send, AlertTriangle, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { sendMassMessage } from "@/lib/group-chats.functions";
import { listAllGroupsForAdmin } from "@/lib/group-chats";
import { runJob, runBulkJob } from "@/lib/progress-jobs";
import { MeetQuickAction } from "@/components/meet-quick-action";

type Audience = "selected" | "all_active_clients";

export function MassMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const send = useServerFn(sendMassMessage);
  const [mode, setMode] = useState<"individual" | "group">("individual");
  const [audience, setAudience] = useState<Audience>("all_active_clients");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [groupId, setGroupId] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["mass-clients"],
    enabled: open && mode === "individual",
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, full_name, email, status, archived")
        .eq("archived", false).order("full_name");
      return data ?? [];
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["mass-groups"],
    enabled: open && mode === "group",
    queryFn: listAllGroupsForAdmin,
  });

  const activeClients = useMemo(() => clients.filter((c: any) => c.status === "Active"), [clients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c: any) => !q || `${c.full_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q));
  }, [clients, search]);

  const recipientCount = useMemo(() => {
    if (mode === "group") return 1;
    if (audience === "all_active_clients") return activeClients.length;
    return Object.keys(selected).length;
  }, [mode, audience, activeClients.length, selected]);

  const close = () => {
    onOpenChange(false);
    setConfirming(false); setBody(""); setSelected({}); setSearch(""); setGroupId("");
  };

  const doSend = async () => {
    setBusy(true);
    try {
      if (mode === "group") {
        if (!groupId) { setBusy(false); return toast.error("Pick a group"); }
        await runJob({ title: "Sending group message" }, async () => {
          await send({ data: { mode: "group", group_id: groupId, body: body.trim() } as any });
        });
      } else {
        const recipientIds = audience === "selected" ? Object.keys(selected) : activeClients.map((c: any) => c.id);
        
        await runBulkJob({
          title: "Sending mass messages",
          items: recipientIds,
          itemNoun: "recipients",
        }, async (clientId) => {
          await send({ data: { mode: "individual", body: body.trim(), audience: "selected", client_ids: [clientId] } as any });
        });
      }
      toast.success("Sent");
      qc.invalidateQueries({ queryKey: ["last-messages"] });
      qc.invalidateQueries({ queryKey: ["group-messages"] });
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally { setBusy(false); }  };

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(v) : close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Send Mass Message</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded border border-border p-3 text-sm">
                <RadioGroupItem value="individual" className="mt-0.5" />
                <span>
                  <span className="block font-semibold">Send as 1:1 messages</span>
                  <span className="block text-xs text-muted-foreground">Each client receives it in their own coach chat. They won't see other recipients.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-border p-3 text-sm">
                <RadioGroupItem value="group" className="mt-0.5" />
                <span>
                  <span className="block font-semibold">Send into a group chat</span>
                  <span className="block text-xs text-muted-foreground">Posts as one message into the selected group.</span>
                </span>
              </label>
            </RadioGroup>

            {mode === "individual" ? (
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_active_clients">All active coaching clients ({activeClients.length})</SelectItem>
                    <SelectItem value="selected">Selected clients</SelectItem>
                  </SelectContent>
                </Select>

                {audience === "selected" && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-8" placeholder="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">{Object.keys(selected).length} selected</div>
                    <ScrollArea className="h-40 rounded border border-border">
                      <ul className="divide-y divide-border">
                        {filteredClients.map((c: any) => (
                          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                            <Checkbox
                              checked={!!selected[c.id]}
                              onCheckedChange={(v) => setSelected((s) => { const n = { ...s }; if (v) n[c.id] = true; else delete n[c.id]; return n; })}
                            />
                            <span className="truncate">{c.full_name ?? c.email}</span>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Group</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger><SelectValue placeholder="Pick a group" /></SelectTrigger>
                  <SelectContent>
                    {groups.filter((g) => !g.archived).map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Message</Label>
                <MeetQuickAction
                  size="sm"
                  variant="outline"
                  buttonClassName="h-7 gap-1.5 px-2 text-xs"
                  onInsert={(text) =>
                    setBody((b) => (b ? `${b.replace(/\s+$/, "")} ${text}` : text))
                  }
                />
              </div>
              <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
                placeholder="Write your message…" />
              <div className="text-right text-[11px] text-muted-foreground">{body.length}/4000</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-border bg-secondary/30 p-4">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                You are about to send this message to {recipientCount} {mode === "group" ? "group" : "people"}.
              </div>
              <div className="mt-2 whitespace-pre-wrap rounded bg-background p-3 text-sm">{body}</div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!confirming ? (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button
                onClick={() => setConfirming(true)}
                disabled={!body.trim() || recipientCount === 0 || (mode === "group" && !groupId)}
              >
                Continue ({recipientCount})
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
              <Button onClick={doSend} disabled={busy}>
                <Send className="mr-1 h-4 w-4" />{busy ? "Sending…" : "Send Message"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}