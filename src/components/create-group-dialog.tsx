import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Search, Users } from "lucide-react";
import { toast } from "sonner";
import { createGroupChat } from "@/lib/group-chats.functions";

type Person = { user_id: string; full_name: string | null; email: string | null; kind: "client" | "member" };

export function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createGroupChat);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"everyone" | "admins_only" | "read_only">("everyone");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["group-create-people"],
    enabled: open,
    queryFn: async () => {
      const [{ data: clients }, { data: members }] = await Promise.all([
        supabase.from("clients").select("user_id, full_name, email").eq("archived", false).not("user_id", "is", null),
        supabase.from("app_members").select("user_id, full_name, email").eq("status", "Active").not("user_id", "is", null),
      ]);
      const seen = new Set<string>();
      const out: Person[] = [];
      for (const c of clients ?? []) {
        if (c.user_id && !seen.has(c.user_id)) { seen.add(c.user_id); out.push({ ...c, kind: "client" }); }
      }
      for (const m of members ?? []) {
        if (m.user_id && !seen.has(m.user_id)) { seen.add(m.user_id); out.push({ ...m, kind: "member" }); }
      }
      return out.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => !q || `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q));
  }, [people, search]);

  const close = () => {
    onOpenChange(false);
    setName(""); setDescription(""); setMode("everyone"); setSelected({}); setSearch("");
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      const ids = Object.keys(selected);
      await create({ data: {
        name: name.trim(),
        description: description.trim() || null,
        permission_mode: mode,
        member_user_ids: ids,
      } as any });
      toast.success("Group created");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create group");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(v) : close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Create Group Chat</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 min-w-0">
            <div className="space-y-1">
              <Label>Group name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Power Builders" />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Who can send messages?</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="everyone" id="pm-everyone" /> Everyone can send
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="admins_only" id="pm-admins" /> Only admin/coach can send
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="read_only" id="pm-read" /> View/react only
                </label>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            <Label>Add members</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search clients/members" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="text-[11px] text-muted-foreground">{Object.keys(selected).length} selected</div>
            <ScrollArea className="h-64 rounded border border-border">
              <ul className="divide-y divide-border">
                {filtered.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-2 px-3 py-2">
                    <Checkbox
                      checked={!!selected[p.user_id]}
                      onCheckedChange={(v) => setSelected((s) => {
                        const n = { ...s };
                        if (v) n[p.user_id] = true; else delete n[p.user_id];
                        return n;
                      })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.full_name ?? p.email ?? "(no name)"}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {p.kind === "client" ? "Client" : "App member"} · {p.email}
                      </div>
                    </div>
                  </li>
                ))}
                {filtered.length === 0 && <li className="p-4 text-sm text-muted-foreground">No people match.</li>}
              </ul>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create group"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}