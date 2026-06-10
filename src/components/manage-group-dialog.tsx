import { useMemo, useState, useEffect } from "react";
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
import { Search, Trash2, Archive } from "lucide-react";
import { toast } from "sonner";
import {
  updateGroupChat, addGroupMembers, removeGroupMember,
  deleteGroupChats,
} from "@/lib/group-chats.functions";
import type { ChatGroup } from "@/lib/group-chats";
import { listGroupMembers } from "@/lib/group-chats";
import { useAuth } from "@/lib/auth";

export function ManageGroupDialog({
  open, onOpenChange, group,
}: { open: boolean; onOpenChange: (v: boolean) => void; group: ChatGroup }) {
  const qc = useQueryClient();
  const update = useServerFn(updateGroupChat);
  const addMembers = useServerFn(addGroupMembers);
  const removeMember = useServerFn(removeGroupMember);
  const deleteGroups = useServerFn(deleteGroupChats);
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [mode, setMode] = useState(group.permission_mode);
  const [search, setSearch] = useState("");
  const [toAdd, setToAdd] = useState<Record<string, true>>({});

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? "");
    setMode(group.permission_mode);
  }, [group]);

  const { data: members = [] } = useQuery({
    queryKey: ["group-members", group.id],
    queryFn: () => listGroupMembers(group.id),
    enabled: open,
  });

  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const { data: people = [] } = useQuery({
    queryKey: ["group-manage-people"],
    enabled: open,
    queryFn: async () => {
      const [{ data: clients }, { data: app }] = await Promise.all([
        supabase.from("clients").select("user_id, full_name, email").eq("archived", false).not("user_id", "is", null),
        supabase.from("app_members").select("user_id, full_name, email").eq("status", "Active").not("user_id", "is", null),
      ]);
      const seen = new Set<string>();
      const out: { user_id: string; full_name: string | null; email: string | null }[] = [];
      for (const c of clients ?? []) if (c.user_id && !seen.has(c.user_id)) { seen.add(c.user_id); out.push({ user_id: c.user_id, full_name: c.full_name, email: c.email }); }
      for (const m of app ?? []) if (m.user_id && !seen.has(m.user_id)) { seen.add(m.user_id); out.push({ user_id: m.user_id, full_name: m.full_name, email: m.email }); }
      return out;
    },
  });

  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => !memberIds.has(p.user_id))
      .filter((p) => !q || `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  }, [people, memberIds, search]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);

  const saveInfo = async () => {
    try {
      await update({ data: { group_id: group.id, name: name.trim(), description: description.trim() || null, permission_mode: mode } as any });
      toast.success("Group updated");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const doAdd = async () => {
    const ids = Object.keys(toAdd);
    if (ids.length === 0) return;
    try {
      await addMembers({ data: { group_id: group.id, user_ids: ids } as any });
      setToAdd({});
      qc.invalidateQueries({ queryKey: ["group-members", group.id] });
      toast.success(`Added ${ids.length}`);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const doRemove = async (uid: string) => {
    try {
      await removeMember({ data: { group_id: group.id, user_id: uid } as any });
      qc.invalidateQueries({ queryKey: ["group-members", group.id] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const archive = async () => {
    try {
      await update({ data: { group_id: group.id, archived: !group.archived } as any });
      toast.success(group.archived ? "Unarchived" : "Archived");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const doDelete = async () => {
    if (!isAdmin) return;
    if (!window.confirm(`Permanently delete "${group.name}" and all its messages? This can't be undone.`)) return;
    try {
      await deleteGroups({ data: { group_ids: [group.id] } as any });
      toast.success("Group deleted");
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage group · {group.name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 min-w-0">
            <div className="space-y-1"><Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1"><Label>Description</Label>
              <Textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Who can send messages?</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="everyone" /> Everyone can send
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="admins_only" /> Only admin/coach can send
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="read_only" /> View/react only
                </label>
              </RadioGroup>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveInfo}>Save changes</Button>
              <Button variant="outline" onClick={archive}>
                <Archive className="mr-1 h-4 w-4" />{group.archived ? "Unarchive" : "Archive"}
              </Button>
              {isAdmin && (
                <Button variant="destructive" onClick={doDelete}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete group
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <div>
              <Label>Participants ({members.length})</Label>
              <ScrollArea className="mt-1 h-40 rounded border border-border">
                <ul className="divide-y divide-border">
                  {members.map((mb) => {
                    const p = peopleById.get(mb.user_id);
                    return (
                      <li key={mb.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{p?.full_name ?? p?.email ?? mb.user_id.slice(0, 8)}</span>
                          {mb.role === "admin" && <span className="ml-1 text-[10px] text-primary">Admin</span>}
                        </span>
                        {mb.role !== "admin" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => doRemove(mb.user_id)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>

            <div>
              <Label>Add people</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <ScrollArea className="mt-1 h-32 rounded border border-border">
                <ul className="divide-y divide-border">
                  {addable.map((p) => (
                    <li key={p.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <Checkbox
                        checked={!!toAdd[p.user_id]}
                        onCheckedChange={(v) => setToAdd((s) => { const n = { ...s }; if (v) n[p.user_id] = true; else delete n[p.user_id]; return n; })}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.full_name ?? p.email ?? p.user_id.slice(0, 8)}</span>
                    </li>
                  ))}
                  {addable.length === 0 && <li className="p-3 text-xs text-muted-foreground">Everyone is in this group.</li>}
                </ul>
              </ScrollArea>
              <Button className="mt-2" size="sm" onClick={doAdd} disabled={Object.keys(toAdd).length === 0}>
                Add {Object.keys(toAdd).length || ""}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}