import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendBulkSms } from "@/lib/sms.functions";
import { toast } from "sonner";
import { Search, Send, Users, AlertTriangle } from "lucide-react";

function render(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export function SmsPersonalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const send = useServerFn(sendBulkSms);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["sms-settings"],
    queryFn: async () => (await supabase.from("sms_settings").select("brand_name,from_phone,enabled").eq("singleton", true).maybeSingle()).data,
    enabled: open,
  });

  const { data: clients } = useQuery({
    queryKey: ["sms-personal-clients"],
    queryFn: async () => (await supabase.from("clients")
      .select("id, full_name, first_name, phone, sms_opt_out")
      .eq("archived", false).order("full_name")).data ?? [],
    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients ?? []).filter((c: any) => !q || `${c.full_name ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(q));
  }, [clients, search]);

  const selectedClients = useMemo(
    () => (clients ?? []).filter((c: any) => selected[c.id]),
    [clients, selected],
  );
  const sendable = selectedClients.filter((c: any) => c.phone && !c.sms_opt_out);
  const blocked = selectedClients.length - sendable.length;

  const previewClient = sendable[0];
  const previewText = previewClient && body
    ? render(body, {
        first_name: previewClient.first_name ?? previewClient.full_name?.split(" ")[0] ?? "there",
        full_name: previewClient.full_name ?? "",
        brand: settings?.brand_name ?? "",
      })
    : body;

  const close = () => { onOpenChange(false); setConfirming(false); setSelected({}); setBody(""); setSearch(""); };

  const doSend = async () => {
    if (!body.trim()) return toast.error("Write a message first");
    if (sendable.length === 0) return toast.error("No selected clients can receive SMS");
    setBusy(true);
    try {
      const r: any = await send({ data: { client_ids: sendable.map((c: any) => c.id), body: body.trim(), kind: "manual" } });
      toast.success(`Sent ${r.sent} · skipped ${r.skipped} · failed ${r.failed}`);
      close();
    } catch (e: any) { toast.error(e?.message ?? "Failed to send"); }
    finally { setBusy(false); }
  };

  const toggleAllVisible = () => {
    const next = { ...selected };
    const allSelected = filtered.every((c: any) => next[c.id]);
    for (const c of filtered) { if (allSelected) delete next[c.id]; else next[c.id] = true; }
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Create Personal SMS</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 min-w-0">
              <Label>Recipients</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Button size="sm" variant="ghost" onClick={toggleAllVisible}>Select all visible</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
                <span className="ml-auto text-muted-foreground">{Object.keys(selected).length} selected</span>
              </div>
              <ScrollArea className="h-64 rounded border border-border">
                <ul className="divide-y divide-border">
                  {filtered.map((c: any) => {
                    const canReceive = !!c.phone && !c.sms_opt_out;
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                        <Checkbox checked={!!selected[c.id]} onCheckedChange={(v) => {
                          setSelected((s) => { const n = { ...s }; if (v) n[c.id] = true; else delete n[c.id]; return n; });
                        }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{c.full_name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{c.phone || "no phone"}</div>
                        </div>
                        {!canReceive && <Badge variant="outline" className="border-amber-500/40 text-amber-600 text-[10px]">{c.sms_opt_out ? "Opted out" : "No phone"}</Badge>}
                      </li>
                    );
                  })}
                  {filtered.length === 0 && <li className="p-4 text-sm text-muted-foreground">No clients match.</li>}
                </ul>
              </ScrollArea>
            </div>

            <div className="space-y-2 min-w-0">
              <Label>Message</Label>
              <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000}
                placeholder={"Hey {first_name}, quick reminder…"} />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Tags: {"{first_name}"} {"{full_name}"} {"{brand}"}</span>
                <span>{body.length}/1000</span>
              </div>

              {previewClient && (
                <div className="rounded border border-border bg-secondary/30 p-3 text-xs space-y-1">
                  <div className="font-semibold">Preview</div>
                  <div>To: <span className="font-medium">{previewClient.full_name}</span></div>
                  <div>Phone: <span className="font-mono">{previewClient.phone}</span></div>
                  <div className="whitespace-pre-wrap pt-1">{previewText}</div>
                </div>
              )}
              {blocked > 0 && (
                <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 mt-0.5" />
                  {blocked} selected client{blocked === 1 ? "" : "s"} will be skipped (no phone or opted out).
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-border p-4">
              <div className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" />You are about to send this SMS to {sendable.length} client{sendable.length === 1 ? "" : "s"}.</div>
              <div className="mt-3 text-xs text-muted-foreground">Sample preview:</div>
              {previewClient && (
                <div className="mt-1 rounded bg-secondary/40 p-3 text-sm">
                  <div className="text-[11px] text-muted-foreground">To {previewClient.full_name} · {previewClient.phone}</div>
                  <div className="mt-1 whitespace-pre-wrap">{previewText}</div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {!confirming ? (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button onClick={() => setConfirming(true)} disabled={sendable.length === 0 || !body.trim() || !settings?.enabled || !settings?.from_phone}>
                Continue ({sendable.length})
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
              <Button onClick={doSend} disabled={busy}><Send className="mr-1 h-4 w-4" />{busy ? "Sending…" : `Send SMS (${sendable.length})`}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}